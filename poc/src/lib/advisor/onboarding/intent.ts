import type {
  CollateralPosition,
  DebtPosition,
  MarketContext,
  ProviderToken,
  Stablecoin,
  Underlying,
  UnderlyingId,
} from '../types'
import { computeHealthFactor, PRIVATE_EQUITY_ORIGINATION_HF, type HealthFactorResult } from '../domain/healthFactor'
import { collateralValueUsd } from '../domain/collateralValue'
import { ltvParamsFor } from '../domain/ltv'
import { isBorrowPaused, validateBorrowShares } from '../domain/stablecoin'
import { HERO_COLLATERAL, HERO_NOW, HERO_UNDERLYINGS, HERO_USDE_PRICE } from '../fixtures/heroScenario'

/**
 * Onboarding intent — a wizard-editable description of a prospective position
 * (target basket weights, borrows, and mandate) plus the pure functions that
 * translate it into the same engine positions the dashboard operates on and
 * validate it against domain risk rules before activation.
 */

/** A single borrow line in an onboarding intent. */
export interface IntentBorrow {
  stablecoin: Stablecoin
  amountUsd: number
}

export interface IntentConfig {
  totalCollateralUsd: number
  weights: Record<UnderlyingId, number>
  borrows: IntentBorrow[]
  mode: 'manual' | 'semi' | 'auto'
  permissions: Record<string, boolean>
  interventionHf: number
}

/** Default onboarding intent — the hero scenario, expressed as wizard input. */
export const DEFAULT_INTENT: IntentConfig = {
  totalCollateralUsd: 12_500_000,
  weights: {
    'EQUITY:NVDA': 0.4,
    'EQUITY:SPY': 0.3,
    'EQUITY:AAPL': 0.2,
    'EQUITY:SPACEX': 0.1,
  },
  borrows: [
    { stablecoin: 'USDC', amountUsd: 3_000_000 },
    { stablecoin: 'USDT', amountUsd: 1_200_000 },
    { stablecoin: 'USDe', amountUsd: 800_000 },
  ],
  mode: 'semi',
  permissions: {
    autoTopUp: false,
    partialRepay: true,
    collateralSwap: true,
    providerSwap: true,
    rebalance: true,
  },
  interventionHf: 1.2,
}

/** A provider token's share of an underlying's total basket value. */
export interface ProviderSplit {
  token: ProviderToken
  share: number
}

/** $100 per unit for every synthetic provider token in the demo. */
const UNIT_PRICE_USD = 100

/**
 * Per-underlying provider splits, derived from {@link HERO_COLLATERAL} so the
 * fixture stays the single source of truth for token addresses, issuers, and
 * risk scores — this module never re-declares them.
 */
function buildProviderSplits(): Record<UnderlyingId, ProviderSplit[]> {
  const byUnderlying = new Map<UnderlyingId, CollateralPosition[]>()
  for (const position of HERO_COLLATERAL) {
    const list = byUnderlying.get(position.token.underlyingId) ?? []
    list.push(position)
    byUnderlying.set(position.token.underlyingId, list)
  }

  const splits: Record<UnderlyingId, ProviderSplit[]> = {}
  for (const [underlyingId, positions] of byUnderlying) {
    const total = positions.reduce((acc, p) => acc + p.quantity * p.priceUsd, 0)
    splits[underlyingId] = positions.map(p => ({
      token: p.token,
      share: total === 0 ? 0 : (p.quantity * p.priceUsd) / total,
    }))
  }
  return splits
}

export const PROVIDER_SPLITS: Record<UnderlyingId, ProviderSplit[]> = buildProviderSplits()

/** Each provider token's original `priceAsOf`, preserved from the fixture (e.g. the SpaceX NAV token's 1h-old feed). */
const PRICE_AS_OF_BY_ADDRESS: Record<string, number> = Object.fromEntries(
  HERO_COLLATERAL.map(position => [position.token.address, position.priceAsOf]),
)

/**
 * Builds token-level collateral positions from target underlying weights and
 * a total collateral budget, splitting each underlying's value across its
 * providers per {@link PROVIDER_SPLITS}. Zero-weight underlyings are skipped.
 */
export function buildCollateralFromIntent(
  weights: Record<UnderlyingId, number>,
  totalUsd: number,
): CollateralPosition[] {
  const positions: CollateralPosition[] = []
  for (const [underlyingId, weight] of Object.entries(weights)) {
    if (!weight) continue
    const underlyingValueUsd = weight * totalUsd
    for (const split of PROVIDER_SPLITS[underlyingId] ?? []) {
      const valueUsd = split.share * underlyingValueUsd
      positions.push({
        token: split.token,
        quantity: valueUsd / UNIT_PRICE_USD,
        priceUsd: UNIT_PRICE_USD,
        priceAsOf: PRICE_AS_OF_BY_ADDRESS[split.token.address] ?? HERO_NOW,
      })
    }
  }
  return positions
}

/**
 * Builds debt positions from onboarding borrow lines. Zero-amount borrows are
 * skipped. USDe prices off {@link HERO_USDE_PRICE}; fiat-backed coins price at 1.
 */
export function buildDebtsFromIntent(borrows: readonly IntentBorrow[]): DebtPosition[] {
  const debts: DebtPosition[] = []
  for (const borrow of borrows) {
    if (!borrow.amountUsd) continue
    debts.push({
      stablecoin: borrow.stablecoin,
      amount: borrow.amountUsd,
      priceUsd: borrow.stablecoin === 'USDe' ? HERO_USDE_PRICE : 1,
    })
  }
  return debts
}

/**
 * Origination borrow capacity: the sum, over every token-level collateral
 * position, of its haircut-adjusted USD value times its own max LTV. Computed
 * per token (not per underlying) because provider risk scores — and so max
 * LTV — differ across providers of the same underlying.
 */
export function maxBorrowUsd(
  collateral: readonly CollateralPosition[],
  underlyings: Record<UnderlyingId, Underlying>,
  market: MarketContext,
): number {
  let total = 0
  for (const position of collateral) {
    const underlying = underlyings[position.token.underlyingId]
    if (!underlying) continue
    const { valueUsd } = collateralValueUsd(position, market)
    const { maxLtv } = ltvParamsFor(underlying.tier, position.token.providerRiskScore)
    total += valueUsd * maxLtv
  }
  return total
}

/**
 * Projects the health factor an onboarding intent would produce, using the
 * same domain math the dashboard runs post-activation — the hero underlyings
 * registry and the hero market context (equity markets open, hero clock).
 */
export function projectIntentHf(
  weights: Record<UnderlyingId, number>,
  totalUsd: number,
  borrows: readonly IntentBorrow[],
): HealthFactorResult {
  const collateral = buildCollateralFromIntent(weights, totalUsd)
  const debts = buildDebtsFromIntent(borrows)
  return computeHealthFactor({
    collateral,
    debts,
    underlyings: HERO_UNDERLYINGS,
    market: { equityMarketOpen: true, now: HERO_NOW },
  })
}

export type IntentValidationCode =
  | 'weights_not_100'
  | 'borrow_exceeds_max_ltv'
  | 'borrow_share_cap'
  | 'private_equity_min_hf'
  | 'usde_paused'

export interface IntentValidationError {
  code: IntentValidationCode
  message: string
}

export interface IntentValidationResult {
  ok: boolean
  errors: IntentValidationError[]
}

const usd = (value: number) =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

/** Tolerance for the weights-sum-to-100% check, absorbing UI rounding. */
const WEIGHT_SUM_TOLERANCE = 0.001

/**
 * Validates an onboarding intent against the domain risk rules: weights sum
 * to 100%, borrow stays within the origination limit, no stablecoin exceeds
 * its permitted borrow share, private equity meets its minimum origination
 * HF, and USDe is not borrowed while its peg is paused.
 */
export function validateIntent(config: IntentConfig): IntentValidationResult {
  const errors: IntentValidationError[] = []
  const market: MarketContext = { equityMarketOpen: true, now: HERO_NOW }

  const weightSum = Object.values(config.weights).reduce((acc, w) => acc + w, 0)
  if (Math.abs(weightSum - 1) > WEIGHT_SUM_TOLERANCE) {
    errors.push({
      code: 'weights_not_100',
      message: `Your target weights total ${(weightSum * 100).toFixed(0)}% — they must add up to 100% before you continue.`,
    })
  }

  const collateral = buildCollateralFromIntent(config.weights, config.totalCollateralUsd)
  const debts = buildDebtsFromIntent(config.borrows)
  const capacity = maxBorrowUsd(collateral, HERO_UNDERLYINGS, market)
  const totalBorrowUsd = config.borrows.reduce((acc, b) => acc + b.amountUsd, 0)

  if (totalBorrowUsd > capacity) {
    errors.push({
      code: 'borrow_exceeds_max_ltv',
      message: `You're borrowing ${usd(totalBorrowUsd)} against a ${usd(capacity)} origination limit — reduce your borrow or increase your collateral.`,
    })
  }

  const shareResult = validateBorrowShares(debts)
  if (!shareResult.ok) {
    const detail = shareResult.violations
      .map(v => `${v.stablecoin} is ${(v.share * 100).toFixed(0)}% of your borrow (cap ${(v.cap * 100).toFixed(0)}%)`)
      .join('; ')
    errors.push({
      code: 'borrow_share_cap',
      message: `Your borrow mix exceeds a stablecoin's permitted share: ${detail}.`,
    })
  }

  const holdsPrivateEquity = Object.entries(config.weights).some(
    ([underlyingId, weight]) => weight > 0 && HERO_UNDERLYINGS[underlyingId]?.tier === 'private_equity',
  )
  if (holdsPrivateEquity) {
    const projected = computeHealthFactor({ collateral, debts, underlyings: HERO_UNDERLYINGS, market })
    if (projected.healthFactor < PRIVATE_EQUITY_ORIGINATION_HF) {
      errors.push({
        code: 'private_equity_min_hf',
        message:
          'Private equity in your basket requires a health factor of at least 1.50 at origination — reduce borrow or SPACEX weight.',
      })
    }
  }

  const usdeBorrowUsd = config.borrows
    .filter(b => b.stablecoin === 'USDe')
    .reduce((acc, b) => acc + b.amountUsd, 0)
  if (usdeBorrowUsd > 0 && isBorrowPaused('USDe', HERO_USDE_PRICE)) {
    errors.push({
      code: 'usde_paused',
      message: 'USDe borrowing is currently paused because its on-chain price has dropped below the peg floor.',
    })
  }

  return { ok: errors.length === 0, errors }
}
