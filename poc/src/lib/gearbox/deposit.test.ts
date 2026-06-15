import { describe, expect, it } from 'vitest'
import { getDepositControls } from './deposit'

describe('getDepositControls', () => {
  it('resets to the minimum deposit', () => {
    const { reset } = getDepositControls(1.5)
    expect(reset).toBeCloseTo(1.5, 5)
  })

  it('produces step increments scaled to small deposits (wstETH ~3)', () => {
    const { steps } = getDepositControls(2.92)
    // For min ~1-10, steps should be small: 0.1, 1, 5
    expect(steps[0]).toBeCloseTo(0.1, 5)
    expect(steps[1]).toBeCloseTo(1, 5)
    expect(steps[2]).toBeCloseTo(5, 5)
  })

  it('produces step increments scaled to large deposits (AUSD ~1500)', () => {
    const { steps } = getDepositControls(1212)
    // For min ~1000, steps should be: 100, 500, 1000
    expect(steps[0]).toBe(100)
    expect(steps[1]).toBe(500)
    expect(steps[2]).toBe(1000)
  })

  it('produces presets as multiples of the min deposit', () => {
    const { presets } = getDepositControls(3)
    // Should have at least 2 preset options beyond min
    expect(presets.length).toBeGreaterThanOrEqual(2)
    // All preset values should be >= min
    for (const p of presets) {
      expect(p.value).toBeGreaterThanOrEqual(3)
    }
    // Presets are in ascending order
    for (let i = 1; i < presets.length; i++) {
      expect(presets[i].value).toBeGreaterThan(presets[i - 1].value)
    }
  })

  it('first preset is the minimum deposit', () => {
    const { presets } = getDepositControls(2.92)
    expect(presets[0].value).toBeCloseTo(2.92, 2)
    expect(presets[0].label).toMatch(/min/i)
  })
})
