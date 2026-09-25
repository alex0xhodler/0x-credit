import { calcNetStrategyApy } from '@gearbox-protocol/sdk/onchain'
import { describe, expect, it } from 'vitest'
import { buildNavBacktestSeries, buildStrategyBacktestSeries, type StrategyApyChartBundle } from './strategyBacktest'

const LT = 9000
const LEVERAGE = 7.36

function okBundle(overrides: Partial<StrategyApyChartBundle['series']> = {}): StrategyApyChartBundle {
  return {
    timestamps: [1_700_000_000, 1_700_086_400, 1_700_172_800],
    series: {
      collateralApy: { status: 'ok', unit: 'bps', values: [1200, 1250, null] },
      borrowApy: { status: 'ok', unit: 'bps', values: [500, 510, 520] },
      quotaRate: { status: 'ok', unit: 'bps', values: [90, 90, 90] },
      ...overrides,
    },
  }
}

describe('buildStrategyBacktestSeries', () => {
  it('computes daily net apy via calcNetStrategyApy, in percent, for days with no nulls', () => {
    const points = buildStrategyBacktestSeries(okBundle(), LT, LEVERAGE)
    expect(points).toBeDefined()

    const expectedDay0 = calcNetStrategyApy({ borrowApy: 500, quotaRate: 90, liquidationThreshold: LT }, 1200, LEVERAGE, 'aggressive') / 100
    expect(points![0].apy).toBeCloseTo(expectedDay0, 6)
    expect(points![0].timestamp).toBe(new Date(1_700_000_000 * 1000).toISOString())
  })

  it('skips (nulls out) a day where any of the three series is null', () => {
    const points = buildStrategyBacktestSeries(okBundle(), LT, LEVERAGE)
    expect(points![2].apy).toBeNull()
  })

  it('returns undefined when any series is unavailable', () => {
    const bundle = okBundle({ borrowApy: { status: 'unavailable', reason: { code: 'not_indexed' } } })
    expect(buildStrategyBacktestSeries(bundle, LT, LEVERAGE)).toBeUndefined()
  })
})

describe('buildNavBacktestSeries', () => {
  const segments = [
    { timestamp: 1_700_000_000, apyBps: 630 },
    { timestamp: 1_700_086_400, apyBps: 700 },
  ]
  const currentRates = { borrowApyBps: 600, quotaRateBps: 80 }

  it('uses the matching day from the gearbox rates chart when one exists', () => {
    const chart = {
      timestamps: [1_700_000_000, 1_700_086_400],
      borrowApy: { status: 'ok' as const, unit: 'bps', values: [500, 510] },
      quotaRate: { status: 'ok' as const, unit: 'bps', values: [90, 95] },
    }

    const points = buildNavBacktestSeries(segments, chart, LT, LEVERAGE, currentRates)

    const expected0 = calcNetStrategyApy({ borrowApy: 500, quotaRate: 90, liquidationThreshold: LT }, 630, LEVERAGE, 'aggressive') / 100
    expect(points[0].apy).toBeCloseTo(expected0, 6)
    expect(points[0].timestamp).toBe(new Date(1_700_000_000 * 1000).toISOString())
  })

  it('falls back to the current borrow/quota rates for a segment the chart does not cover', () => {
    const points = buildNavBacktestSeries(segments, undefined, LT, LEVERAGE, currentRates)

    const expected0 = calcNetStrategyApy(
      { borrowApy: currentRates.borrowApyBps, quotaRate: currentRates.quotaRateBps, liquidationThreshold: LT },
      630,
      LEVERAGE,
      'aggressive',
    ) / 100
    expect(points[0].apy).toBeCloseTo(expected0, 6)
  })

  it('falls back to current rates for a day null in the chart, without dropping the segment', () => {
    const chart = {
      timestamps: [1_700_000_000, 1_700_086_400],
      borrowApy: { status: 'ok' as const, unit: 'bps', values: [null, 510] },
      quotaRate: { status: 'ok' as const, unit: 'bps', values: [null, 95] },
    }

    const points = buildNavBacktestSeries(segments, chart, LT, LEVERAGE, currentRates)

    const expected0 = calcNetStrategyApy(
      { borrowApy: currentRates.borrowApyBps, quotaRate: currentRates.quotaRateBps, liquidationThreshold: LT },
      630,
      LEVERAGE,
      'aggressive',
    ) / 100
    expect(points[0].apy).toBeCloseTo(expected0, 6)
  })

  it('never emits a null point — nav segments always have a collateral apy', () => {
    const points = buildNavBacktestSeries(segments, undefined, LT, LEVERAGE, currentRates)
    expect(points.every(p => p.apy !== null)).toBe(true)
  })
})
