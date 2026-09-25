import type { DefiLlamaRatePoint, YieldBenchmark } from './defillamaYields'

export type ComparisonHorizon = 1 | 6 | 12

export interface BalanceTimelinePoint {
  time: number
  strategy?: number
  weth: number
  lst?: number
}

const DAY_MS = 24 * 60 * 60 * 1000

export function buildBalanceTimeline({
  startingBalance,
  horizon,
  strategyApyPercent,
  strategyHistory,
  benchmarks,
  now = Date.now(),
}: {
  startingBalance: number
  horizon: ComparisonHorizon
  strategyApyPercent: number
  /** Leveraged net-APY back-test for the past line; undefined draws a projection-only strategy line (no history fetched, or the fetch failed/is not meaningful — see `collateralApySource: 'nav'`). */
  strategyHistory?: readonly DefiLlamaRatePoint[]
  benchmarks: readonly YieldBenchmark[]
  now?: number
}): BalanceTimelinePoint[] {
  const spanDays = horizon * 30
  const start = now - spanDays * DAY_MS
  const historicalRates = new Map<'strategy' | YieldBenchmark['id'], Map<number, number>>()

  function ratesFromHistory(history: readonly DefiLlamaRatePoint[]): Map<number, number> {
    const rates = new Map<number, number>()
    for (const point of history) {
      const timestamp = Date.parse(point.timestamp)
      if (timestamp < start || timestamp > now || point.apy === null) continue
      rates.set(Math.round((timestamp - now) / DAY_MS), point.apy)
    }
    return rates
  }

  if (strategyHistory) {
    const rates = ratesFromHistory(strategyHistory)
    if (rates.size > 0) historicalRates.set('strategy', rates)
  }
  for (const benchmark of benchmarks) {
    historicalRates.set(benchmark.id, ratesFromHistory(benchmark.history))
  }

  const balances: Record<'strategy' | 'weth' | YieldBenchmark['id'], number | undefined> = {
    strategy: historicalRates.has('strategy') ? startingBalance : undefined,
    weth: startingBalance,
    lst: historicalRates.has('lst') ? startingBalance : undefined,
  }
  const latestRates = new Map<'strategy' | YieldBenchmark['id'], number>()
  const points: BalanceTimelinePoint[] = []

  for (let time = -spanDays; time <= 0; time++) {
    for (const [key, rates] of historicalRates) {
      const rate = rates.get(time)
      if (rate !== undefined) latestRates.set(key, rate)
      if (time > -spanDays && balances[key] !== undefined && latestRates.has(key)) {
        balances[key] = balances[key]! * Math.pow(1 + latestRates.get(key)! / 100, 1 / 365)
      }
    }
    // The future projection picks up from here, continuing wherever the past
    // compounding ended, or starting fresh at `startingBalance` when there
    // was no usable back-test at all — so "Now" (time 0) must already carry
    // a defined strategy balance, not just the first future step.
    if (time === 0) balances.strategy = balances.strategy ?? startingBalance
    points.push({
      time,
      strategy: balances.strategy,
      weth: balances.weth ?? startingBalance,
      lst: balances.lst,
    })
  }

  let futureStrategy = balances.strategy ?? startingBalance
  const futureSteps = horizon === 1 ? 30 : horizon
  for (let step = 1; step <= futureSteps; step++) {
    const time = horizon === 1 ? step : step * 30
    const elapsedYears = (horizon === 1 ? 1 : 30) / 365
    futureStrategy *= Math.pow(1 + strategyApyPercent / 100, elapsedYears)
    if (balances.lst !== undefined) balances.lst *= Math.pow(1 + (benchmarks.find(item => item.id === 'lst')?.apyPercent ?? 0) / 100, elapsedYears)
    points.push({ time, strategy: futureStrategy, weth: startingBalance, lst: balances.lst })
  }

  return points
}
