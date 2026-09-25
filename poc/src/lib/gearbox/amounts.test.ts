import { parseUnits } from 'viem'
import { describe, expect, it } from 'vitest'
import { calculateMinimumCollateralForDebt } from './plan'
import { formatMinimumDeposit } from './amounts'

describe('formatMinimumDeposit', () => {
  it('rounds a non-terminating minimum UP, never down, at the display precision', () => {
    // 1.572327044025157233... — truncating or rounding-to-nearest at 4dp
    // (1.5723) sits BELOW the true minimum, which would let a user submit an
    // amount the route rejects. Ceiling is the only safe rounding direction.
    expect(formatMinimumDeposit(1_572_327_044_025_157_233n, 18, 4)).toBe('1.5724')
  })

  it('leaves an exact value unchanged', () => {
    expect(formatMinimumDeposit(1_500_000_000_000_000_000n, 18, 4)).toBe('1.5000')
  })

  it('never displays less than the true minimum for the WETH ETH+ route at 7.36x leverage', () => {
    const raw = calculateMinimumCollateralForDebt({ minDebt: 10_000_000_000_000_000_000n, leverage: 736n })
    const displayed = formatMinimumDeposit(raw, 18, 4)
    expect(parseUnits(displayed, 18)).toBeGreaterThanOrEqual(raw)
  })

  it('supports fewer display decimals than the token has', () => {
    expect(formatMinimumDeposit(37_500_000_000_000_000_000_000n, 18, 4)).toBe('37500.0000')
  })
})
