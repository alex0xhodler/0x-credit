import { describe, expect, it } from 'vitest'
import {
  MARKET_HOURS_HAIRCUT,
  NAV_STALE_MS,
  STALE_NAV_HAIRCUT,
  collateralValueUsd,
} from './collateralValue'
import type { CollateralPosition, MarketContext, ProviderToken } from '../types'

const NOW = Date.UTC(2026, 6, 21, 12, 0, 0)

const publicToken: ProviderToken = {
  address: '0xbnvda',
  underlyingId: 'EQUITY:NVDA',
  issuer: 'Backed Finance',
  providerRiskScore: 5,
  liquidityTier: 'high',
  redemptionType: 'direct',
  usesNavFeed: false,
}

const navToken: ProviderToken = {
  address: '0xspacex',
  underlyingId: 'EQUITY:SPACEX',
  issuer: 'Specialist RWA Co',
  providerRiskScore: 3,
  liquidityTier: 'low',
  redemptionType: 'private_placement',
  usesNavFeed: true,
}

const position = (token: ProviderToken, priceAsOf: number): CollateralPosition => ({
  token,
  quantity: 1000,
  priceUsd: 100,
  priceAsOf,
})

const market = (equityMarketOpen: boolean): MarketContext => ({ equityMarketOpen, now: NOW })

describe('collateralValueUsd', () => {
  it('values a public token at face when the equity market is open', () => {
    const result = collateralValueUsd(position(publicToken, NOW), market(true))
    expect(result.valueUsd).toBeCloseTo(100_000, 6)
    expect(result.haircutsApplied).toEqual([])
  })

  it('applies a 5% market-hours haircut to public tokens when the market is closed', () => {
    const result = collateralValueUsd(position(publicToken, NOW), market(false))
    expect(result.valueUsd).toBeCloseTo(100_000 * (1 - MARKET_HOURS_HAIRCUT), 6)
    expect(result.haircutsApplied).toContain('market_hours')
  })

  it('does not apply the market-hours haircut to NAV-priced private tokens', () => {
    const result = collateralValueUsd(position(navToken, NOW), market(false))
    expect(result.haircutsApplied).not.toContain('market_hours')
    expect(result.valueUsd).toBeCloseTo(100_000, 6)
  })

  it('applies a 10% haircut when a NAV feed is stale beyond 24h', () => {
    const stale = NOW - NAV_STALE_MS - 1
    const result = collateralValueUsd(position(navToken, stale), market(true))
    expect(result.valueUsd).toBeCloseTo(100_000 * (1 - STALE_NAV_HAIRCUT), 6)
    expect(result.haircutsApplied).toContain('stale_nav')
  })

  it('does not haircut a fresh NAV feed', () => {
    const result = collateralValueUsd(position(navToken, NOW - 1000), market(true))
    expect(result.haircutsApplied).toEqual([])
    expect(result.valueUsd).toBeCloseTo(100_000, 6)
  })

  it('exposes the raw pre-haircut value alongside the adjusted value', () => {
    const result = collateralValueUsd(position(publicToken, NOW), market(false))
    expect(result.rawValueUsd).toBeCloseTo(100_000, 6)
    expect(result.valueUsd).toBeLessThan(result.rawValueUsd)
  })
})
