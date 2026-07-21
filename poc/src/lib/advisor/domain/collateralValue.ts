import type { CollateralPosition, MarketContext } from '../types'

/** Volatility haircut applied to public equity tokens while markets are closed. */
export const MARKET_HOURS_HAIRCUT = 0.05

/** Forced haircut applied to a NAV-priced token whose feed has gone stale. */
export const STALE_NAV_HAIRCUT = 0.1

/** A NAV feed older than this (24h) is considered stale. */
export const NAV_STALE_MS = 24 * 60 * 60 * 1000

export type HaircutReason = 'market_hours' | 'stale_nav'

export interface CollateralValuation {
  /** Value before any haircut. */
  rawValueUsd: number
  /** Value after all applicable haircuts. */
  valueUsd: number
  /** Which haircuts were applied, in application order. */
  haircutsApplied: HaircutReason[]
}

/**
 * USD collateral value of a token position, with the oracle-strategy haircuts:
 *  - Public equity tokens take a market-hours volatility haircut when the
 *    reference market is closed (price is frozen at last close).
 *  - NAV-priced tokens (private company equity) take a forced haircut when the
 *    issuer's signed NAV feed is stale beyond 24 hours.
 *
 * The two guards are mutually exclusive by construction — a NAV token does not
 * follow public market hours — but are evaluated independently and stacked so
 * the model stays correct if that assumption is ever relaxed.
 */
export function collateralValueUsd(position: CollateralPosition, market: MarketContext): CollateralValuation {
  const rawValueUsd = position.quantity * position.priceUsd
  const haircutsApplied: HaircutReason[] = []
  let factor = 1

  if (position.token.usesNavFeed) {
    const age = market.now - position.priceAsOf
    if (age > NAV_STALE_MS) {
      factor *= 1 - STALE_NAV_HAIRCUT
      haircutsApplied.push('stale_nav')
    }
  } else if (!market.equityMarketOpen) {
    factor *= 1 - MARKET_HOURS_HAIRCUT
    haircutsApplied.push('market_hours')
  }

  return { rawValueUsd, valueUsd: rawValueUsd * factor, haircutsApplied }
}
