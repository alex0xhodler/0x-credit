import type { ProviderRiskScore } from '../types'

/** Default per-operation max slippage tolerance (0.5%). */
export const MAX_SLIPPAGE_DEFAULT = 0.005

export type RouteVenue = 'dex' | 'issuer_rfq'

export interface RouteStep {
  venue: RouteVenue
  fromToken: string
  toToken: string
  /** DEX pool address or issuer name — the execution venue for this hop. */
  poolOrIssuer: string
}

/**
 * A candidate execution path for one underlying-level operation. In v1 these
 * are supplied by fixtures; on-chain they would be built from the live Routing
 * Graph. Cost is slippage + gas + venue fee.
 */
export interface RouteQuote {
  routeId: string
  venue: RouteVenue
  steps: RouteStep[]
  notionalUsd: number
  /** Estimated slippage as a fraction of notional. */
  slippage: number
  gasUsd: number
  /** Protocol / issuer fee in USD. */
  feeUsd: number
  /** Provider risk score of the token being acquired, for tie-breaking. */
  providerRiskScore?: ProviderRiskScore
}

export type RejectionReason = 'slippage_exceeds_tolerance'

export interface RejectedRoute {
  quote: RouteQuote
  reason: RejectionReason
}

export interface RouteComparison {
  /** Lowest-cost viable route, or undefined if none satisfy the constraints. */
  best?: RouteQuote
  /** Viable routes, cheapest first. */
  viable: RouteQuote[]
  /** Rejected routes with reasons — the compliance audit trail. */
  rejected: RejectedRoute[]
}

/** Total execution cost of a route: slippage + gas + fee, in USD. */
export function totalCostUsd(quote: RouteQuote): number {
  return quote.slippage * quote.notionalUsd + quote.gasUsd + quote.feeUsd
}

/**
 * Selects the best-execution route across venues, per the PRD routing
 * principles: filter routes exceeding the slippage guardrail, rank the rest by
 * total cost, and break ties toward the higher-provider-score token to maximise
 * effective LTV. Rejected routes are retained with reasons so the operation is
 * fully auditable even though routing is invisible in the primary UI.
 */
export function compareRoutes(
  quotes: readonly RouteQuote[],
  options: { maxSlippage?: number } = {},
): RouteComparison {
  const maxSlippage = options.maxSlippage ?? MAX_SLIPPAGE_DEFAULT

  const rejected: RejectedRoute[] = []
  const viable: RouteQuote[] = []
  for (const q of quotes) {
    if (q.slippage > maxSlippage) rejected.push({ quote: q, reason: 'slippage_exceeds_tolerance' })
    else viable.push(q)
  }

  viable.sort((a, b) => {
    const costDelta = totalCostUsd(a) - totalCostUsd(b)
    if (Math.abs(costDelta) > 1e-9) return costDelta
    // Equivalent cost → prefer the higher provider risk score.
    return (b.providerRiskScore ?? 0) - (a.providerRiskScore ?? 0)
  })

  return { best: viable[0], viable, rejected }
}
