import { describe, expect, it } from 'vitest'
import { buildProjection, buildYieldComparisonProjection } from './projection'
import { buildBalanceTimeline } from './comparisonTimeline'

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

  it('normalizes every forward comparison to the same ETH-equivalent starting value', () => {
    const points = buildYieldComparisonProjection({
      months: 1,
      series: [
        { id: 'strategy', apyPercent: 24 },
        { id: 'weth', apyPercent: 0 },
        { id: 'lst', apyPercent: 3 },
      ],
    })

    expect(points[0]).toMatchObject({ month: 0, strategy: 1, weth: 1, lst: 1 })
    const last = points[points.length - 1]
    expect(last?.strategy).toBeGreaterThan(last?.lst ?? 0)
    expect(last?.lst).toBeGreaterThan(last?.weth ?? 0)
  })

  it('uses daily points for one month and monthly points for longer periods', () => {
    const series = [{ id: 'strategy', apyPercent: 10 }]

    expect(buildYieldComparisonProjection({ months: 1, series })).toHaveLength(31)
    expect(buildYieldComparisonProjection({ months: 6, series })).toHaveLength(7)
    expect(buildYieldComparisonProjection({ months: 12, series })).toHaveLength(13)
  })

  it('continues a minimum-deposit history into the forward half of the chart', () => {
    const points = buildBalanceTimeline({
      startingBalance: 2.92,
      strategyApyPercent: 12,
      horizon: 1,
      benchmarks: [],
      now: Date.UTC(2026, 6, 13),
    })

    expect(points[0]).toMatchObject({ time: -30, weth: 2.92 })
    expect(points.find(point => point.time === 0)?.weth).toBeCloseTo(2.92, 8)
    expect(points[points.length - 1]).toMatchObject({ time: 30, weth: 2.92 })
  })
})
