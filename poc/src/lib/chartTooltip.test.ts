import { describe, expect, it } from 'vitest'
import { orderedComparisonTooltipRows } from './chartTooltip'

describe('orderedComparisonTooltipRows', () => {
  it('puts the selected strategy first and frames alternatives against holding WETH', () => {
    const rows = orderedComparisonTooltipRows({ strategy: 3.31, weth: 2.924, lst: 3.03 })

    expect(rows.map(row => row.id)).toEqual(['strategy', 'lst', 'weth'])
    expect(rows[0]?.label).toBe('Your selected strategy')
    expect(rows[0]?.deltaFromWeth).toBeCloseTo(0.386, 6)
    expect(rows[2]).toMatchObject({ label: 'Hold WETH', detail: 'No staking yield', deltaFromWeth: 0 })
  })
})
