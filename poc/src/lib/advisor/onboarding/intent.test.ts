import { describe, expect, it, vi } from 'vitest'
import {
  buildCollateralFromDeposits,
  buildDebtsFromIntent,
  DEFAULT_INTENT,
  derivedTargetWeights,
  maxBorrowUsd,
  maxUsdcBorrowUsd,
  maxUsdeFaceUsd,
  maxUsdtFaceUsd,
  projectIntentHf,
  PROVIDER_SPLITS,
  RISK_PRESETS,
  totalDepositsUsd,
  usdcForTargetHf,
  validateIntent,
  type IntentBorrow,
  type IntentConfig,
} from './intent'
import { assessPosition } from '../agent/engine'
import * as stablecoinDomain from '../domain/stablecoin'
import { validateBorrowShares } from '../domain/stablecoin'
import {
  HERO_COLLATERAL,
  HERO_DEBTS,
  HERO_NOW,
  HERO_STATE,
  HERO_TARGET_WEIGHTS,
  HERO_UNDERLYINGS,
  HERO_USDE_PRICE,
} from '../fixtures/heroScenario'
import { MTBILL_ADDRESS, REAL_PROVIDER_TOKENS } from '../catalog/realTokens'
import type { CollateralPosition, DebtPosition } from '../types'

const MARKET = { equityMarketOpen: true, now: HERO_NOW }

function byAddress(positions: readonly CollateralPosition[]) {
  return [...positions].sort((a, b) => a.token.address.localeCompare(b.token.address))
}

describe('buildCollateralFromDeposits', () => {
  it('reproduces HERO_COLLATERAL exactly for the default deposits (order-insensitive)', () => {
    const built = buildCollateralFromDeposits(DEFAULT_INTENT.deposits)
    expect(byAddress(built)).toEqual(byAddress(HERO_COLLATERAL))
  })

  it('skips underlyings with zero or absent deposits', () => {
    const built = buildCollateralFromDeposits({ 'EQUITY:NVDA': 1_000_000, 'EQUITY:SPY': 0 })
    expect(built.every(p => p.token.underlyingId === 'EQUITY:NVDA')).toBe(true)
    expect(built.length).toBeGreaterThan(0)
  })
})

describe('buildDebtsFromIntent', () => {
  it('reproduces HERO_DEBTS exactly for the default borrows', () => {
    const built = buildDebtsFromIntent(DEFAULT_INTENT.borrows)
    expect(built).toEqual(HERO_DEBTS)
  })

  it('skips zero-amount borrows', () => {
    const built = buildDebtsFromIntent([
      { stablecoin: 'USDC', amountUsd: 0 },
      { stablecoin: 'USDT', amountUsd: 500 },
    ])
    expect(built).toEqual([{ stablecoin: 'USDT', amount: 500, priceUsd: 1 }])
  })
})

describe('derivedTargetWeights', () => {
  it('matches HERO_TARGET_WEIGHTS for the default deposits', () => {
    expect(derivedTargetWeights(DEFAULT_INTENT.deposits)).toEqual(HERO_TARGET_WEIGHTS)
  })

  it('returns an empty object when nothing has been deposited', () => {
    expect(derivedTargetWeights({})).toEqual({})
    expect(derivedTargetWeights({ 'EQUITY:NVDA': 0 })).toEqual({})
  })
})

describe('totalDepositsUsd', () => {
  it('sums the default deposits to $12,500,000', () => {
    expect(totalDepositsUsd(DEFAULT_INTENT.deposits)).toBe(12_500_000)
  })

  it('returns 0 for an empty deposits map', () => {
    expect(totalDepositsUsd({})).toBe(0)
  })
})

describe('maxBorrowUsd', () => {
  it('computes the origination limit for the default deposits as $8,115,000', () => {
    const collateral = buildCollateralFromDeposits(DEFAULT_INTENT.deposits)
    const capacity = maxBorrowUsd(collateral, HERO_UNDERLYINGS, MARKET)
    expect(Math.abs(capacity - 8_115_000)).toBeLessThanOrEqual(1)
  })
})

describe('projectIntentHf', () => {
  it('matches assessPosition healthFactor on the hero fixture for the default intent', () => {
    const projected = projectIntentHf(DEFAULT_INTENT.deposits, DEFAULT_INTENT.borrows)
    const hero = assessPosition(HERO_STATE)
    expect(projected.healthFactor).toBeCloseTo(hero.healthFactor, 9)
  })
})

describe('maxUsdtFaceUsd / maxUsdeFaceUsd', () => {
  // Uses raw DebtPosition literals at price 1, matching the pure face-value
  // share-cap algebra the helpers document — buildDebtsFromIntent would
  // additionally apply USDe's ~0.999 peg price, which shifts the real
  // validateBorrowShares crossing point away from the formula's boundary.
  const otherFaceUsd = 1_000_000

  it('maxUsdtFaceUsd produces a book that passes validateBorrowShares at the bound and fails just above it', () => {
    const bound = maxUsdtFaceUsd(otherFaceUsd)

    const atBound: DebtPosition[] = [
      { stablecoin: 'USDT', amount: bound, priceUsd: 1 },
      { stablecoin: 'USDC', amount: otherFaceUsd, priceUsd: 1 },
    ]
    expect(validateBorrowShares(atBound).ok).toBe(true)

    const justAbove: DebtPosition[] = [
      { stablecoin: 'USDT', amount: bound + 1, priceUsd: 1 },
      { stablecoin: 'USDC', amount: otherFaceUsd, priceUsd: 1 },
    ]
    expect(validateBorrowShares(justAbove).ok).toBe(false)
  })

  it('maxUsdeFaceUsd produces a book that passes validateBorrowShares at the bound and fails just above it', () => {
    const bound = maxUsdeFaceUsd(otherFaceUsd)

    const atBound: DebtPosition[] = [
      { stablecoin: 'USDe', amount: bound, priceUsd: 1 },
      { stablecoin: 'USDC', amount: otherFaceUsd, priceUsd: 1 },
    ]
    expect(validateBorrowShares(atBound).ok).toBe(true)

    const justAbove: DebtPosition[] = [
      { stablecoin: 'USDe', amount: bound + 1, priceUsd: 1 },
      { stablecoin: 'USDC', amount: otherFaceUsd, priceUsd: 1 },
    ]
    expect(validateBorrowShares(justAbove).ok).toBe(false)
  })
})

describe('usdcForTargetHf', () => {
  it('produces a USDC amount whose projected HF matches the target', () => {
    const usdc = usdcForTargetHf(DEFAULT_INTENT.deposits, [], 2.0)
    const projected = projectIntentHf(DEFAULT_INTENT.deposits, [{ stablecoin: 'USDC', amountUsd: usdc }])
    expect(projected.healthFactor).toBeCloseTo(2.0, 6)
  })

  it('clamps to 0 when other borrows already exceed the target', () => {
    const otherBorrows: IntentBorrow[] = [{ stablecoin: 'USDT', amountUsd: 50_000_000 }]
    const usdc = usdcForTargetHf(DEFAULT_INTENT.deposits, otherBorrows, 2.0)
    expect(usdc).toBe(0)
  })
})

describe('maxUsdcBorrowUsd', () => {
  it('equals the private-equity HF bound (not raw capacity) for deposits including SPACEX, and validateIntent transitions there', () => {
    const deposits = DEFAULT_INTENT.deposits
    const otherBorrows: IntentBorrow[] = []

    const capacity = maxBorrowUsd(buildCollateralFromDeposits(deposits), HERO_UNDERLYINGS, MARKET)
    const peBound = usdcForTargetHf(deposits, otherBorrows, 1.501)
    expect(peBound).toBeLessThan(capacity)

    const bound = maxUsdcBorrowUsd(deposits, otherBorrows)
    expect(bound).toBeCloseTo(peBound, 6)

    const atBound: IntentConfig = { ...DEFAULT_INTENT, deposits, borrows: [{ stablecoin: 'USDC', amountUsd: bound }] }
    expect(validateIntent(atBound).ok).toBe(true)

    const justAboveAmount = usdcForTargetHf(deposits, otherBorrows, 1.499)
    expect(justAboveAmount).toBeGreaterThan(bound)
    const justAbove: IntentConfig = {
      ...DEFAULT_INTENT,
      deposits,
      borrows: [{ stablecoin: 'USDC', amountUsd: justAboveAmount }],
    }
    const result = validateIntent(justAbove)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.code === 'private_equity_min_hf')).toBe(true)
  })
})

describe('RISK_PRESETS', () => {
  it('exposes conservative, balanced, and max presets', () => {
    expect(RISK_PRESETS.map(p => p.id)).toEqual(['conservative', 'balanced', 'max'])
    expect(RISK_PRESETS.find(p => p.id === 'conservative')?.targetHf).toBe(2.0)
    expect(RISK_PRESETS.find(p => p.id === 'balanced')?.targetHf).toBe(1.6)
    expect(RISK_PRESETS.find(p => p.id === 'max')?.targetHf).toBeUndefined()
  })
})

describe('validateIntent', () => {
  it('passes for the default intent', () => {
    expect(validateIntent(DEFAULT_INTENT).ok).toBe(true)
    expect(validateIntent(DEFAULT_INTENT).errors).toEqual([])
  })

  it('flags no_deposits when total deposits is zero', () => {
    const config: IntentConfig = { ...DEFAULT_INTENT, deposits: {}, borrows: [] }
    const result = validateIntent(config)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.code === 'no_deposits')).toBe(true)
  })

  it('flags borrow_exceeds_max_ltv when borrow exceeds the origination limit', () => {
    const config: IntentConfig = { ...DEFAULT_INTENT, borrows: [{ stablecoin: 'USDC', amountUsd: 9_000_000 }] }
    const result = validateIntent(config)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.code === 'borrow_exceeds_max_ltv')).toBe(true)
  })

  it('flags borrow_share_cap when a stablecoin exceeds its permitted share', () => {
    const config: IntentConfig = {
      ...DEFAULT_INTENT,
      borrows: [
        { stablecoin: 'USDC', amountUsd: 100_000 },
        { stablecoin: 'USDe', amountUsd: 900_000 },
      ],
    }
    const result = validateIntent(config)
    expect(result.ok).toBe(false)
    const violation = result.errors.find(e => e.code === 'borrow_share_cap')
    expect(violation).toBeDefined()
    expect(violation!.message).toMatch(/USDe/)
  })

  it('flags private_equity_min_hf when a SPACEX deposit is held and projected HF drops below 1.50', () => {
    const config: IntentConfig = { ...DEFAULT_INTENT, borrows: [{ stablecoin: 'USDC', amountUsd: 6_500_000 }] }

    // Confirm the scenario the spec calls for: within capacity, but HF < 1.5.
    const capacity = maxBorrowUsd(buildCollateralFromDeposits(config.deposits), HERO_UNDERLYINGS, MARKET)
    expect(6_500_000).toBeLessThan(capacity)
    const projected = projectIntentHf(config.deposits, config.borrows)
    expect(projected.healthFactor).toBeLessThan(1.5)

    const result = validateIntent(config)
    expect(result.ok).toBe(false)
    const violation = result.errors.find(e => e.code === 'private_equity_min_hf')
    expect(violation).toBeDefined()
    expect(violation!.message).toMatch(/1\.50/)
  })

  it('does not flag private_equity_min_hf when the SPACEX deposit is zero', () => {
    const config: IntentConfig = {
      ...DEFAULT_INTENT,
      deposits: { 'EQUITY:NVDA': 6_250_000, 'EQUITY:SPY': 3_750_000, 'EQUITY:AAPL': 2_500_000, 'EQUITY:SPACEX': 0 },
      borrows: [{ stablecoin: 'USDC', amountUsd: 6_500_000 }],
    }
    const result = validateIntent(config)
    expect(result.errors.some(e => e.code === 'private_equity_min_hf')).toBe(false)
  })

  it('flags usde_paused when USDe is borrowed while the peg is paused', () => {
    // HERO_USDE_PRICE never dips below the peg floor in this fixture, so the
    // paused state is simulated at the domain boundary to exercise the branch.
    const spy = vi.spyOn(stablecoinDomain, 'isBorrowPaused').mockReturnValue(true)
    try {
      const config: IntentConfig = {
        ...DEFAULT_INTENT,
        borrows: [{ stablecoin: 'USDe', amountUsd: 100_000 }],
      }
      const result = validateIntent(config)
      expect(result.ok).toBe(false)
      expect(result.errors.some(e => e.code === 'usde_paused')).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  it('does not flag usde_paused when there is no USDe borrow', () => {
    expect(HERO_USDE_PRICE).toBeGreaterThan(0.97)
    const config: IntentConfig = {
      ...DEFAULT_INTENT,
      borrows: [{ stablecoin: 'USDC', amountUsd: 1_000_000 }],
    }
    const result = validateIntent(config)
    expect(result.errors.some(e => e.code === 'usde_paused')).toBe(false)
  })
})

describe('RWA catalog integration', () => {
  it('gives every REAL_PROVIDER_TOKENS underlying a single 100%-share provider split', () => {
    for (const token of REAL_PROVIDER_TOKENS) {
      const splits = PROVIDER_SPLITS[token.underlyingId]
      expect(splits).toHaveLength(1)
      expect(splits[0].share).toBe(1)
      expect(splits[0].token.address).toBe(token.address)
    }
  })

  it('buildCollateralFromDeposits produces a single fresh-priced position for a treasury deposit', () => {
    const built = buildCollateralFromDeposits({ 'RWA:MTBILL': 1_000_000 })
    expect(built).toHaveLength(1)
    expect(built[0].token.underlyingId).toBe('RWA:MTBILL')
    expect(built[0].token.address).toBe(MTBILL_ADDRESS.toLowerCase())
    expect(built[0].quantity * built[0].priceUsd).toBeCloseTo(1_000_000, 6)
    expect(built[0].priceAsOf).toBe(HERO_NOW)
  })

  it('validateIntent passes for a treasury-only deposit with no borrow', () => {
    const config: IntentConfig = { ...DEFAULT_INTENT, deposits: { 'RWA:MTBILL': 1_000_000 }, borrows: [] }
    const result = validateIntent(config)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('projectIntentHf resolves the treasury tier internally for an RWA-only deposit with debt', () => {
    // BUIDL: provider score 5 → base treasury liquidationThreshold (0.88) unmodified.
    const projected = projectIntentHf({ 'RWA:BUIDL': 2_000_000 }, [{ stablecoin: 'USDC', amountUsd: 1_000_000 }])
    expect(projected.healthFactor).toBeCloseTo((2_000_000 * 0.88) / 1_000_000, 6)
  })

  it('maxUsdcBorrowUsd returns the treasury origination capacity (no private-equity floor) for a BUIDL-only deposit', () => {
    // BUIDL: provider score 5 → base treasury maxLtv (0.80) unmodified.
    const bound = maxUsdcBorrowUsd({ 'RWA:BUIDL': 2_000_000 }, [])
    expect(bound).toBeCloseTo(2_000_000 * 0.8, 6)
  })
})
