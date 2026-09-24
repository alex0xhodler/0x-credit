import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fetchCollateralApys, parseCollateralApys } from './apyFeed'

const WMOO_CURVE_ETH = '0x02a4cceed3c400b5ba9fd22ad6ec18d8f7a3d48e'
const MF_ONE = '0x238a700ed6165261cf8b2e544ba797bc11e466ba'

function fixture() {
  return {
    chains: {
      '1': {
        tokens: {
          status: 'ok',
          data: [
            {
              chainId: 1,
              address: '0x02a4cCEed3C400B5bA9fd22Ad6EC18d8F7a3d48E',
              symbol: 'wmooCurveETH+-WETH',
              rewards: {
                apy: [{ protocol: 'beefy', value: 12.65065 }],
              },
            },
            {
              chainId: 1,
              address: '0x238a700eD6165261Cf8b2e544ba797BC11e466Ba',
              symbol: 'mF-ONE',
              rewards: {
                apy: [],
              },
            },
          ],
        },
      },
    },
  }
}

describe('parseCollateralApys', () => {
  it('takes the first reward apy percentage and converts it to bps, keyed by lowercase address', () => {
    const result = parseCollateralApys(fixture(), 1)
    expect(result.get(WMOO_CURVE_ETH)).toBe(1265)
  })

  it('omits tokens with an empty apy list', () => {
    const result = parseCollateralApys(fixture(), 1)
    expect(result.has(MF_ONE)).toBe(false)
  })

  it('returns an empty map when the chain is missing', () => {
    expect(parseCollateralApys(fixture(), 42).size).toBe(0)
  })

  it('returns an empty map when the tokens feed status is not ok', () => {
    const bad = { chains: { '1': { tokens: { status: 'error', data: [] } } } }
    expect(parseCollateralApys(bad, 1).size).toBe(0)
  })

  it('returns an empty map for malformed input rather than throwing', () => {
    expect(parseCollateralApys(null, 1).size).toBe(0)
    expect(parseCollateralApys(undefined, 1).size).toBe(0)
    expect(parseCollateralApys('garbage', 1).size).toBe(0)
    expect(parseCollateralApys({}, 1).size).toBe(0)
  })
})

describe('fetchCollateralApys', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('parses the response body from the given url', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => fixture(),
    })) as unknown as typeof fetch

    const result = await fetchCollateralApys('/gearbox-apy/latest.json', 1)
    expect(result.get(WMOO_CURVE_ETH)).toBe(1265)
  })

  it('returns an empty map on a network error rather than throwing', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    const result = await fetchCollateralApys('/gearbox-apy/latest.json', 1)
    expect(result.size).toBe(0)
  })

  it('returns an empty map on a non-ok response', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch

    const result = await fetchCollateralApys('/gearbox-apy/latest.json', 1)
    expect(result.size).toBe(0)
  })

  it('returns an empty map when the response body is not valid JSON', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new Error('bad json')
      },
    })) as unknown as typeof fetch

    const result = await fetchCollateralApys('/gearbox-apy/latest.json', 1)
    expect(result.size).toBe(0)
  })
})
