import type { Address } from 'viem'

interface ApyRewardEntry {
  protocol: string
  value: number
}

interface TokenApyEntry {
  chainId: number
  address: string
  symbol: string
  rewards?: {
    apy?: ApyRewardEntry[]
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseCollateralApys(json: unknown, chainId: number): Map<Address, number> {
  const result = new Map<Address, number>()
  if (!isRecord(json)) return result

  const chains = json.chains
  if (!isRecord(chains)) return result

  const chain = chains[String(chainId)]
  if (!isRecord(chain)) return result

  const tokens = chain.tokens
  if (!isRecord(tokens) || tokens.status !== 'ok' || !Array.isArray(tokens.data)) return result

  for (const entry of tokens.data as TokenApyEntry[]) {
    const apyList = entry?.rewards?.apy
    if (!apyList || apyList.length === 0) continue
    const percent = apyList[0]?.value
    if (typeof percent !== 'number' || Number.isNaN(percent)) continue
    if (typeof entry.address !== 'string') continue
    result.set(entry.address.toLowerCase() as Address, Math.round(percent * 100))
  }

  return result
}

export async function fetchCollateralApys(url: string, chainId: number): Promise<Map<Address, number>> {
  try {
    const response = await fetch(url)
    if (!response.ok) return new Map()
    const json = await response.json()
    return parseCollateralApys(json, chainId)
  } catch {
    return new Map()
  }
}
