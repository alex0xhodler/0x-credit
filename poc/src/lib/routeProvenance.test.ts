import { describe, expect, it } from 'vitest'
import { routeProvenanceForStrategy } from './routeProvenance'

describe('routeProvenanceForStrategy', () => {
  it('returns the confirmed mainnet route roles, with the on-chain curator as manager, for the configured Ethereum strategy', () => {
    expect(routeProvenanceForStrategy('wmooCurveETH+-WETH', 'Ethereum', 'KPK')).toEqual([
      { role: 'Manager', provider: 'KPK' },
      { role: 'Protocol', provider: 'Gearbox' },
      { role: 'Pool', provider: 'Beefy on Curve' },
    ])
  })

  it('carries a different on-chain curator through rather than hard-coding one', () => {
    expect(routeProvenanceForStrategy('wmooCurveETH+-WETH', 'Ethereum', 'Chaos Labs')?.[0]).toEqual({
      role: 'Manager',
      provider: 'Chaos Labs',
    })
  })

  it('does not assign mainnet provenance to an unrelated strategy or chain', () => {
    expect(routeProvenanceForStrategy('another-strategy', 'Ethereum', 'KPK')).toBeUndefined()
    expect(routeProvenanceForStrategy('wmooCurveETH+-WETH', 'Monad', 'KPK')).toBeUndefined()
  })
})
