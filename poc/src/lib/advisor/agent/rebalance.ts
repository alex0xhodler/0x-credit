import type { CollateralPosition, DebtPosition, Stablecoin, UnderlyingId } from '../types'

/** Raw (pre-haircut) market value of a collateral position. */
export function rawValueUsd(position: CollateralPosition): number {
  return position.quantity * position.priceUsd
}

/** Total raw market value held for an underlying across its provider tokens. */
export function underlyingRawValueUsd(
  collateral: readonly CollateralPosition[],
  underlyingId: UnderlyingId,
): number {
  return collateral
    .filter(p => p.token.underlyingId === underlyingId)
    .reduce((acc, p) => acc + rawValueUsd(p), 0)
}

/**
 * Scales an underlying's holdings by a signed USD market-value delta, spread
 * pro-rata across its provider tokens by current value. A reduction is clamped
 * so quantity never goes negative; growing an underlying requires an existing
 * position to scale (v1 does not synthesise new provider tokens here). Returns a
 * new collateral array; inputs are not mutated.
 */
export function adjustUnderlyingValue(
  collateral: readonly CollateralPosition[],
  underlyingId: UnderlyingId,
  deltaUsd: number,
): CollateralPosition[] {
  const current = underlyingRawValueUsd(collateral, underlyingId)
  if (current === 0) return collateral.map(p => ({ ...p }))

  const clampedDelta = Math.max(deltaUsd, -current)
  const factor = (current + clampedDelta) / current

  return collateral.map(p =>
    p.token.underlyingId === underlyingId ? { ...p, quantity: p.quantity * factor } : { ...p },
  )
}

/**
 * Rotates `valueUsd` of market value out of one underlying and into another,
 * keeping total collateral constant — the basket-drift / de-risk primitive.
 */
export function rotateExposure(
  collateral: readonly CollateralPosition[],
  fromUnderlying: UnderlyingId,
  toUnderlying: UnderlyingId,
  valueUsd: number,
): CollateralPosition[] {
  const trimmed = adjustUnderlyingValue(collateral, fromUnderlying, -valueUsd)
  return adjustUnderlyingValue(trimmed, toUnderlying, valueUsd)
}

/** Reduces a stablecoin's outstanding debt by up to `amountUsd`. */
export function applyRepayment(
  debts: readonly DebtPosition[],
  stablecoin: Stablecoin,
  amountUsd: number,
): DebtPosition[] {
  return debts.map(d => {
    if (d.stablecoin !== stablecoin) return { ...d }
    const repayUnits = Math.min(d.amount, amountUsd / d.priceUsd)
    return { ...d, amount: d.amount - repayUnits }
  })
}
