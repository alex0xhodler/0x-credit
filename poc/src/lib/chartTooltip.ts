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

export function orderedComparisonTooltipRows(values: Partial<Record<ComparisonTooltipRow['id'], number>>): ComparisonTooltipRow[] {
  const weth = values.weth ?? 0
  return SERIES.flatMap(series => {
    const value = values[series.id]
    if (value === undefined) return []
    return [{ ...series, value, deltaFromWeth: value - weth }]
  })
}
