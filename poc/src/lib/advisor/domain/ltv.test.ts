import { describe, expect, it } from 'vitest'
import { BASE_LTV_TIERS, ltvParamsFor } from './ltv'

describe('ltvParamsFor', () => {
  it('returns the base tier unchanged for the highest provider score (5)', () => {
    expect(ltvParamsFor('blue_chip', 5)).toEqual({ maxLtv: 0.65, liquidationThreshold: 0.75 })
    expect(ltvParamsFor('index_etf', 5)).toEqual({ maxLtv: 0.75, liquidationThreshold: 0.82 })
    expect(ltvParamsFor('small_mid_cap', 5)).toEqual({ maxLtv: 0.5, liquidationThreshold: 0.62 })
    expect(ltvParamsFor('private_equity', 5)).toEqual({ maxLtv: 0.45, liquidationThreshold: 0.58 })
  })

  it('reduces max LTV by 3% and liquidation threshold by 2% per step below score 5', () => {
    // Blue-chip at score 4: one step down.
    expect(ltvParamsFor('blue_chip', 4)).toEqual({ maxLtv: 0.62, liquidationThreshold: 0.73 })
    // Blue-chip at score 1: four steps down.
    const s1 = ltvParamsFor('blue_chip', 1)
    expect(s1.maxLtv).toBeCloseTo(0.65 - 0.12, 10)
    expect(s1.liquidationThreshold).toBeCloseTo(0.75 - 0.08, 10)
  })

  it('keeps max LTV strictly below the liquidation threshold at every score', () => {
    const tiers = Object.keys(BASE_LTV_TIERS) as (keyof typeof BASE_LTV_TIERS)[]
    for (const tier of tiers) {
      for (const score of [1, 2, 3, 4, 5] as const) {
        const p = ltvParamsFor(tier, score)
        expect(p.maxLtv).toBeLessThan(p.liquidationThreshold)
      }
    }
  })

  it('never returns negative parameters', () => {
    const p = ltvParamsFor('private_equity', 1)
    expect(p.maxLtv).toBeGreaterThanOrEqual(0)
    expect(p.liquidationThreshold).toBeGreaterThanOrEqual(0)
  })
})
