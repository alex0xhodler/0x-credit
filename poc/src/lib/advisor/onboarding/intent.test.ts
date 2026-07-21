import { describe, expect, it, vi } from 'vitest'
import {
  buildCollateralFromIntent,
  buildDebtsFromIntent,
  DEFAULT_INTENT,
  maxBorrowUsd,
  projectIntentHf,
  validateIntent,
  type IntentConfig,
} from './intent'
import { assessPosition } from '../agent/engine'
import * as stablecoinDomain from '../domain/stablecoin'
import { HERO_COLLATERAL, HERO_DEBTS, HERO_NOW, HERO_STATE, HERO_UNDERLYINGS, HERO_USDE_PRICE } from '../fixtures/heroScenario'
import type { CollateralPosition } from '../types'

const MARKET = { equityMarketOpen: true, now: HERO_NOW }

function byAddress(positions: readonly CollateralPosition[]) {
  return [...positions].sort((a, b) => a.token.address.localeCompare(b.token.address))
}

describe('buildCollateralFromIntent', () => {
  it('reproduces HERO_COLLATERAL exactly for the default basket (order-insensitive)', () => {
    const built = buildCollateralFromIntent(DEFAULT_INTENT.weights, DEFAULT_INTENT.totalCollateralUsd)
    expect(byAddress(built)).toEqual(byAddress(HERO_COLLATERAL))
  })

  it('skips underlyings with zero weight', () => {
    const built = buildCollateralFromIntent(
      { 'EQUITY:NVDA': 1, 'EQUITY:SPY': 0, 'EQUITY:AAPL': 0, 'EQUITY:SPACEX': 0 },
      1_000_000,
    )
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

describe('maxBorrowUsd', () => {
  it('computes the origination limit for the default basket as $8,115,000', () => {
    const collateral = buildCollateralFromIntent(DEFAULT_INTENT.weights, DEFAULT_INTENT.totalCollateralUsd)
    const capacity = maxBorrowUsd(collateral, HERO_UNDERLYINGS, MARKET)
    expect(Math.abs(capacity - 8_115_000)).toBeLessThanOrEqual(1)
  })
})

describe('projectIntentHf', () => {
  it('matches assessPosition healthFactor on the hero fixture for the default intent', () => {
    const projected = projectIntentHf(DEFAULT_INTENT.weights, DEFAULT_INTENT.totalCollateralUsd, DEFAULT_INTENT.borrows)
    const hero = assessPosition(HERO_STATE)
    expect(projected.healthFactor).toBeCloseTo(hero.healthFactor, 9)
  })
})

describe('validateIntent', () => {
  it('passes for the default intent', () => {
    expect(validateIntent(DEFAULT_INTENT).ok).toBe(true)
    expect(validateIntent(DEFAULT_INTENT).errors).toEqual([])
  })

  it('flags weights_not_100 when weights do not sum to 100%', () => {
    const config: IntentConfig = { ...DEFAULT_INTENT, weights: { ...DEFAULT_INTENT.weights, 'EQUITY:NVDA': 0.5 } }
    const result = validateIntent(config)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.code === 'weights_not_100')).toBe(true)
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

  it('flags private_equity_min_hf when SPACEX weight is held and projected HF drops below 1.50', () => {
    const config: IntentConfig = { ...DEFAULT_INTENT, borrows: [{ stablecoin: 'USDC', amountUsd: 6_500_000 }] }

    // Confirm the scenario the spec calls for: within capacity, but HF < 1.5.
    const capacity = maxBorrowUsd(
      buildCollateralFromIntent(config.weights, config.totalCollateralUsd),
      HERO_UNDERLYINGS,
      MARKET,
    )
    expect(6_500_000).toBeLessThan(capacity)
    const projected = projectIntentHf(config.weights, config.totalCollateralUsd, config.borrows)
    expect(projected.healthFactor).toBeLessThan(1.5)

    const result = validateIntent(config)
    expect(result.ok).toBe(false)
    const violation = result.errors.find(e => e.code === 'private_equity_min_hf')
    expect(violation).toBeDefined()
    expect(violation!.message).toMatch(/1\.50/)
  })

  it('does not flag private_equity_min_hf when SPACEX weight is zero', () => {
    const config: IntentConfig = {
      ...DEFAULT_INTENT,
      weights: { 'EQUITY:NVDA': 0.5, 'EQUITY:SPY': 0.3, 'EQUITY:AAPL': 0.2, 'EQUITY:SPACEX': 0 },
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
