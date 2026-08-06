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
import { effectiveDebtValueUsd, isBorrowPaused, STABLECOIN_CONFIG, validateBorrowShares } from '../domain/stablecoin'
import { HERO_COLLATERAL, HERO_NOW, HERO_UNDERLYINGS, HERO_USDE_PRICE } from '../fixtures/heroScenario'

/**
 * Onboarding intent — a wizard-editable description of a prospective position
 * (per-underlying deposits, borrows, and mandate) plus the pure functions
 * that translate it into the same engine positions the dashboard operates
 * on and validate it against domain risk rules before activation.
 */

/** A single borrow line in an onboarding intent. */
export interface IntentBorrow {
  stablecoin: Stablecoin
  amountUsd: number
}

export interface IntentConfig {
  /** Deposit amount in USD per underlying — the deposits-first replacement for weights + total. */
  deposits: Record<UnderlyingId, number>
  borrows: IntentBorrow[]
  mode: 'manual' | 'semi' | 'auto'
  permissions: Record<string, boolean>
  interventionHf: number
}

/** Default onboarding intent — the hero scenario, expressed as wizard input. */
export const DEFAULT_INTENT: IntentConfig = {
  deposits: {
    'EQUITY:NVDA': 5_000_000,
    'EQUITY:SPY': 3_750_000,
    'EQUITY:AAPL': 2_500_000,
    'EQUITY:SPACEX': 1_250_000,
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
 * Builds token-level collateral positions from per-underlying deposit
 * amounts, splitting each underlying's value across its providers per
 * {@link PROVIDER_SPLITS}. Zero or absent deposits are skipped.
 */
export function buildCollateralFromDeposits(deposits: Record<UnderlyingId, number>): CollateralPosition[] {
  const positions: CollateralPosition[] = []
  for (const [underlyingId, depositUsd] of Object.entries(deposits)) {
    if (!depositUsd) continue
    for (const split of PROVIDER_SPLITS[underlyingId] ?? []) {
      const valueUsd = split.share * depositUsd
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
 * Derives target basket weights from deposit amounts: each underlying's
 * weight is its deposit divided by the total deposited. Returns an empty
 * object when nothing has been deposited.
 */
export function derivedTargetWeights(deposits: Record<UnderlyingId, number>): Record<UnderlyingId, number> {
  const total = totalDepositsUsd(deposits)
  if (total === 0) return {}
  const out: Record<UnderlyingId, number> = {}
  for (const [id, value] of Object.entries(deposits)) out[id] = (value || 0) / total
  return out
}

/** Sum of all per-underlying deposit amounts. */
export function totalDepositsUsd(deposits: Record<UnderlyingId, number>): number {
  return Object.values(deposits).reduce((acc, v) => acc + (v || 0), 0)
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

const HERO_MARKET: MarketContext = { equityMarketOpen: true, now: HERO_NOW }

/**
 * Projects the health factor an onboarding intent would produce, using the
 * same domain math the dashboard runs post-activation — the hero underlyings
 * registry and the hero market context (equity markets open, hero clock).
 */
export function projectIntentHf(
  deposits: Record<UnderlyingId, number>,
  borrows: readonly IntentBorrow[],
): HealthFactorResult {
  const collateral = buildCollateralFromDeposits(deposits)
  const debts = buildDebtsFromIntent(borrows)
  return computeHealthFactor({
    collateral,
    debts,
    underlyings: HERO_UNDERLYINGS,
    market: HERO_MARKET,
  })
}

/**
 * Maximum USDT face value against a given face value of other stablecoin
 * debt, derived from USDT's borrow-share cap (share = usdt / (usdt + other) ≤ cap):
 *
 *   usdt ≤ cap × (usdt + other)
 *   usdt × (1 − cap) ≤ cap × other
 *   usdt ≤ (cap / (1 − cap)) × other
 *
 * At USDT's cap of 0.6 this is usdt ≤ 1.5 × other.
 */
export function maxUsdtFaceUsd(otherFaceUsd: number): number {
  const cap = STABLECOIN_CONFIG.USDT.maxBorrowShare
  return (cap / (1 - cap)) * otherFaceUsd
}

/**
 * Maximum USDe face value against a given face value of other stablecoin
 * debt, from the same algebra as {@link maxUsdtFaceUsd} applied to USDe's
 * cap of 0.4: usde ≤ (0.4 / 0.6) × other = (2/3) × other.
 */
export function maxUsdeFaceUsd(otherFaceUsd: number): number {
  const cap = STABLECOIN_CONFIG.USDe.maxBorrowShare
  return (cap / (1 - cap)) * otherFaceUsd
}

/**
 * Solves for the USDC face amount that lands a position at exactly
 * `targetHf`, holding every other borrow fixed. USDC carries no HF markup
 * (debtHaircut 0) and prices at 1, so its effective debt equals its face
 * value:
 *
 *   targetHf = riskAdjustedCollateralUsd / (otherEffectiveDebtUsd + usdc)
 *   usdc = riskAdjustedCollateralUsd / targetHf − otherEffectiveDebtUsd
 *
 * Clamped to a minimum of 0 — a target already exceeded by the other borrows
 * alone has no positive USDC solution.
 */
export function usdcForTargetHf(
  deposits: Record<UnderlyingId, number>,
  otherBorrows: readonly IntentBorrow[],
  targetHf: number,
): number {
  const collateral = buildCollateralFromDeposits(deposits)
  const { riskAdjustedCollateralUsd } = computeHealthFactor({
    collateral,
    debts: [],
    underlyings: HERO_UNDERLYINGS,
    market: HERO_MARKET,
  })
  const otherEffectiveDebtUsd = buildDebtsFromIntent(otherBorrows).reduce(
    (acc, d) => acc + effectiveDebtValueUsd(d),
    0,
  )
  return Math.max(0, riskAdjustedCollateralUsd / targetHf - otherEffectiveDebtUsd)
}

/**
 * Keeps risk presets off the exact private-equity floor (1.5) so float
 * rounding cannot flip a "Balanced"/"Max" preset in and out of validity.
 */
const MAX_PRESET_PRIVATE_EQUITY_TARGET_HF = 1.501

/**
 * The largest USDC borrow amount that still passes {@link validateIntent}:
 * bounded above by remaining origination capacity, and — when the deposits
 * include any private-equity-tier underlying — by the USDC amount that holds
 * HF at {@link MAX_PRESET_PRIVATE_EQUITY_TARGET_HF}. Clamped to a minimum of 0.
 */
export function maxUsdcBorrowUsd(deposits: Record<UnderlyingId, number>, otherBorrows: readonly IntentBorrow[]): number {
  const collateral = buildCollateralFromDeposits(deposits)
  const capacity = maxBorrowUsd(collateral, HERO_UNDERLYINGS, HERO_MARKET)
  const otherFaceUsd = otherBorrows.reduce((acc, b) => acc + b.amountUsd, 0)
  const remainingCapacity = capacity - otherFaceUsd

  const hasPrivateEquityDeposit = Object.entries(deposits).some(
    ([underlyingId, value]) => value > 0 && HERO_UNDERLYINGS[underlyingId]?.tier === 'private_equity',
  )
  const privateEquityBound = hasPrivateEquityDeposit
    ? usdcForTargetHf(deposits, otherBorrows, MAX_PRESET_PRIVATE_EQUITY_TARGET_HF)
    : Infinity

  return Math.max(0, Math.min(remainingCapacity, privateEquityBound))
}

export interface RiskPreset {
  id: 'conservative' | 'balanced' | 'max'
  label: string
  /** Target health factor the USDC anchor solves for; omitted for `max`, which solves against validity bounds instead. */
  targetHf?: number
}

/**
 * Onboarding risk presets, applied only to the USDC anchor borrow (see
 * {@link usdcForTargetHf} and {@link maxUsdcBorrowUsd}). Conservative and
 * Balanced solve for a fixed target HF; Max solves for the largest USDC
 * amount that still passes {@link validateIntent}.
 */
export const RISK_PRESETS: RiskPreset[] = [
  { id: 'conservative', label: 'Conservative', targetHf: 2.0 },
  { id: 'balanced', label: 'Balanced', targetHf: 1.6 },
  { id: 'max', label: 'Max' },
]

export type IntentValidationCode =
  | 'no_deposits'
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

/**
 * Validates an onboarding intent against the domain risk rules: some
 * collateral must be deposited, borrow stays within the origination limit,
 * no stablecoin exceeds its permitted borrow share, private equity meets its
 * minimum origination HF, and USDe is not borrowed while its peg is paused.
 */
export function validateIntent(config: IntentConfig): IntentValidationResult {
  const errors: IntentValidationError[] = []
  const market: MarketContext = { equityMarketOpen: true, now: HERO_NOW }

  const totalDeposits = totalDepositsUsd(config.deposits)
  if (totalDeposits <= 0) {
    errors.push({
      code: 'no_deposits',
      message: 'Deposit some collateral before continuing — your portfolio is currently empty.',
    })
  }

  const collateral = buildCollateralFromDeposits(config.deposits)
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

  const holdsPrivateEquity = Object.entries(config.deposits).some(
    ([underlyingId, value]) => value > 0 && HERO_UNDERLYINGS[underlyingId]?.tier === 'private_equity',
  )
  if (holdsPrivateEquity) {
    const projected = computeHealthFactor({ collateral, debts, underlyings: HERO_UNDERLYINGS, market })
    if (projected.healthFactor < PRIVATE_EQUITY_ORIGINATION_HF) {
      errors.push({
        code: 'private_equity_min_hf',
        message:
          'Private equity in your basket requires a health factor of at least 1.50 at origination — reduce borrow or SPACEX deposit.',
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
