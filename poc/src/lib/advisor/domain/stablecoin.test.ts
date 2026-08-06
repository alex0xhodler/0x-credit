import { describe, expect, it } from 'vitest'
import {
  STABLECOIN_CONFIG,
  USDE_PEG_FLOOR,
  effectiveDebtValueUsd,
  isBorrowPaused,
  validateBorrowShares,
} from './stablecoin'
import type { DebtPosition } from '../types'

const debt = (stablecoin: DebtPosition['stablecoin'], amount: number, priceUsd = 1): DebtPosition => ({
  stablecoin,
  amount,
  priceUsd,
})

describe('effectiveDebtValueUsd', () => {
  it('values USDC and USDT debt at face (no haircut)', () => {
    expect(effectiveDebtValueUsd(debt('USDC', 1_000_000))).toBeCloseTo(1_000_000, 6)
    expect(effectiveDebtValueUsd(debt('USDT', 1_000_000))).toBeCloseTo(1_000_000, 6)
  })

  it('marks USDe debt up by 3% to reflect peg/de-peg risk', () => {
    expect(effectiveDebtValueUsd(debt('USDe', 1_000_000))).toBeCloseTo(1_030_000, 6)
  })

  it('honours the stablecoin oracle price', () => {
    // USDe trading at 0.98 with the 3% conservatism markup on top.
    expect(effectiveDebtValueUsd(debt('USDe', 1_000_000, 0.98))).toBeCloseTo(1_000_000 * 0.98 * 1.03, 6)
  })
})

describe('isBorrowPaused', () => {
  it('never pauses USDC or USDT', () => {
    expect(isBorrowPaused('USDC', 0.5)).toBe(false)
    expect(isBorrowPaused('USDT', 0.5)).toBe(false)
  })

  it('pauses USDe borrowing when its price falls below the peg floor', () => {
    expect(isBorrowPaused('USDe', USDE_PEG_FLOOR - 0.001)).toBe(true)
    expect(isBorrowPaused('USDe', USDE_PEG_FLOOR)).toBe(false)
    expect(isBorrowPaused('USDe', 1.0)).toBe(false)
  })
})

describe('validateBorrowShares', () => {
  it('accepts an all-USDC book (USDC is uncapped)', () => {
    const result = validateBorrowShares([debt('USDC', 5_000_000)])
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('flags a USDe share above its 40% cap', () => {
    // 50% USDe / 50% USDC — USDe exceeds its 40% ceiling.
    const result = validateBorrowShares([debt('USDe', 500_000), debt('USDC', 500_000)])
    expect(result.ok).toBe(false)
    expect(result.violations.map(v => v.stablecoin)).toContain('USDe')
  })

  it('accepts a USDT share exactly at its 60% cap', () => {
    const result = validateBorrowShares([debt('USDT', 600_000), debt('USDC', 400_000)])
    expect(result.ok).toBe(true)
  })

  it('treats an empty book as valid', () => {
    expect(validateBorrowShares([]).ok).toBe(true)
  })
})

describe('STABLECOIN_CONFIG', () => {
  it('orders risk tiers USDC < USDT < USDe', () => {
    expect(STABLECOIN_CONFIG.USDC.riskTier).toBeLessThan(STABLECOIN_CONFIG.USDT.riskTier)
    expect(STABLECOIN_CONFIG.USDT.riskTier).toBeLessThan(STABLECOIN_CONFIG.USDe.riskTier)
  })
})
