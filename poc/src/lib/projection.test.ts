import { describe, expect, it } from 'vitest'
import { buildProjection } from './projection'

describe('buildProjection', () => {
  it('starts at the deposit amount at month 0', () => {
    const points = buildProjection({ deposit: 3, apyPercent: 70, years: 1 })
    expect(points[0].month).toBe(0)
    expect(points[0].amplified).toBeCloseTo(3, 5)
  })

  it('compounds amplified balance correctly over 1 year at 100% APY', () => {
    const points = buildProjection({ deposit: 1, apyPercent: 100, years: 1 })
    const last = points[points.length - 1]
    expect(last.month).toBe(12)
    // continuous compound: e^1 ≈ 2.718; annual compound: 2.0 — we use annual compound
    expect(last.amplified).toBeCloseTo(2, 1)
  })

  it('amplified balance is always greater than plain when both present', () => {
    const points = buildProjection({ deposit: 3, apyPercent: 70, baseApyPercent: 5, years: 3 })
    for (const p of points.slice(1)) {
      expect(p.amplified).toBeGreaterThan(p.plain ?? 0)
    }
  })

  it('omits plain field when baseApyPercent is not provided', () => {
    const points = buildProjection({ deposit: 3, apyPercent: 70, years: 1 })
    for (const p of points) {
      expect(p.plain).toBeUndefined()
    }
  })

  it('produces the correct number of monthly data points for each horizon', () => {
    expect(buildProjection({ deposit: 3, apyPercent: 50, years: 1 })).toHaveLength(13) // 0..12
    expect(buildProjection({ deposit: 3, apyPercent: 50, years: 3 })).toHaveLength(37) // 0..36
    expect(buildProjection({ deposit: 3, apyPercent: 50, years: 5 })).toHaveLength(61) // 0..60
  })

  it('returns just the deposit when APY is zero', () => {
    const points = buildProjection({ deposit: 5, apyPercent: 0, years: 1 })
    for (const p of points) {
      expect(p.amplified).toBeCloseTo(5, 5)
    }
  })

  it('pessimistic scenario is always below the base amplified projection after month 0', () => {
    const points = buildProjection({ deposit: 3, apyPercent: 70, years: 1 })
    for (const p of points.slice(1)) {
      expect(p.pessimistic).toBeLessThan(p.amplified)
    }
  })

  it('band is zero at month 0 and grows positive thereafter', () => {
    const points = buildProjection({ deposit: 3, apyPercent: 70, years: 1 })
    expect(points[0].band).toBeCloseTo(0, 5)
    for (const p of points.slice(1)) {
      expect(p.band).toBeGreaterThan(0)
    }
  })

  it('all scenarios start exactly at the deposit', () => {
    const points = buildProjection({ deposit: 5, apyPercent: 50, years: 3 })
    expect(points[0].pessimistic).toBeCloseTo(5, 5)
    expect(points[0].band).toBeCloseTo(0, 5)
  })
})
