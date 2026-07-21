import { describe, expect, it } from 'vitest'
import { MAX_SLIPPAGE_DEFAULT, compareRoutes, totalCostUsd } from './costEngine'
import type { RouteQuote } from './costEngine'

const quote = (overrides: Partial<RouteQuote>): RouteQuote => ({
  routeId: 'r',
  venue: 'dex',
  steps: [{ venue: 'dex', fromToken: 'USDC', toToken: 'bNVDA', poolOrIssuer: '0xpool' }],
  notionalUsd: 1_000_000,
  slippage: 0.002,
  gasUsd: 5,
  feeUsd: 100,
  ...overrides,
})

describe('totalCostUsd', () => {
  it('sums slippage cost, gas, and fee', () => {
    expect(totalCostUsd(quote({ slippage: 0.001, notionalUsd: 1_000_000, gasUsd: 5, feeUsd: 50 }))).toBeCloseTo(
      1055,
      6,
    )
  })
})

describe('compareRoutes', () => {
  it('selects the lowest total-cost viable route', () => {
    const cheapDex = quote({ routeId: 'dex', venue: 'dex', slippage: 0.004, gasUsd: 5, feeUsd: 0 })
    const rfq = quote({ routeId: 'rfq', venue: 'issuer_rfq', slippage: 0.0005, gasUsd: 3, feeUsd: 250 })
    const result = compareRoutes([cheapDex, rfq])
    // DEX slippage cost 4000 >> RFQ 500 + 250 fee → RFQ wins.
    expect(result.best?.routeId).toBe('rfq')
    expect(result.viable.map(q => q.routeId)).toEqual(['rfq', 'dex'])
  })

  it('rejects routes that breach the slippage guardrail, with a reason', () => {
    const thin = quote({ routeId: 'thin', slippage: MAX_SLIPPAGE_DEFAULT + 0.001 })
    const ok = quote({ routeId: 'ok', slippage: 0.001 })
    const result = compareRoutes([thin, ok])
    expect(result.best?.routeId).toBe('ok')
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0]).toMatchObject({ reason: 'slippage_exceeds_tolerance' })
    expect(result.rejected[0].quote.routeId).toBe('thin')
  })

  it('breaks equal-cost ties toward the higher provider score', () => {
    const lowScore = quote({ routeId: 'low', providerRiskScore: 3 })
    const highScore = quote({ routeId: 'high', providerRiskScore: 5 })
    const result = compareRoutes([lowScore, highScore])
    expect(result.best?.routeId).toBe('high')
  })

  it('returns no best route when every candidate is too thin', () => {
    const result = compareRoutes([quote({ slippage: 0.02 }), quote({ slippage: 0.03 })])
    expect(result.best).toBeUndefined()
    expect(result.viable).toEqual([])
    expect(result.rejected).toHaveLength(2)
  })

  it('honours a custom slippage tolerance', () => {
    const q = quote({ routeId: 'q', slippage: 0.008 })
    expect(compareRoutes([q], { maxSlippage: 0.01 }).best?.routeId).toBe('q')
    expect(compareRoutes([q], { maxSlippage: 0.005 }).best).toBeUndefined()
  })
})
