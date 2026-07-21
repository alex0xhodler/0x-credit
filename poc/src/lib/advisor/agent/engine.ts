import type {
  CollateralPosition,
  DebtPosition,
  MarketContext,
  Stablecoin,
  Underlying,
  UnderlyingId,
} from '../types'
import {
  AGENT_INTERVENTION_HF,
  computeHealthFactor,
  hfStatus,
  type HealthFactorResult,
  type HfStatus,
} from '../domain/healthFactor'
import {
  aggregateBasket,
  driftReport,
  providerConcentrationWarnings,
  type ConcentrationWarning,
  type DriftEntry,
} from '../domain/basket'
import {
  computeReflexiveExposure,
  type IssuerReflexiveWarning,
  type StablecoinIssuerBacking,
} from '../domain/correlation'
import { applyRefinance, rawValueUsd, rotateExposure, underlyingRawValueUsd } from './rebalance'
import { activeSignals, signalsForAsset, weightedRiskScore, type SignalFeed } from './signals'

/** Maximum upward shift of the intervention HF under full risk-off pressure. */
export const SIGNAL_TIGHTEN_MAX = 0.3

/** Weighted risk score at or above which a per-underlying proposal is raised. */
export const STRONG_SIGNAL = 0.6

/** Maximum weight (basket fraction) a single signal-driven reduction may trim. */
export const MAX_SIGNAL_REDUCTION = 0.15

export type ProposalKind = 'reduce_weight' | 'provider_diversify' | 'refinance_stablecoin'

export type Urgency = 'low' | 'medium' | 'high'

export interface ProposalParams {
  /** Current basket weight of the underlying (raw). */
  fromWeight?: number
  /** Proposed basket weight after the action (editable by the user). */
  toWeight?: number
  /** Underlying the trimmed exposure rotates into. */
  intoUnderlyingId?: UnderlyingId
  /** Market value moved, in USD. */
  valueUsd?: number
  /** For diversification: current top-provider share of the underlying. */
  fromProviderShare?: number
  /** For diversification: target top-provider share. */
  toProviderShare?: number
  /** For refinancing: stablecoin being moved out of. */
  fromStablecoin?: Stablecoin
  /** For refinancing: stablecoin being moved into. */
  toStablecoin?: Stablecoin
}

export interface Proposal {
  id: string
  kind: ProposalKind
  /** Present for collateral-side proposals; omitted for debt-side actions. */
  underlyingId?: UnderlyingId
  params: ProposalParams
  /** Plain-language rationale (deterministic; the LLM layer enriches this). */
  rationale: string
  /** Feed ids that contributed to the proposal. */
  contributingSignals: string[]
  /** HF if the proposal is executed as-proposed. */
  projectedHf: number
  /** projectedHf − current HF. */
  projectedHfDelta: number
  urgency: Urgency
  /** True when the action can never auto-execute (e.g. private equity). */
  requiresApproval: boolean
}

export interface PositionState {
  collateral: readonly CollateralPosition[]
  debts: readonly DebtPosition[]
  underlyings: Record<UnderlyingId, Underlying>
  targetWeights: Record<UnderlyingId, number>
  market: MarketContext
  signals: readonly SignalFeed[]
  /** Declared stablecoin reserve backings, for reflexive-risk detection. */
  stablecoinBackings?: readonly StablecoinIssuerBacking[]
  /** Base intervention HF for this mandate (default institutional 1.20). */
  interventionHf?: number
  /** Drift band for rebalancing (default ±5%). */
  driftBand?: number
}

export interface Assessment {
  healthFactor: number
  status: HfStatus
  /** Intervention threshold after signal tightening. */
  effectiveInterventionHf: number
  drift: DriftEntry[]
  concentrationWarnings: ConcentrationWarning[]
  /** Wrong-way / reflexive single-issuer concentration warnings. */
  reflexiveWarnings: IssuerReflexiveWarning[]
  proposals: Proposal[]
}

/**
 * Signal-adjusted intervention threshold. Risk-off pressure raises the HF at
 * which the agent starts acting, so intervention happens earlier; risk-on
 * pressure nets it back down. External signals never move the hard mandate
 * bounds — only when the agent begins proposing.
 */
export function effectiveInterventionHf(baseHf: number, signals: readonly SignalFeed[], now: number): number {
  const score = weightedRiskScore(activeSignals(signals, now))
  return baseHf + SIGNAL_TIGHTEN_MAX * score
}

const URGENCY_RANK: Record<Urgency, number> = { high: 3, medium: 2, low: 1 }

/** Value-weighted liquidation threshold per underlying, from an HF result. */
function weightedLiqThresholdByUnderlying(result: HealthFactorResult): Map<UnderlyingId, number> {
  const value = new Map<UnderlyingId, number>()
  const weighted = new Map<UnderlyingId, number>()
  for (const c of result.contributions) {
    value.set(c.underlyingId, (value.get(c.underlyingId) ?? 0) + c.valueUsd)
    weighted.set(c.underlyingId, (weighted.get(c.underlyingId) ?? 0) + c.weightedUsd)
  }
  const out = new Map<UnderlyingId, number>()
  for (const [id, v] of value) out.set(id, v === 0 ? 0 : (weighted.get(id) ?? 0) / v)
  return out
}

/** Underlying (other than `excludeId`) with the highest liquidation threshold. */
function safestOtherUnderlying(
  excludeId: UnderlyingId,
  thresholds: Map<UnderlyingId, number>,
): UnderlyingId | undefined {
  let best: UnderlyingId | undefined
  let bestThreshold = -Infinity
  for (const [id, t] of thresholds) {
    if (id === excludeId) continue
    if (t > bestThreshold) {
      bestThreshold = t
      best = id
    }
  }
  return best
}

/**
 * Evaluates a position and produces editable, underlying-level proposals with
 * exact HF projections (each projection re-runs the domain HF on the mutated
 * positions — no estimated deltas). Proposals are surfaced, never executed here.
 */
export function assessPosition(state: PositionState): Assessment {
  const { market } = state
  const result = computeHealthFactor({
    collateral: state.collateral,
    debts: state.debts,
    underlyings: state.underlyings,
    market,
  })
  const status = hfStatus(result.healthFactor)
  const effHf = effectiveInterventionHf(
    state.interventionHf ?? AGENT_INTERVENTION_HF,
    state.signals,
    market.now,
  )

  const aggregate = aggregateBasket(state.collateral, market)
  const drift = driftReport(aggregate.byUnderlying, state.targetWeights, state.driftBand)
  const concentrationWarnings = providerConcentrationWarnings(aggregate.byUnderlying)
  const backings = state.stablecoinBackings ?? []
  const reflexiveWarnings = computeReflexiveExposure({
    collateral: state.collateral,
    debts: state.debts,
    backings,
    market,
  })

  const thresholds = weightedLiqThresholdByUnderlying(result)
  const rawTotal = state.collateral.reduce((acc, p) => acc + rawValueUsd(p), 0)
  const isPrivateEquity = (id: UnderlyingId) => state.underlyings[id]?.tier === 'private_equity'

  const proposals: Proposal[] = []

  // Signal-driven de-risk: trim an underlying under strong risk-off pressure and
  // rotate into the safest co-held underlying.
  for (const [id, underlying] of Object.entries(state.underlyings) as [UnderlyingId, Underlying][]) {
    const relevant = signalsForAsset(state.signals, id, market.now)
    const score = weightedRiskScore(relevant)
    if (score < STRONG_SIGNAL) continue

    const into = safestOtherUnderlying(id, thresholds)
    if (into === undefined || rawTotal === 0) continue

    const currentWeight = underlyingRawValueUsd(state.collateral, id) / rawTotal
    if (currentWeight === 0) continue
    const reduction = Math.min(score * MAX_SIGNAL_REDUCTION, currentWeight)
    const toWeight = currentWeight - reduction
    const valueUsd = reduction * rawTotal

    const mutated = rotateExposure(state.collateral, id, into, valueUsd)
    const projected = computeHealthFactor({
      collateral: mutated,
      debts: state.debts,
      underlyings: state.underlyings,
      market,
    })

    proposals.push({
      id: `reduce_weight:${id}`,
      kind: 'reduce_weight',
      underlyingId: id,
      params: { fromWeight: currentWeight, toWeight, intoUnderlyingId: into, valueUsd },
      rationale:
        `Risk-off signals on ${underlying.symbol} (score ${score.toFixed(2)}). ` +
        `Reduce ${underlying.symbol} from ${(currentWeight * 100).toFixed(0)}% to ` +
        `${(toWeight * 100).toFixed(0)}%, rotating into ${state.underlyings[into].symbol}.`,
      contributingSignals: relevant.map(f => f.feedId),
      projectedHf: projected.healthFactor,
      projectedHfDelta: projected.healthFactor - result.healthFactor,
      urgency: status === 'healthy' ? 'medium' : 'high',
      requiresApproval: isPrivateEquity(id),
    })
  }

  // Provider concentration → diversification (HF-neutral in v1; routing selects
  // the counter-provider on execution).
  for (const w of concentrationWarnings) {
    proposals.push({
      id: `provider_diversify:${w.underlyingId}`,
      kind: 'provider_diversify',
      underlyingId: w.underlyingId,
      params: {
        fromProviderShare: w.topProviderShare,
        toProviderShare: Math.min(w.topProviderShare, 0.6),
      },
      rationale:
        `${(w.topProviderShare * 100).toFixed(0)}% of ${state.underlyings[w.underlyingId]?.symbol ?? w.underlyingId} ` +
        `exposure sits with ${w.issuer}. Diversify across providers to reduce issuer-specific risk.`,
      contributingSignals: [],
      projectedHf: result.healthFactor,
      projectedHfDelta: 0,
      urgency: 'low',
      requiresApproval: isPrivateEquity(w.underlyingId),
    })
  }

  // Reflexive loop → refinance the affected stablecoin into USDC to break the
  // shared issuer dependency between collateral and borrowed liability.
  const reflexiveIssuers = new Set(reflexiveWarnings.filter(w => w.reflexive).map(w => w.issuer))
  const affectedStablecoins = new Set<Stablecoin>(
    backings.filter(b => reflexiveIssuers.has(b.issuer)).map(b => b.stablecoin),
  )
  for (const stablecoin of affectedStablecoins) {
    if (stablecoin === 'USDC') continue
    const owedUsd = state.debts
      .filter(d => d.stablecoin === stablecoin)
      .reduce((acc, d) => acc + d.amount * d.priceUsd, 0)
    if (owedUsd === 0) continue

    const mutated = applyRefinance(state.debts, stablecoin, 'USDC')
    const projected = computeHealthFactor({
      collateral: state.collateral,
      debts: mutated,
      underlyings: state.underlyings,
      market,
    })
    const issuers = reflexiveWarnings.filter(w => w.reflexive).map(w => w.issuer).join(', ')

    proposals.push({
      id: `refinance_stablecoin:${stablecoin}`,
      kind: 'refinance_stablecoin',
      params: { fromStablecoin: stablecoin, toStablecoin: 'USDC', valueUsd: owedUsd },
      rationale:
        `${stablecoin} borrow shares an issuer (${issuers}) with your collateral, so a single ` +
        `issuer failure would hit both sides at once. Refinance ${stablecoin} debt into USDC to ` +
        `break the loop.`,
      contributingSignals: [],
      projectedHf: projected.healthFactor,
      projectedHfDelta: projected.healthFactor - result.healthFactor,
      urgency: 'high',
      requiresApproval: false,
    })
  }

  proposals.sort((a, b) => {
    const rank = URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency]
    return rank !== 0 ? rank : b.projectedHfDelta - a.projectedHfDelta
  })

  return {
    healthFactor: result.healthFactor,
    status,
    effectiveInterventionHf: effHf,
    drift,
    concentrationWarnings,
    reflexiveWarnings,
    proposals,
  }
}
