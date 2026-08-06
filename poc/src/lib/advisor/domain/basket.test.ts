import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DRIFT_BAND,
  PROVIDER_CONCENTRATION_THRESHOLD,
  aggregateBasket,
  driftReport,
  providerConcentrationWarnings,
} from './basket'
import type { CollateralPosition, ProviderToken } from '../types'

const NOW = Date.UTC(2026, 6, 21, 12, 0, 0)
const openMarket = { equityMarketOpen: true, now: NOW }

const token = (address: string, underlyingId: string, issuer: string): ProviderToken => ({
  address,
  underlyingId,
  issuer,
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

// NVDA split across two providers; SPY from one.
const bNVDA = token('0xbnvda', 'EQUITY:NVDA', 'Backed Finance')
const oNVDA = token('0xonvda', 'EQUITY:NVDA', 'Ondo')
const bSPY = token('0xbspy', 'EQUITY:SPY', 'Backed Finance')

describe('aggregateBasket', () => {
  it('collapses multiple provider tokens for the same underlying into one position', () => {
    const { byUnderlying, total } = aggregateBasket(
      [pos(bNVDA, 30_000), pos(oNVDA, 10_000), pos(bSPY, 60_000)],
      openMarket,
    )
    expect(total).toBeCloseTo(100_000, 4)

    const nvda = byUnderlying.find(u => u.underlyingId === 'EQUITY:NVDA')!
    expect(nvda.valueUsd).toBeCloseTo(40_000, 4)
    expect(nvda.weight).toBeCloseTo(0.4, 6)
    expect(nvda.providers).toHaveLength(2)
  })

  it('reports each provider share within an underlying', () => {
    const { byUnderlying } = aggregateBasket([pos(bNVDA, 30_000), pos(oNVDA, 10_000)], openMarket)
    const nvda = byUnderlying.find(u => u.underlyingId === 'EQUITY:NVDA')!
    const backed = nvda.providers.find(p => p.issuer === 'Backed Finance')!
    expect(backed.shareOfUnderlying).toBeCloseTo(0.75, 6)
    expect(nvda.topProviderShare).toBeCloseTo(0.75, 6)
  })

  it('returns an empty aggregate for no collateral', () => {
    const { byUnderlying, total } = aggregateBasket([], openMarket)
    expect(total).toBe(0)
    expect(byUnderlying).toEqual([])
  })
})

describe('driftReport', () => {
  it('flags an underlying that has drifted beyond the band', () => {
    const { byUnderlying } = aggregateBasket([pos(bNVDA, 50_000), pos(bSPY, 50_000)], openMarket)
    // Target 40% NVDA but currently 50% → +10% drift, beyond the 5% band.
    const report = driftReport(byUnderlying, { 'EQUITY:NVDA': 0.4, 'EQUITY:SPY': 0.6 }, DEFAULT_DRIFT_BAND)
    const nvda = report.find(r => r.underlyingId === 'EQUITY:NVDA')!
    expect(nvda.drift).toBeCloseTo(0.1, 6)
    expect(nvda.breached).toBe(true)
    const spy = report.find(r => r.underlyingId === 'EQUITY:SPY')!
    expect(spy.breached).toBe(true)
  })

  it('does not flag an underlying within the band', () => {
    const { byUnderlying } = aggregateBasket([pos(bNVDA, 42_000), pos(bSPY, 58_000)], openMarket)
    const report = driftReport(byUnderlying, { 'EQUITY:NVDA': 0.4, 'EQUITY:SPY': 0.6 }, DEFAULT_DRIFT_BAND)
    expect(report.find(r => r.underlyingId === 'EQUITY:NVDA')!.breached).toBe(false)
  })
})

describe('providerConcentrationWarnings', () => {
  it('warns when a single provider exceeds the concentration threshold for an underlying', () => {
    // 80% of NVDA via Backed → beyond the 60% threshold.
    const { byUnderlying } = aggregateBasket([pos(bNVDA, 80_000), pos(oNVDA, 20_000)], openMarket)
    const warnings = providerConcentrationWarnings(byUnderlying, PROVIDER_CONCENTRATION_THRESHOLD)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].underlyingId).toBe('EQUITY:NVDA')
    expect(warnings[0].topProviderShare).toBeCloseTo(0.8, 6)
  })

  it('does not warn on a diversified underlying', () => {
    const { byUnderlying } = aggregateBasket([pos(bNVDA, 50_000), pos(oNVDA, 50_000)], openMarket)
    expect(providerConcentrationWarnings(byUnderlying, PROVIDER_CONCENTRATION_THRESHOLD)).toEqual([])
  })
})
