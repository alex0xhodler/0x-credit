import { describe, expect, it } from 'vitest'
import { SAME_ISSUER_CAP, computeReflexiveExposure } from './correlation'
import type { StablecoinIssuerBacking } from './correlation'
import type { CollateralPosition, DebtPosition, ProviderToken } from '../types'

const NOW = Date.UTC(2026, 6, 21, 12, 0, 0)
const market = { equityMarketOpen: true, now: NOW }

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

const debt = (stablecoin: DebtPosition['stablecoin'], amount: number): DebtPosition => ({
  stablecoin,
  amount,
  priceUsd: 1,
})

// USDe partly backed by Securitize credit (the closed-loop premise).
const usdeBackedBySecuritize: StablecoinIssuerBacking[] = [
  { stablecoin: 'USDe', issuer: 'Securitize', reserveShare: 0.2 },
]

describe('computeReflexiveExposure', () => {
  it('flags a reflexive loop when the collateral issuer also backs the borrowed stablecoin', () => {
    const warnings = computeReflexiveExposure({
      collateral: [pos(token('0xsec', 'EQUITY:NVDA', 'Securitize'), 5_000_000)],
      debts: [debt('USDe', 2_000_000)],
      backings: usdeBackedBySecuritize,
      market,
    })
    const sec = warnings.find(w => w.issuer === 'Securitize')
    expect(sec).toBeDefined()
    expect(sec!.reflexive).toBe(true)
    expect(sec!.collateralUsd).toBeCloseTo(5_000_000, 2)
    // 2M USDe debt × 1.03 markup × 20% reserve share.
    expect(sec!.stablecoinBackingUsd).toBeCloseTo(2_000_000 * 1.03 * 0.2, 2)
  })

  it('does not flag when collateral and stablecoin backing come from different issuers', () => {
    const warnings = computeReflexiveExposure({
      collateral: [pos(token('0xbacked', 'EQUITY:NVDA', 'Backed Finance'), 5_000_000)],
      debts: [debt('USDe', 2_000_000)],
      backings: usdeBackedBySecuritize,
      market,
    })
    expect(warnings.some(w => w.reflexive)).toBe(false)
  })

  it('flags a single-issuer footprint above the cap even without a reflexive loop', () => {
    // Entire collateral book from one issuer, no matching stablecoin backing.
    const warnings = computeReflexiveExposure({
      collateral: [pos(token('0xsec', 'EQUITY:NVDA', 'Securitize'), 5_000_000)],
      debts: [debt('USDC', 1_000_000)],
      backings: [],
      market,
    })
    const sec = warnings.find(w => w.issuer === 'Securitize')
    expect(sec?.breached).toBe(true)
    expect(sec!.footprintShare).toBeGreaterThan(SAME_ISSUER_CAP)
    expect(sec!.reflexive).toBe(false)
  })

  it('returns nothing for a diversified book within the cap', () => {
    const warnings = computeReflexiveExposure({
      collateral: [
        pos(token('0xa', 'EQUITY:NVDA', 'Backed Finance'), 3_000_000),
        pos(token('0xb', 'EQUITY:SPY', 'Ondo'), 3_000_000),
        pos(token('0xc', 'EQUITY:AAPL', 'Kraken'), 3_000_000),
      ],
      debts: [debt('USDC', 4_000_000)],
      backings: usdeBackedBySecuritize,
      market,
    })
    expect(warnings).toEqual([])
  })

  it('sorts warnings by footprint share, largest first', () => {
    const warnings = computeReflexiveExposure({
      collateral: [
        pos(token('0xsec', 'EQUITY:NVDA', 'Securitize'), 6_000_000),
        pos(token('0xondo', 'EQUITY:SPY', 'Ondo'), 4_000_000),
      ],
      debts: [debt('USDe', 3_000_000)],
      backings: [
        { stablecoin: 'USDe', issuer: 'Securitize', reserveShare: 0.2 },
        { stablecoin: 'USDe', issuer: 'Ondo', reserveShare: 0.2 },
      ],
      market,
    })
    expect(warnings.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < warnings.length; i++) {
      expect(warnings[i - 1].footprintShare).toBeGreaterThanOrEqual(warnings[i].footprintShare)
    }
  })
})
