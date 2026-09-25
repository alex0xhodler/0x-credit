import { describe, expect, it } from 'vitest'
import { formatChartTimeLabel, orderedComparisonTooltipRows } from './chartTooltip'

describe('orderedComparisonTooltipRows', () => {
  it('puts the selected strategy first and frames alternatives against holding WETH', () => {
    const rows = orderedComparisonTooltipRows({ strategy: 3.31, weth: 2.924, lst: 3.03 })

    expect(rows.map(row => row.id)).toEqual(['strategy', 'lst', 'weth'])
    expect(rows[0]?.label).toBe('Your selected strategy')
    expect(rows[0]?.deltaFromWeth).toBeCloseTo(0.386, 6)
    expect(rows[2]).toMatchObject({ label: 'Hold WETH', detail: 'No staking yield', deltaFromWeth: 0 })
  })

  it('relabels the flat hold-baseline row with the actual deposit symbol, for non-ETH strategies', () => {
    const rows = orderedComparisonTooltipRows({ strategy: 11.9, weth: 0 }, 'frxUSD')
    expect(rows.find(row => row.id === 'weth')?.label).toBe('Hold frxUSD')
  })
})

describe('formatChartTimeLabel', () => {
  it('never rounds a sub-month span down to "0 months"', () => {
    expect(formatChartTimeLabel(3, false)).toBe('3 days ago')
    expect(formatChartTimeLabel(1, true)).toBe('1 day ahead')
    expect(formatChartTimeLabel(10, false)).toBe('1 week ago')
    expect(formatChartTimeLabel(20, true)).toBe('3 weeks ahead')
  })

  it('uses months once the span reaches a month', () => {
    expect(formatChartTimeLabel(30, false)).toBe('1 month ago')
    expect(formatChartTimeLabel(90, true)).toBe('3 months ahead')
  })

  it('labels the origin as "Now" regardless of direction', () => {
    expect(formatChartTimeLabel(0, true)).toBe('Now')
    expect(formatChartTimeLabel(0, false)).toBe('Now')
  })
})
