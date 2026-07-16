import { describe, expect, it } from 'vitest'
import { routeProvenanceForStrategy } from './routeProvenance'

describe('routeProvenanceForStrategy', () => {
  it('returns the confirmed mainnet route roles only for the configured Ethereum strategy', () => {
    expect(routeProvenanceForStrategy('wmooCurveETH+-WETH', 'Ethereum')).toEqual([
      { role: 'Manager', provider: 'KPK' },
      { role: 'Protocol', provider: 'Gearbox' },
      { role: 'Pool', provider: 'Beefy on Curve' },
    ])
  })

  it('does not assign mainnet provenance to an unrelated strategy or chain', () => {
    expect(routeProvenanceForStrategy('another-strategy', 'Ethereum')).toBeUndefined()
    expect(routeProvenanceForStrategy('wmooCurveETH+-WETH', 'Monad')).toBeUndefined()
  })
})
