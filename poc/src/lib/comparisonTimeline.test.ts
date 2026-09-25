import { describe, expect, it } from 'vitest'
import { buildBalanceTimeline } from './comparisonTimeline'
import type { YieldBenchmark } from './defillamaYields'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 8, 24)

function isoDaysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString()
}

const lstBenchmark: YieldBenchmark = {
  id: 'lst',
  label: 'LST · Lido stETH',
  sourceLabel: 'DefiLlama · Lido',
  sourceUrl: 'https://example.com',
  apyPercent: 3,
  history: [
    { timestamp: isoDaysAgo(2), apy: 3 },
    { timestamp: isoDaysAgo(1), apy: 3 },
  ],
}

describe('buildBalanceTimeline — strategy history', () => {
  it('compounds the past strategy line from a real leveraged back-test', () => {
    const points = buildBalanceTimeline({
      startingBalance: 100,
      horizon: 1,
      strategyApyPercent: 50,
      strategyHistory: [
        { timestamp: isoDaysAgo(2), apy: 36.5 }, // ~0.1%/day
        { timestamp: isoDaysAgo(1), apy: 36.5 },
      ],
      benchmarks: [],
      now: NOW,
    })

    const dayMinus2 = points.find(p => p.time === -2)!
    const dayMinus1 = points.find(p => p.time === -1)!
    const dayZero = points.find(p => p.time === 0)!

    // Day -2 is the first history point: it's the baseline, not yet compounded.
    expect(dayMinus2.strategy).toBe(100)
    expect(dayMinus1.strategy).toBeGreaterThan(dayMinus2.strategy!)
    expect(dayZero.strategy).toBeGreaterThan(dayMinus1.strategy!)
  })

  it('skips null days in the back-test without breaking compounding around them', () => {
    const points = buildBalanceTimeline({
      startingBalance: 100,
      horizon: 1,
      strategyApyPercent: 50,
      strategyHistory: [
        { timestamp: isoDaysAgo(2), apy: 36.5 },
        { timestamp: isoDaysAgo(1), apy: null },
      ],
      benchmarks: [],
      now: NOW,
    })

    const dayMinus1 = points.find(p => p.time === -1)!
    const dayZero = points.find(p => p.time === 0)!
    // No new rate on day -1, so day 0 carries the last known rate (day -2's) forward.
    expect(dayZero.strategy).toBeGreaterThan(dayMinus1.strategy!)
  })

  it('renders no past strategy line when there is no back-test, but still projects the future', () => {
    const points = buildBalanceTimeline({
      startingBalance: 100,
      horizon: 1,
      strategyApyPercent: 50,
      benchmarks: [],
      now: NOW,
    })

    const past = points.filter(p => p.time < 0)
    const future = points.filter(p => p.time > 0)

    expect(past.every(p => p.strategy === undefined)).toBe(true)
    expect(future.every(p => typeof p.strategy === 'number')).toBe(true)
  })

  it('has no strategy points before the first history timestamp when history starts partway through the window (e.g. a NAV feed trimmed of its pre-launch rounds)', () => {
    const points = buildBalanceTimeline({
      startingBalance: 100,
      horizon: 6, // 180-day span
      strategyApyPercent: 50,
      strategyHistory: [
        { timestamp: isoDaysAgo(5), apy: 36.5 },
        { timestamp: isoDaysAgo(3), apy: 36.5 },
      ],
      benchmarks: [],
      now: NOW,
    })

    const before = points.filter(p => p.time < -5)
    const from = points.filter(p => p.time >= -5 && p.time <= 0)

    expect(before.every(p => p.strategy === undefined)).toBe(true)
    expect(from.every(p => typeof p.strategy === 'number')).toBe(true)
    // The first point is the baseline — no pre-history compounding leaked in.
    expect(points.find(p => p.time === -5)!.strategy).toBe(100)
  })

  it('defines the strategy balance exactly at Now (time 0), not just from the first future step', () => {
    const withHistory = buildBalanceTimeline({
      startingBalance: 100,
      horizon: 1,
      strategyApyPercent: 50,
      strategyHistory: [{ timestamp: isoDaysAgo(1), apy: 36.5 }],
      benchmarks: [],
      now: NOW,
    })
    const withoutHistory = buildBalanceTimeline({
      startingBalance: 100,
      horizon: 1,
      strategyApyPercent: 50,
      benchmarks: [],
      now: NOW,
    })

    expect(withHistory.find(p => p.time === 0)!.strategy).toBeGreaterThan(100)
    expect(withoutHistory.find(p => p.time === 0)!.strategy).toBe(100)
  })

  it('ends the back-test exactly at Now and continues the projection from there with no gap, when the last history point is today', () => {
    const points = buildBalanceTimeline({
      startingBalance: 100,
      horizon: 1,
      strategyApyPercent: 50,
      strategyHistory: [
        { timestamp: isoDaysAgo(1), apy: 36.5 },
        { timestamp: new Date(NOW).toISOString(), apy: 36.5 },
      ],
      benchmarks: [],
      now: NOW,
    })

    const dayZero = points.find(p => p.time === 0)!
    const dayOne = points.find(p => p.time === 1)!
    expect(dayZero.strategy).toBeGreaterThan(100)
    expect(dayOne.strategy).toBeGreaterThan(dayZero.strategy!)
  })

  it('continues the future projection from exactly where the back-test compounding ended', () => {
    const points = buildBalanceTimeline({
      startingBalance: 100,
      horizon: 1,
      strategyApyPercent: 50,
      strategyHistory: [
        { timestamp: isoDaysAgo(2), apy: 36.5 },
        { timestamp: isoDaysAgo(1), apy: 36.5 },
      ],
      benchmarks: [],
      now: NOW,
    })

    const dayZero = points.find(p => p.time === 0)!
    const dayOne = points.find(p => p.time === 1)!
    const elapsedYears = 1 / 365
    expect(dayOne.strategy).toBeCloseTo(dayZero.strategy! * Math.pow(1 + 50 / 100, elapsedYears), 6)
  })

  it('leaves lst/weth benchmark handling unchanged', () => {
    const points = buildBalanceTimeline({
      startingBalance: 100,
      horizon: 1,
      strategyApyPercent: 50,
      benchmarks: [lstBenchmark],
      now: NOW,
    })

    expect(points.every(p => p.weth === 100)).toBe(true)
    expect(points.find(p => p.time === -1)!.lst).toBeGreaterThan(100)
  })
})
