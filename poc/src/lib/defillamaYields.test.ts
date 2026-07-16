import { describe, expect, it } from 'vitest'
import { extractEthereumBenchmarks } from './defillamaYields'

const pools = [
  {
    chain: 'Ethereum',
    project: 'beefy',
    symbol: 'ETH+-WETH',
    tvlUsd: 6_000_000,
    apy: 3.93658,
    apyBase: 3.93658,
    apyReward: null,
    pool: 'c98203f5-ea5c-42b0-ab85-f3edfd7b9cbe',
    exposure: 'multi',
    outlier: false,
  },
  {
    chain: 'Ethereum',
    project: 'lido',
    symbol: 'STETH',
    tvlUsd: 16_000_000_000,
    apy: 2.185,
    apyBase: 2.185,
    apyReward: null,
    pool: '747c1d2a-c668-4682-b9f9-296708a3dd90',
    exposure: 'single',
    outlier: false,
  },
]

describe('extractEthereumBenchmarks', () => {
  it('uses only the pinned single-asset LST source', () => {
    const benchmarks = extractEthereumBenchmarks(pools)

    expect(benchmarks).toEqual([
      expect.objectContaining({ id: 'strategyBase', label: 'Strategy base · Beefy ETH+/WETH', apyPercent: 3.93658 }),
      expect.objectContaining({ id: 'lst', label: 'LST · Lido stETH', apyPercent: 2.185 }),
    ])
  })

  it('rejects a matching pool when its required source properties change', () => {
    const wrongExposure = pools.map(pool =>
      pool.symbol === 'STETH' ? { ...pool, exposure: 'multi' } : pool,
    )

    expect(extractEthereumBenchmarks(wrongExposure)).toEqual([
      expect.objectContaining({ id: 'strategyBase' }),
    ])
  })
})
