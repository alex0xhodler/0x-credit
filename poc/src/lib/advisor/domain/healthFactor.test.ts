import { describe, expect, it } from 'vitest'
import {
  AGENT_INTERVENTION_HF,
  LIQUIDATION_HF,
  computeHealthFactor,
  hfStatus,
} from './healthFactor'
import type { CollateralPosition, DebtPosition, Underlying } from '../types'

const NOW = Date.UTC(2026, 6, 21, 12, 0, 0)

const NVDA: Underlying = { id: 'EQUITY:NVDA', symbol: 'NVDA', name: 'NVIDIA', tier: 'blue_chip' }
const underlyings = { [NVDA.id]: NVDA }

const bNVDA = (score: 1 | 2 | 3 | 4 | 5): CollateralPosition['token'] => ({
  address: '0xbnvda',
  underlyingId: NVDA.id,
  issuer: 'Backed Finance',
  providerRiskScore: score,
  liquidityTier: 'high',
  redemptionType: 'direct',
  usesNavFeed: false,
})

const collateral = (score: 1 | 2 | 3 | 4 | 5, valueUsd: number): CollateralPosition => ({
  token: bNVDA(score),
  quantity: valueUsd / 100,
  priceUsd: 100,
  priceAsOf: NOW,
})

const debt = (stablecoin: DebtPosition['stablecoin'], amount: number): DebtPosition => ({
  stablecoin,
  amount,
  priceUsd: 1,
})

const openMarket = { equityMarketOpen: true, now: NOW }

describe('computeHealthFactor', () => {
  it('returns Infinity when there is no debt', () => {
    const result = computeHealthFactor({
      collateral: [collateral(5, 100_000)],
      debts: [],
      underlyings,
      market: openMarket,
    })
    expect(result.healthFactor).toBe(Infinity)
    expect(result.effectiveDebtUsd).toBe(0)
  })

  it('computes HF = (collateral x liquidation threshold) / debt', () => {
    // Blue-chip score 5 → liq threshold 0.75. $100k collateral → risk-adjusted $75k.
    const result = computeHealthFactor({
      collateral: [collateral(5, 100_000)],
      debts: [debt('USDC', 50_000)],
      underlyings,
      market: openMarket,
    })
    expect(result.riskAdjustedCollateralUsd).toBeCloseTo(75_000, 4)
    expect(result.healthFactor).toBeCloseTo(1.5, 6)
  })

  it('reflects the USDe debt markup, lowering HF versus the same USDC debt', () => {
    const usdc = computeHealthFactor({
      collateral: [collateral(5, 100_000)],
      debts: [debt('USDC', 50_000)],
      underlyings,
      market: openMarket,
    })
    const usde = computeHealthFactor({
      collateral: [collateral(5, 100_000)],
      debts: [debt('USDe', 50_000)],
      underlyings,
      market: openMarket,
    })
    expect(usde.effectiveDebtUsd).toBeCloseTo(51_500, 4)
    expect(usde.healthFactor).toBeLessThan(usdc.healthFactor)
    expect(usde.healthFactor).toBeCloseTo(75_000 / 51_500, 6)
  })

  it('lowers HF when a lower provider score reduces the liquidation threshold', () => {
    const high = computeHealthFactor({
      collateral: [collateral(5, 100_000)],
      debts: [debt('USDC', 50_000)],
      underlyings,
      market: openMarket,
    })
    const low = computeHealthFactor({
      collateral: [collateral(2, 100_000)],
      debts: [debt('USDC', 50_000)],
      underlyings,
      market: openMarket,
    })
    expect(low.healthFactor).toBeLessThan(high.healthFactor)
  })

  it('drops HF when the market is closed and the collateral is haircut', () => {
    const closed = computeHealthFactor({
      collateral: [collateral(5, 100_000)],
      debts: [debt('USDC', 50_000)],
      underlyings,
      market: { equityMarketOpen: false, now: NOW },
    })
    // 5% collateral haircut → risk-adjusted 71,250 → HF 1.425.
    expect(closed.healthFactor).toBeCloseTo(1.425, 6)
  })

  it('per-token contributions sum to the risk-adjusted collateral total', () => {
    const result = computeHealthFactor({
      collateral: [collateral(5, 60_000), collateral(3, 40_000)],
      debts: [debt('USDC', 50_000)],
      underlyings,
      market: openMarket,
    })
    const summed = result.contributions.reduce((acc, c) => acc + c.weightedUsd, 0)
    expect(summed).toBeCloseTo(result.riskAdjustedCollateralUsd, 4)
  })
})

describe('hfStatus', () => {
  it('classifies against the liquidation and intervention thresholds', () => {
    expect(hfStatus(LIQUIDATION_HF - 0.01)).toBe('liquidatable')
    expect(hfStatus(AGENT_INTERVENTION_HF - 0.01)).toBe('warning')
    expect(hfStatus(AGENT_INTERVENTION_HF + 0.5)).toBe('healthy')
    expect(hfStatus(Infinity)).toBe('healthy')
  })
})
