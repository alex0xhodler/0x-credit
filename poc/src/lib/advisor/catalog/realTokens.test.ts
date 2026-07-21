import { describe, expect, it } from 'vitest'
import {
  BUIDL_ADDRESS,
  CATALOG_SOURCE,
  CATALOG_UNDERLYINGS,
  MBASIS_ADDRESS,
  MTBILL_ADDRESS,
  REAL_PROVIDER_TOKENS,
  REAL_UNDERLYINGS,
} from './realTokens'
import { ltvParamsFor } from '../domain/ltv'
import { HERO_UNDERLYINGS } from '../fixtures/heroScenario'

describe('realTokens catalog', () => {
  it('exposes the three verified mainnet addresses exactly as checksummed by the research pass', () => {
    expect(MTBILL_ADDRESS).toBe('0xDD629E5241CbC5919847783e6C96B2De4754e438')
    expect(MBASIS_ADDRESS).toBe('0x2a8c22E3b10036f3AEF5875d04f8441d4188b656')
    expect(BUIDL_ADDRESS).toBe('0x7712c34205737192402172409a8F7ccef8aA2AEc')
  })

  it('stores each provider token address lowercased, per the ProviderToken.address convention', () => {
    const mtbill = REAL_PROVIDER_TOKENS.find(t => t.underlyingId === 'RWA:MTBILL')
    const mbasis = REAL_PROVIDER_TOKENS.find(t => t.underlyingId === 'RWA:MBASIS')
    const buidl = REAL_PROVIDER_TOKENS.find(t => t.underlyingId === 'RWA:BUIDL')

    expect(mtbill?.address).toBe(MTBILL_ADDRESS.toLowerCase())
    expect(mbasis?.address).toBe(MBASIS_ADDRESS.toLowerCase())
    expect(buidl?.address).toBe(BUIDL_ADDRESS.toLowerCase())
  })

  it('every REAL_PROVIDER_TOKENS entry references an underlyingId present in REAL_UNDERLYINGS', () => {
    for (const token of REAL_PROVIDER_TOKENS) {
      expect(REAL_UNDERLYINGS[token.underlyingId]).toBeDefined()
    }
  })

  it('defines the three RWA underlyings on the treasury tier', () => {
    expect(REAL_UNDERLYINGS['RWA:MTBILL']).toMatchObject({ symbol: 'mTBILL', tier: 'treasury' })
    expect(REAL_UNDERLYINGS['RWA:MBASIS']).toMatchObject({ symbol: 'mBASIS', tier: 'treasury' })
    expect(REAL_UNDERLYINGS['RWA:BUIDL']).toMatchObject({ symbol: 'BUIDL', tier: 'treasury' })
  })

  it('sets mBASIS riskier than mTBILL and BUIDL via provider risk score', () => {
    const mbasis = REAL_PROVIDER_TOKENS.find(t => t.underlyingId === 'RWA:MBASIS')
    const mtbill = REAL_PROVIDER_TOKENS.find(t => t.underlyingId === 'RWA:MTBILL')
    const buidl = REAL_PROVIDER_TOKENS.find(t => t.underlyingId === 'RWA:BUIDL')
    expect(mbasis?.providerRiskScore).toBeLessThan(mtbill!.providerRiskScore)
    expect(mbasis?.providerRiskScore).toBeLessThan(buidl!.providerRiskScore)
  })

  it('produces sane LTV params for the treasury tier at every provider score used in the catalog', () => {
    for (const token of REAL_PROVIDER_TOKENS) {
      const underlying = REAL_UNDERLYINGS[token.underlyingId]
      const params = ltvParamsFor(underlying.tier, token.providerRiskScore)
      expect(params.maxLtv).toBeLessThan(params.liquidationThreshold)
      expect(params.maxLtv).toBeGreaterThan(0)
    }
  })

  it('CATALOG_SOURCE covers every CATALOG_UNDERLYINGS key, RWA as gearbox_sdk and hero equities as illustrative', () => {
    for (const id of Object.keys(CATALOG_UNDERLYINGS)) {
      expect(CATALOG_SOURCE[id]).toBeDefined()
    }
    expect(CATALOG_SOURCE['RWA:MTBILL']).toBe('gearbox_sdk')
    expect(CATALOG_SOURCE['RWA:MBASIS']).toBe('gearbox_sdk')
    expect(CATALOG_SOURCE['RWA:BUIDL']).toBe('gearbox_sdk')
    for (const id of Object.keys(HERO_UNDERLYINGS)) {
      expect(CATALOG_SOURCE[id]).toBe('illustrative')
    }
  })

  it('CATALOG_UNDERLYINGS merges the hero equities and the RWA catalog', () => {
    expect(Object.keys(CATALOG_UNDERLYINGS).sort()).toEqual(
      [...Object.keys(HERO_UNDERLYINGS), ...Object.keys(REAL_UNDERLYINGS)].sort(),
    )
    expect(CATALOG_UNDERLYINGS['EQUITY:NVDA']).toEqual(HERO_UNDERLYINGS['EQUITY:NVDA'])
    expect(CATALOG_UNDERLYINGS['RWA:BUIDL']).toEqual(REAL_UNDERLYINGS['RWA:BUIDL'])
  })
})
