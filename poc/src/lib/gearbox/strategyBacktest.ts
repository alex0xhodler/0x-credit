import { calcNetStrategyApy } from '@gearbox-protocol/sdk/onchain'
import type { Address } from 'viem'
import { fetchNavRounds, buildNavApySegments, gearboxApi, getAttachedMainnetSdk, MAINNET_CHAIN_ID } from './live'

type ChartSeries =
  | { status: 'ok'; unit: string; values: Array<number | null> }
  | { status: 'unavailable'; reason: { code: string; message?: string } }

export interface StrategyApyChartBundle {
  timestamps: number[]
  series: {
    collateralApy: ChartSeries
    borrowApy: ChartSeries
    quotaRate: ChartSeries
  }
}

/** One day of the leveraged strategy back-test, matching `DefiLlamaRatePoint`'s shape so both feed the same balance-timeline compounding. */
export interface StrategyBacktestPoint {
  timestamp: string
  apy: number | null
}

/**
 * Converts a raw `collateralApy`/`borrowApy`/`quotaRate` chart bundle into a
 * daily leveraged net-APY series, in percent (matching the app's other
 * history points). Pure — the network call lives in `fetchStrategyBacktest`.
 *
 * A day where any of the three series is null nulls out that day rather than
 * guessing; `buildBalanceTimeline` already skips null days. Returns
 * undefined when the backend could not produce one of the series at all.
 */
export function buildStrategyBacktestSeries(
  bundle: StrategyApyChartBundle,
  liquidationThresholdBps: number,
  leverage: number,
): StrategyBacktestPoint[] | undefined {
  const { collateralApy, borrowApy, quotaRate } = bundle.series
  if (collateralApy.status !== 'ok' || borrowApy.status !== 'ok' || quotaRate.status !== 'ok') {
    return undefined
  }

  return bundle.timestamps.map((timestamp, index) => {
    const collateral = collateralApy.values[index]
    const borrow = borrowApy.values[index]
    const quota = quotaRate.values[index]

    if (collateral === null || borrow === null || quota === null) {
      return { timestamp: new Date(timestamp * 1000).toISOString(), apy: null }
    }

    const netApyBps = calcNetStrategyApy(
      { borrowApy: borrow, quotaRate: quota, liquidationThreshold: liquidationThresholdBps },
      collateral,
      leverage,
      'aggressive',
    )
    return { timestamp: new Date(timestamp * 1000).toISOString(), apy: netApyBps / 100 }
  })
}

/** One segment of NAV-derived collateral apy history — see `buildNavApySegments` in `live.ts`. */
export interface NavApySegmentLike {
  timestamp: number
  apyBps: number
}

/** A rates-only chart (no collateralApy): used for a NAV-priced route, which ignores the backend's collateralApy but still wants its own borrowApy/quotaRate history where available. */
export interface RatesChartBundle {
  timestamps: number[]
  borrowApy: ChartSeries
  quotaRate: ChartSeries
}

const CHART_DAY_TOLERANCE_SECONDS = 12 * 60 * 60

function findChartRatesAt(chart: RatesChartBundle | undefined, timestamp: number): { borrowApy: number; quotaRate: number } | undefined {
  if (!chart || chart.borrowApy.status !== 'ok' || chart.quotaRate.status !== 'ok') return undefined

  let closestIndex = -1
  let closestDelta = Infinity
  for (let i = 0; i < chart.timestamps.length; i++) {
    const delta = Math.abs(chart.timestamps[i] - timestamp)
    if (delta < closestDelta) {
      closestDelta = delta
      closestIndex = i
    }
  }
  if (closestIndex === -1 || closestDelta > CHART_DAY_TOLERANCE_SECONDS) return undefined

  const borrowApy = chart.borrowApy.values[closestIndex]
  const quotaRate = chart.quotaRate.values[closestIndex]
  if (borrowApy === null || quotaRate === null) return undefined

  return { borrowApy, quotaRate }
}

/**
 * Combines NAV-derived collateral-apy segments (mF-ONE, mGLOBAL) with the
 * Gearbox backend's borrowApy/quotaRate history for the same route, ignoring
 * its collateralApy entirely (NAV supersedes it). A segment the rates chart
 * doesn't cover — no chart, a day outside its range, or a null day — falls
 * back to the route's current borrow/quota rates rather than dropping the
 * point: unlike `buildStrategyBacktestSeries`, every NAV segment always has
 * a real collateral apy, so there is never a reason to null out a day.
 */
export function buildNavBacktestSeries(
  segments: readonly NavApySegmentLike[],
  ratesChart: RatesChartBundle | undefined,
  liquidationThresholdBps: number,
  leverage: number,
  currentRates: { borrowApyBps: number; quotaRateBps: number },
): StrategyBacktestPoint[] {
  return segments.map(segment => {
    const matched = findChartRatesAt(ratesChart, segment.timestamp)
    const borrowApy = matched?.borrowApy ?? currentRates.borrowApyBps
    const quotaRate = matched?.quotaRate ?? currentRates.quotaRateBps

    const netApyBps = calcNetStrategyApy(
      { borrowApy, quotaRate, liquidationThreshold: liquidationThresholdBps },
      segment.apyBps,
      leverage,
      'aggressive',
    )
    return { timestamp: new Date(segment.timestamp * 1000).toISOString(), apy: netApyBps / 100 }
  })
}

const backtestCache = new Map<Address, Promise<StrategyBacktestPoint[] | undefined>>()

export function resetStrategyBacktestCache() {
  backtestCache.clear()
}

/**
 * Fetches (and caches per credit manager) the leveraged strategy back-test
 * used to draw the "past" half of the projection chart. Any failure, or a
 * route without on-chain history, resolves to undefined — the chart then
 * falls back to projection-only, exactly like a route with no history at
 * all (see the `collateralApySource: 'nav'` routes, which skip this fetch
 * entirely since their backend history is not meaningful).
 */
export function fetchStrategyBacktest(
  creditManager: Address,
  liquidationThresholdBps: number,
  leverage: number,
): Promise<StrategyBacktestPoint[] | undefined> {
  const cached = backtestCache.get(creditManager)
  if (cached) return cached

  const promise = gearboxApi.opportunities
    .getCharts(
      { kind: 'strategy', chainId: MAINNET_CHAIN_ID, creditManager },
      ['collateralApy', 'borrowApy', 'quotaRate'] as const,
      '1y',
    )
    .then(response => buildStrategyBacktestSeries(response.data as StrategyApyChartBundle, liquidationThresholdBps, leverage))
    .catch(() => undefined)

  backtestCache.set(creditManager, promise)
  return promise
}

/**
 * Fetches (and caches per credit manager) the NAV-derived strategy back-test
 * for a Midas RWA route (mF-ONE, mGLOBAL): on-chain NAV rounds for the
 * collateral-apy history, layered onto the Gearbox backend's borrowApy/
 * quotaRate history where it covers the same days (current rates otherwise).
 * Undefined when the shared mainnet SDK isn't attached yet, the credit
 * manager has no configured NAV feed for `targetToken`, or fewer than two
 * rounds are readable — never throws.
 */
export function fetchNavBacktest(
  creditManager: Address,
  targetToken: Address,
  liquidationThresholdBps: number,
  leverage: number,
  currentRates: { borrowApyBps: number; quotaRateBps: number },
): Promise<StrategyBacktestPoint[] | undefined> {
  const cached = backtestCache.get(creditManager)
  if (cached) return cached

  const promise = (async () => {
    const sdk = getAttachedMainnetSdk()
    if (!sdk) return undefined

    const rounds = await fetchNavRounds(sdk, creditManager, targetToken)
    if (!rounds || rounds.length < 2) return undefined

    const segments = buildNavApySegments(rounds)
    if (segments.length === 0) return undefined

    const ratesChart = await gearboxApi.opportunities
      .getCharts({ kind: 'strategy', chainId: MAINNET_CHAIN_ID, creditManager }, ['borrowApy', 'quotaRate'] as const, '1y')
      .then(response => ({
        timestamps: response.data.timestamps,
        borrowApy: response.data.series.borrowApy as unknown as ChartSeries,
        quotaRate: response.data.series.quotaRate as unknown as ChartSeries,
      }))
      .catch(() => undefined)

    return buildNavBacktestSeries(segments, ratesChart, liquidationThresholdBps, leverage, currentRates)
  })().catch(() => undefined)

  backtestCache.set(creditManager, promise)
  return promise
}
