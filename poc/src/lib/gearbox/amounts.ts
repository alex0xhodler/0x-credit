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

/**
 * Formats a raw token minimum, rounding UP at `displayDecimals` — never to
 * nearest, never down. `value` is typically already a ceiling-derived
 * minimum (see `calculateMinimumCollateralForDebt`), so displaying it with
 * fewer decimals via nearest/floor rounding can show an amount that is
 * itself below the true minimum. All arithmetic stays in bigint to avoid
 * float round-tripping.
 */
export function formatMinimumDeposit(value: bigint, decimals: number, displayDecimals = 4): string {
  if (displayDecimals >= decimals) {
    return formatUnits(value, decimals)
  }

  const divisor = 10n ** BigInt(decimals - displayDecimals)
  const ceiled = (value + divisor - 1n) / divisor
  const text = ceiled.toString().padStart(displayDecimals + 1, '0')
  const whole = text.slice(0, text.length - displayDecimals)
  const fraction = text.slice(text.length - displayDecimals)
  return displayDecimals === 0 ? whole : `${whole}.${fraction}`
}
