import { formatUnits, parseUnits } from 'viem'

export function parseTokenAmount(value: string, decimals: number): bigint | undefined {
  const trimmed = value.trim()
  if (!trimmed || !/^\d*(\.\d*)?$/.test(trimmed)) return undefined
  try {
    return parseUnits(trimmed, decimals)
  } catch {
    return undefined
  }
}

export function formatTokenAmount(value: bigint, decimals: number, precision = 2): string {
  const asNumber = Number(formatUnits(value, decimals))
  if (!Number.isFinite(asNumber)) return '0'
  return asNumber.toLocaleString(undefined, {
    maximumFractionDigits: precision,
    minimumFractionDigits: precision,
  })
}
