import { describe, expect, it } from 'vitest'
import {
  adjustUnderlyingValue,
  applyRepayment,
  rotateExposure,
  underlyingRawValueUsd,
} from './rebalance'
import type { CollateralPosition, DebtPosition, ProviderToken } from '../types'

const NOW = Date.UTC(2026, 6, 21, 12, 0, 0)

const token = (address: string, underlyingId: string): ProviderToken => ({
  address,
  underlyingId,
  issuer: 'Backed Finance',
  providerRiskScore: 5,
  liquidityTier: 'high',
  redemptionType: 'direct',
  usesNavFeed: false,
})

const pos = (t: ProviderToken, valueUsd: number): CollateralPosition => ({
  token: t,
  quantity: valueUsd / 100,
  priceUsd: 100,
  priceAsOf: NOW,
})

const bNVDA = token('0xbnvda', 'EQUITY:NVDA')
const oNVDA = token('0xonvda', 'EQUITY:NVDA')
const bSPY = token('0xbspy', 'EQUITY:SPY')

describe('adjustUnderlyingValue', () => {
  it('reduces an underlying pro-rata across its provider tokens', () => {
    const collateral = [pos(bNVDA, 30_000), pos(oNVDA, 10_000), pos(bSPY, 60_000)]
    const next = adjustUnderlyingValue(collateral, 'EQUITY:NVDA', -20_000)
    expect(underlyingRawValueUsd(next, 'EQUITY:NVDA')).toBeCloseTo(20_000, 4)
    // 75/25 split preserved.
    expect(next.find(p => p.token.address === '0xbnvda')!.quantity * 100).toBeCloseTo(15_000, 4)
    expect(next.find(p => p.token.address === '0xonvda')!.quantity * 100).toBeCloseTo(5_000, 4)
    // SPY untouched.
    expect(underlyingRawValueUsd(next, 'EQUITY:SPY')).toBeCloseTo(60_000, 4)
  })

  it('never drives an underlying below zero', () => {
    const collateral = [pos(bNVDA, 10_000)]
    const next = adjustUnderlyingValue(collateral, 'EQUITY:NVDA', -50_000)
    expect(underlyingRawValueUsd(next, 'EQUITY:NVDA')).toBeCloseTo(0, 6)
  })

  it('does not mutate the input array', () => {
    const collateral = [pos(bNVDA, 10_000)]
    adjustUnderlyingValue(collateral, 'EQUITY:NVDA', -5_000)
    expect(collateral[0].quantity * 100).toBeCloseTo(10_000, 6)
  })
})

describe('rotateExposure', () => {
  it('moves value between underlyings while holding total collateral constant', () => {
    const collateral = [pos(bNVDA, 40_000), pos(bSPY, 60_000)]
    const next = rotateExposure(collateral, 'EQUITY:NVDA', 'EQUITY:SPY', 15_000)
    expect(underlyingRawValueUsd(next, 'EQUITY:NVDA')).toBeCloseTo(25_000, 4)
    expect(underlyingRawValueUsd(next, 'EQUITY:SPY')).toBeCloseTo(75_000, 4)
    const total = next.reduce((a, p) => a + p.quantity * p.priceUsd, 0)
    expect(total).toBeCloseTo(100_000, 4)
  })
})

describe('applyRepayment', () => {
  const debts: DebtPosition[] = [
    { stablecoin: 'USDC', amount: 500_000, priceUsd: 1 },
    { stablecoin: 'USDe', amount: 200_000, priceUsd: 1 },
  ]

  it('reduces the targeted stablecoin only', () => {
    const next = applyRepayment(debts, 'USDe', 50_000)
    expect(next.find(d => d.stablecoin === 'USDe')!.amount).toBeCloseTo(150_000, 4)
    expect(next.find(d => d.stablecoin === 'USDC')!.amount).toBeCloseTo(500_000, 4)
  })

  it('caps repayment at the outstanding amount', () => {
    const next = applyRepayment(debts, 'USDe', 999_999_999)
    expect(next.find(d => d.stablecoin === 'USDe')!.amount).toBeCloseTo(0, 6)
  })
})
