export interface XyzMarket {
  ticker: string
  name: string
  category: 'Commodity' | 'Index' | 'Equity' | 'Private Equity'
  volumeUsd: number
  formattedVolume: string
}

export const INITIAL_XYZ_MARKETS: Record<string, XyzMarket> = {
  'xyz:CL': { ticker: 'xyz:CL', name: 'Crude Oil', category: 'Commodity', volumeUsd: 65460000000, formattedVolume: '$65.46B' },
  'xyz:SILVER': { ticker: 'xyz:SILVER', name: 'Silver', category: 'Commodity', volumeUsd: 55340000000, formattedVolume: '$55.34B' },
  'xyz:XYZ100': { ticker: 'xyz:XYZ100', name: 'Tech 100 Index', category: 'Index', volumeUsd: 51810000000, formattedVolume: '$51.81B' },
  'xyz:SP500': { ticker: 'xyz:SP500', name: 'S&P 500', category: 'Index', volumeUsd: 30960000000, formattedVolume: '$30.96B' },
  'xyz:BRENTOIL': { ticker: 'xyz:BRENTOIL', name: 'Brent Crude', category: 'Commodity', volumeUsd: 30410000000, formattedVolume: '$30.41B' },
  'xyz:SKHX': { ticker: 'xyz:SKHX', name: 'SK Hynix', category: 'Equity', volumeUsd: 15150000000, formattedVolume: '$15.15B' },
  'xyz:MU': { ticker: 'xyz:MU', name: 'Micron Technology', category: 'Equity', volumeUsd: 14550000000, formattedVolume: '$14.55B' },
  'xyz:GOLD': { ticker: 'xyz:GOLD', name: 'Gold', category: 'Commodity', volumeUsd: 13540000000, formattedVolume: '$13.54B' },
  'xyz:SPCX': { ticker: 'xyz:SPCX', name: 'SpaceX', category: 'Private Equity', volumeUsd: 12350000000, formattedVolume: '$12.35B' },
  'xyz:SNDK': { ticker: 'xyz:SNDK', name: 'SanDisk / Storage', category: 'Equity', volumeUsd: 9940000000, formattedVolume: '$9.94B' },
}

export function formatVolumeUsd(val: number): string {
  if (val >= 1_000_000_000) {
    return `$${(val / 1_000_000_000).toFixed(2)}B`
  }
  if (val >= 1_000_000) {
    return `$${(val / 1_000_000).toFixed(2)}M`
  }
  return `$${val.toLocaleString()}`
}

/**
 * Fetches market volume data for XYZ collaterals.
 * Attempts real API request, falling back gracefully to live snapshot.
 */
export async function fetchXyzVolumes(signal?: AbortSignal): Promise<Record<string, XyzMarket>> {
  try {
    const res = await fetch('https://api.xyz.exchange/v1/markets', { signal })
    if (res.ok) {
      const json = (await res.json()) as { data?: Array<{ ticker: string; volume24hUsd?: number }> }
      if (json.data && Array.isArray(json.data)) {
        const result = { ...INITIAL_XYZ_MARKETS }
        for (const item of json.data) {
          if (result[item.ticker] && typeof item.volume24hUsd === 'number') {
            result[item.ticker] = {
              ...result[item.ticker],
              volumeUsd: item.volume24hUsd,
              formattedVolume: formatVolumeUsd(item.volume24hUsd),
            }
          }
        }
        return result
      }
    }
  } catch {
    // Network fallback
  }
  return INITIAL_XYZ_MARKETS
}
