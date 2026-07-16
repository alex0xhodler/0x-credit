import type { YieldBenchmark } from './defillamaYields'

export type ComparisonHorizon = 1 | 6 | 12

export interface BalanceTimelinePoint {
  time: number
  strategy?: number
  weth: number
  lst?: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function historyKey(id: YieldBenchmark['id']): keyof BalanceTimelinePoint {
  return id === 'strategyBase' ? 'strategy' : id
}

export function buildBalanceTimeline({
  startingBalance,
  horizon,
  strategyApyPercent,
  benchmarks,
  now = Date.now(),
}: {
  startingBalance: number
  horizon: ComparisonHorizon
  strategyApyPercent: number
  benchmarks: readonly YieldBenchmark[]
  now?: number
}): BalanceTimelinePoint[] {
  const spanDays = horizon * 30
  const start = now - spanDays * DAY_MS
  const historicalRates = new Map<keyof BalanceTimelinePoint, Map<number, number>>()

  for (const benchmark of benchmarks) {
    const key = historyKey(benchmark.id)
    const rates = new Map<number, number>()
    for (const point of benchmark.history) {
      const timestamp = Date.parse(point.timestamp)
      if (timestamp < start || timestamp > now || point.apy === null) continue
      rates.set(Math.round((timestamp - now) / DAY_MS), point.apy)
    }
    historicalRates.set(key, rates)
  }

  const balances: Record<keyof BalanceTimelinePoint, number | undefined> = {
    time: undefined,
    strategy: historicalRates.has('strategy') ? startingBalance : undefined,
    weth: startingBalance,
    lst: historicalRates.has('lst') ? startingBalance : undefined,
  }
  const latestRates = new Map<keyof BalanceTimelinePoint, number>()
  const points: BalanceTimelinePoint[] = []

  for (let time = -spanDays; time <= 0; time++) {
    for (const [key, rates] of historicalRates) {
      const rate = rates.get(time)
      if (rate !== undefined) latestRates.set(key, rate)
      if (time > -spanDays && balances[key] !== undefined && latestRates.has(key)) {
        balances[key] = balances[key]! * Math.pow(1 + latestRates.get(key)! / 100, 1 / 365)
      }
    }
    points.push({
      time,
      strategy: balances.strategy,
      weth: balances.weth ?? startingBalance,
      lst: balances.lst,
    })
  }

  const futureSteps = horizon === 1 ? 30 : horizon
  for (let step = 1; step <= futureSteps; step++) {
    const time = horizon === 1 ? step : step * 30
    const elapsedYears = (horizon === 1 ? 1 : 30) / 365
    if (balances.strategy !== undefined) balances.strategy *= Math.pow(1 + strategyApyPercent / 100, elapsedYears)
    if (balances.lst !== undefined) balances.lst *= Math.pow(1 + (benchmarks.find(item => item.id === 'lst')?.apyPercent ?? 0) / 100, elapsedYears)
    points.push({ time, strategy: balances.strategy, weth: startingBalance, lst: balances.lst })
  }

  return points
}
