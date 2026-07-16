export const DEFILLAMA_YIELDS_URL = 'https://yields.llama.fi'

export interface DefiLlamaPool {
  chain: string
  project: string
  symbol: string
  tvlUsd: number
  apy: number | null
  apyBase: number | null
  apyReward: number | null
  pool: string
  exposure: string
  outlier: boolean
}

export interface DefiLlamaRatePoint {
  timestamp: string
  apy: number | null
}

export interface YieldBenchmark {
  id: 'strategyBase' | 'lst'
  label: string
  sourceLabel: string
  sourceUrl: string
  apyPercent: number
  apyBasePercent?: number
  apyRewardPercent?: number
  history: readonly DefiLlamaRatePoint[]
}

const BENCHMARKS = [
  {
    id: 'strategyBase' as const,
    label: 'Strategy base · Beefy ETH+/WETH',
    sourceLabel: 'DefiLlama · Beefy',
    sourceUrl: 'https://defillama.com/yields/pool/c98203f5-ea5c-42b0-ab85-f3edfd7b9cbe',
    pool: 'c98203f5-ea5c-42b0-ab85-f3edfd7b9cbe',
    project: 'beefy',
    symbol: 'ETH+-WETH',
    exposure: 'multi',
  },
  {
    id: 'lst' as const,
    label: 'LST · Lido stETH',
    sourceLabel: 'DefiLlama · Lido',
    sourceUrl: 'https://defillama.com/yields/pool/747c1d2a-c668-4682-b9f9-296708a3dd90',
    pool: '747c1d2a-c668-4682-b9f9-296708a3dd90',
    project: 'lido',
    symbol: 'STETH',
    exposure: 'single',
  },
] as const

function isUsablePool(pool: DefiLlamaPool, expected: typeof BENCHMARKS[number]) {
  return pool.pool === expected.pool
    && pool.chain === 'Ethereum'
    && pool.project === expected.project
    && pool.symbol === expected.symbol
    && pool.exposure === expected.exposure
    && pool.outlier !== true
    && typeof pool.apy === 'number'
    && Number.isFinite(pool.apy)
    && pool.apy >= 0
}

export function extractEthereumBenchmarks(pools: readonly DefiLlamaPool[]): YieldBenchmark[] {
  return BENCHMARKS.flatMap(expected => {
    const pool = pools.find(item => isUsablePool(item, expected))
    if (!pool || pool.apy === null) return []

    return [{
      id: expected.id,
      label: expected.label,
      sourceLabel: expected.sourceLabel,
      sourceUrl: expected.sourceUrl,
      apyPercent: pool.apy,
      apyBasePercent: pool.apyBase ?? undefined,
      apyRewardPercent: pool.apyReward ?? undefined,
      history: [],
    }]
  })
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${DEFILLAMA_YIELDS_URL}${path}`, { signal })
  if (!response.ok) throw new Error(`DefiLlama yield request failed (${response.status}).`)
  return response.json() as Promise<T>
}

export async function loadEthereumYieldBenchmarks(signal?: AbortSignal): Promise<YieldBenchmark[]> {
  const poolsResponse = await fetchJson<{ status: string; data: DefiLlamaPool[] }>('/pools', signal)
  const selected = extractEthereumBenchmarks(poolsResponse.data)

  const withHistory = await Promise.all(selected.map(async benchmark => {
    const config = BENCHMARKS.find(item => item.id === benchmark.id)
    if (!config) return benchmark
    const response = await fetchJson<{ status: string; data: DefiLlamaRatePoint[] }>(`/chart/${config.pool}`, signal)
    const history = response.data.filter(point =>
      typeof point.apy === 'number' && Number.isFinite(point.apy) && !Number.isNaN(Date.parse(point.timestamp)),
    )
    return { ...benchmark, history }
  }))

  return withHistory
}
