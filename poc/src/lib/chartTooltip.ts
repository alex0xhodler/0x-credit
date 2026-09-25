export interface ComparisonTooltipRow {
  id: 'strategy' | 'lst' | 'weth'
  label: string
  detail: string
  color: string
  value: number
  deltaFromWeth: number
}

const SERIES = [
  { id: 'strategy' as const, label: 'Your selected strategy', detail: 'Net APY after borrowing costs', color: '#E42B0C' },
  { id: 'lst' as const, label: 'LST · Lido stETH', detail: 'Liquid staking benchmark', color: '#2457ff' },
  { id: 'weth' as const, label: 'Hold WETH', detail: 'No staking yield', color: '#737373' },
]

/** `depositSymbol` relabels the flat "hold, no yield" baseline row (e.g. "Hold frxUSD" for an RWA strategy) instead of hard-coding WETH. */
export function orderedComparisonTooltipRows(
  values: Partial<Record<ComparisonTooltipRow['id'], number>>,
  depositSymbol = 'WETH',
): ComparisonTooltipRow[] {
  const weth = values.weth ?? 0
  return SERIES.flatMap(series => {
    const value = values[series.id]
    if (value === undefined) return []
    const label = series.id === 'weth' ? `Hold ${depositSymbol}` : series.label
    return [{ ...series, label, value, deltaFromWeth: value - weth }]
  })
}

/** Chart tooltip time label. Rounding straight to months (`Math.round(days/30)`) says "0 months ago" for anything under 15 days — show days or weeks below a month instead. */
export function formatChartTimeLabel(days: number, future: boolean): string {
  if (days === 0) return 'Now'
  const direction = future ? 'ahead' : 'ago'
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ${direction}`
  if (days < 30) {
    const weeks = Math.round(days / 7)
    return `${weeks} week${weeks === 1 ? '' : 's'} ${direction}`
  }
  const months = Math.round(days / 30)
  return `${months} month${months === 1 ? '' : 's'} ${direction}`
}
