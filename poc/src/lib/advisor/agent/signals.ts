import type { UnderlyingId } from '../types'

/**
 * External signal feed registered by an institution, per the PRD Signal Feed
 * schema. Feeds influence recommendations only — never direct execution.
 * `validUntil` is a unix-ms timestamp (the PRD's ISO8601 normalised for the
 * engine); expired feeds are ignored.
 */
export interface SignalFeed {
  feedId: string
  /** `EQUITY:NVDA`, `STABLECOIN:USDe`, a token symbol, or `*` for portfolio-wide. */
  asset: string
  signalType:
    | 'volatility'
    | 'sentiment'
    | 'macro'
    | 'event'
    | 'correlation'
    | 'rwa_provider'
    | 'stablecoin_peg'
    | 'custom'
  /** Normalised signal magnitude, 0–1. */
  value: number
  direction: 'risk_on' | 'risk_off' | 'neutral'
  /** Feed's self-reported confidence, 0–1. */
  confidence: number
  /** Unix ms after which the feed is stale and ignored. */
  validUntil: number
  /** Human-readable source, shown in the UI. */
  sourceLabel: string
  /** Institution-assigned trust weight, 0–100. */
  trustWeight: number
}

/** Portfolio-wide asset scope token. */
export const PORTFOLIO_WIDE = '*'

/** Feeds that have not expired as of `now`. */
export function activeSignals(feeds: readonly SignalFeed[], now: number): SignalFeed[] {
  return feeds.filter(f => f.validUntil > now)
}

/**
 * Active feeds relevant to an underlying: an exact asset match plus any
 * portfolio-wide feeds. Matching is on the underlying id.
 */
export function signalsForAsset(
  feeds: readonly SignalFeed[],
  underlyingId: UnderlyingId,
  now: number,
): SignalFeed[] {
  return activeSignals(feeds, now).filter(f => f.asset === underlyingId || f.asset === PORTFOLIO_WIDE)
}

/**
 * Aggregate risk-off pressure from a set of feeds, in 0–1.
 *
 * Each risk-off feed contributes `value`, weighted by `trustWeight × confidence`;
 * risk-on feeds pull the score down symmetrically; neutral feeds are ignored.
 * The result is the trust-weighted mean of directional magnitudes, clamped to
 * [0, 1]. Used to tighten (or relax) the agent's intervention threshold.
 */
export function weightedRiskScore(feeds: readonly SignalFeed[]): number {
  let weightedSum = 0
  let totalWeight = 0
  for (const f of feeds) {
    if (f.direction === 'neutral') continue
    const weight = (f.trustWeight / 100) * f.confidence
    const signed = f.direction === 'risk_off' ? f.value : -f.value
    weightedSum += signed * weight
    totalWeight += weight
  }
  if (totalWeight === 0) return 0
  return Math.min(1, Math.max(0, weightedSum / totalWeight))
}
