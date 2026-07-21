import type { CollateralPosition, MarketContext, ProviderRiskScore, UnderlyingId } from '../types'
import { collateralValueUsd } from './collateralValue'

/** Default drift band beyond which a rebalance is proposed (±5%). */
export const DEFAULT_DRIFT_BAND = 0.05

/** A single provider above this share of one underlying triggers a warning. */
export const PROVIDER_CONCENTRATION_THRESHOLD = 0.6

export interface ProviderShare {
  address: string
  issuer: string
  providerRiskScore: ProviderRiskScore
  valueUsd: number
  /** This provider's share of the underlying's total value. */
  shareOfUnderlying: number
}

export interface UnderlyingAggregate {
  underlyingId: UnderlyingId
  /** Haircut-adjusted USD value across every provider token for this underlying. */
  valueUsd: number
  /** Share of the whole basket. */
  weight: number
  providers: ProviderShare[]
  /** Largest single-provider share of this underlying. */
  topProviderShare: number
}

export interface BasketAggregate {
  total: number
  byUnderlying: UnderlyingAggregate[]
}

/**
 * Collapses provider-fragmented token positions into an underlying-level view —
 * the layer the agent, basket manager, and UI operate on. Values use the same
 * haircut-adjusted USD as the HF calculation so weights and health agree.
 */
export function aggregateBasket(
  collateral: readonly CollateralPosition[],
  market: MarketContext,
): BasketAggregate {
  const groups = new Map<UnderlyingId, ProviderShare[]>()
  let total = 0

  for (const position of collateral) {
    const { valueUsd } = collateralValueUsd(position, market)
    total += valueUsd
    const list = groups.get(position.token.underlyingId) ?? []
    list.push({
      address: position.token.address,
      issuer: position.token.issuer,
      providerRiskScore: position.token.providerRiskScore,
      valueUsd,
      shareOfUnderlying: 0, // filled once the underlying total is known
    })
    groups.set(position.token.underlyingId, list)
  }

  const byUnderlying: UnderlyingAggregate[] = []
  for (const [underlyingId, providers] of groups) {
    const valueUsd = providers.reduce((acc, p) => acc + p.valueUsd, 0)
    for (const p of providers) p.shareOfUnderlying = valueUsd === 0 ? 0 : p.valueUsd / valueUsd
    const topProviderShare = providers.reduce((max, p) => Math.max(max, p.shareOfUnderlying), 0)
    byUnderlying.push({
      underlyingId,
      valueUsd,
      weight: total === 0 ? 0 : valueUsd / total,
      providers,
      topProviderShare,
    })
  }

  return { total, byUnderlying }
}

export interface DriftEntry {
  underlyingId: UnderlyingId
  current: number
  target: number
  /** current − target. */
  drift: number
  /** Whether |drift| exceeds the band. */
  breached: boolean
}

/**
 * Compares current underlying weights against target weights and flags any that
 * have drifted beyond the band. Targets with no current holding still report,
 * so a fully-exited underlying surfaces as breached.
 */
export function driftReport(
  byUnderlying: readonly UnderlyingAggregate[],
  targets: Record<UnderlyingId, number>,
  band = DEFAULT_DRIFT_BAND,
): DriftEntry[] {
  const currentById = new Map(byUnderlying.map(u => [u.underlyingId, u.weight]))
  const ids = new Set<UnderlyingId>([...currentById.keys(), ...Object.keys(targets)])

  const report: DriftEntry[] = []
  for (const id of ids) {
    const current = currentById.get(id) ?? 0
    const target = targets[id] ?? 0
    const drift = current - target
    report.push({ underlyingId: id, current, target, drift, breached: Math.abs(drift) > band })
  }
  return report
}

export interface ConcentrationWarning {
  underlyingId: UnderlyingId
  topProviderShare: number
  issuer: string
}

/**
 * Underlyings whose exposure is concentrated in a single provider beyond the
 * threshold — a diversification signal, since provider risk is idiosyncratic.
 */
export function providerConcentrationWarnings(
  byUnderlying: readonly UnderlyingAggregate[],
  threshold = PROVIDER_CONCENTRATION_THRESHOLD,
): ConcentrationWarning[] {
  const warnings: ConcentrationWarning[] = []
  for (const u of byUnderlying) {
    if (u.topProviderShare > threshold) {
      const top = u.providers.reduce((a, b) => (b.shareOfUnderlying > a.shareOfUnderlying ? b : a))
      warnings.push({ underlyingId: u.underlyingId, topProviderShare: u.topProviderShare, issuer: top.issuer })
    }
  }
  return warnings
}
