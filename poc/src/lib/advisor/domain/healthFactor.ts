import type { CollateralPosition, DebtPosition, MarketContext, Underlying, UnderlyingId } from '../types'
import { collateralValueUsd } from './collateralValue'
import { ltvParamsFor } from './ltv'
import { effectiveDebtValueUsd } from './stablecoin'

/** HF below this triggers liquidation. */
export const LIQUIDATION_HF = 1.0

/** HF below this triggers agent intervention (institutional default). */
export const AGENT_INTERVENTION_HF = 1.2

/** Minimum HF required at origination for positions holding private equity. */
export const PRIVATE_EQUITY_ORIGINATION_HF = 1.5

export type HfStatus = 'healthy' | 'warning' | 'liquidatable'

export interface HealthFactorInput {
  collateral: readonly CollateralPosition[]
  debts: readonly DebtPosition[]
  /** Registry of underlyings, used to resolve each token's risk tier. */
  underlyings: Record<UnderlyingId, Underlying>
  market: MarketContext
}

export interface CollateralContribution {
  address: string
  underlyingId: UnderlyingId
  /** Haircut-adjusted USD value of the position. */
  valueUsd: number
  liquidationThreshold: number
  /** value x liquidation threshold — the position's contribution to HF numerator. */
  weightedUsd: number
}

export interface HealthFactorResult {
  /** Infinity when there is no debt. */
  healthFactor: number
  /** Σ (collateral value x liquidation threshold). */
  riskAdjustedCollateralUsd: number
  /** Σ (haircut-adjusted collateral value). */
  grossCollateralUsd: number
  /** Σ (effective debt value, including the USDe conservatism markup). */
  effectiveDebtUsd: number
  contributions: CollateralContribution[]
}

/**
 * Health Factor per the PRD:
 *
 *   HF = Σ(collateral_value_i × liquidation_threshold_i) / Σ(debt_value_j)
 *
 * Collateral values carry the market-hours / stale-NAV haircuts; the
 * liquidation threshold is resolved at the intersection of the token's
 * underlying tier and its provider risk score; debt values carry the USDe
 * conservatism markup.
 */
export function computeHealthFactor(input: HealthFactorInput): HealthFactorResult {
  const contributions: CollateralContribution[] = []
  let riskAdjustedCollateralUsd = 0
  let grossCollateralUsd = 0

  for (const position of input.collateral) {
    const underlying = input.underlyings[position.token.underlyingId]
    if (!underlying) {
      throw new Error(`No underlying registered for ${position.token.underlyingId}`)
    }
    const { valueUsd } = collateralValueUsd(position, input.market)
    const { liquidationThreshold } = ltvParamsFor(underlying.tier, position.token.providerRiskScore)
    const weightedUsd = valueUsd * liquidationThreshold

    grossCollateralUsd += valueUsd
    riskAdjustedCollateralUsd += weightedUsd
    contributions.push({
      address: position.token.address,
      underlyingId: position.token.underlyingId,
      valueUsd,
      liquidationThreshold,
      weightedUsd,
    })
  }

  const effectiveDebtUsd = input.debts.reduce((acc, d) => acc + effectiveDebtValueUsd(d), 0)
  const healthFactor = effectiveDebtUsd === 0 ? Infinity : riskAdjustedCollateralUsd / effectiveDebtUsd

  return { healthFactor, riskAdjustedCollateralUsd, grossCollateralUsd, effectiveDebtUsd, contributions }
}

/** Classifies an HF against the liquidation and intervention thresholds. */
export function hfStatus(healthFactor: number): HfStatus {
  if (healthFactor < LIQUIDATION_HF) return 'liquidatable'
  if (healthFactor < AGENT_INTERVENTION_HF) return 'warning'
  return 'healthy'
}
