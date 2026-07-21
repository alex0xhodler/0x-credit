import type { ProviderRiskScore, UnderlyingTier } from '../types'

export interface LtvParams {
  /** Maximum borrow-to-value permitted at origination. */
  maxLtv: number
  /** Value ratio at which the position becomes liquidatable. */
  liquidationThreshold: number
}

/**
 * Base LTV tiers, defined for the highest-rated providers (risk score 5).
 * Lower provider scores are derived from these by {@link ltvParamsFor}.
 */
export const BASE_LTV_TIERS: Record<UnderlyingTier, LtvParams> = {
  blue_chip: { maxLtv: 0.65, liquidationThreshold: 0.75 },
  index_etf: { maxLtv: 0.75, liquidationThreshold: 0.82 },
  small_mid_cap: { maxLtv: 0.5, liquidationThreshold: 0.62 },
  private_equity: { maxLtv: 0.45, liquidationThreshold: 0.58 },
  // Tokenized T-bill / cash-equivalent collateral (mTBILL, mBASIS, BUIDL) — the
  // safest tier: short-duration sovereign credit risk with daily NAV pricing.
  treasury: { maxLtv: 0.8, liquidationThreshold: 0.88 },
}

/** Per-step LTV reduction applied for each provider score below 5. */
const MAX_LTV_STEP = 0.03
const LIQ_THRESHOLD_STEP = 0.02

/**
 * Effective LTV parameters for a token, at the intersection of its underlying
 * tier and its provider risk score. Each step of provider risk below 5 lowers
 * max LTV by 3% and the liquidation threshold by 2%, so two tokens for the same
 * underlying can carry different max LTVs when their issuers differ in quality.
 */
export function ltvParamsFor(tier: UnderlyingTier, providerRiskScore: ProviderRiskScore): LtvParams {
  const base = BASE_LTV_TIERS[tier]
  const steps = 5 - providerRiskScore
  return {
    maxLtv: Math.max(0, base.maxLtv - steps * MAX_LTV_STEP),
    liquidationThreshold: Math.max(0, base.liquidationThreshold - steps * LIQ_THRESHOLD_STEP),
  }
}
