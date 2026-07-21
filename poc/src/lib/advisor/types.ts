/**
 * Shared type model for the agentic robo-advisor.
 *
 * Two layers, per the PRD:
 *  - Token layer   — the actual ERC-20 a provider issues (e.g. bNVDA, ONVDA).
 *                    Carries its own LTV parameters and provider risk profile.
 *  - Underlying layer — the economic exposure the token represents (e.g. NVDA).
 *                    The agent, basket manager, and UI operate here; routing
 *                    silently translates between the two.
 */

/** Economic exposure identifier, e.g. `EQUITY:NVDA`, `EQUITY:SPACEX`. */
export type UnderlyingId = string

/** Risk classification of the underlying asset. Drives base LTV tiers. */
export type UnderlyingTier =
  | 'blue_chip' // Blue-chip public equity — tAAPL, tMSFT, bNVDA
  | 'index_etf' // Index / ETF token — tSPY, tQQQ
  | 'small_mid_cap' // Higher-volatility public equity
  | 'private_equity' // e.g. SpaceX — illiquid, bespoke NAV pricing
  | 'treasury' // Tokenized US Treasury / cash-equivalent products — mTBILL, mBASIS, BUIDL; the safest collateral tier

/**
 * Protocol-assigned provider score (1–5) reflecting issuer credit risk,
 * regulatory standing, and operational track record. 5 is best.
 */
export type ProviderRiskScore = 1 | 2 | 3 | 4 | 5

/** On-chain DEX liquidity depth classification for a provider token. */
export type LiquidityTier = 'high' | 'medium' | 'low'

/** How the underlying shares can be redeemed with the issuer. */
export type RedemptionType = 'direct' | 'secondary_only' | 'private_placement'

/** Supported borrow stablecoins. */
export type Stablecoin = 'USDC' | 'USDT' | 'USDe'

export interface Underlying {
  id: UnderlyingId
  /** Ticker-style display symbol, e.g. `NVDA`. */
  symbol: string
  name: string
  tier: UnderlyingTier
}

/** A specific provider's tokenized representation of an underlying. */
export interface ProviderToken {
  /** ERC-20 contract address (lowercased). */
  address: string
  underlyingId: UnderlyingId
  /** Registered RWA provider name, e.g. `Backed Finance`. */
  issuer: string
  providerRiskScore: ProviderRiskScore
  liquidityTier: LiquidityTier
  redemptionType: RedemptionType
  /** Whether this token prices off an issuer NAV feed rather than a public market. */
  usesNavFeed: boolean
}

/** A held collateral position at the token level. */
export interface CollateralPosition {
  token: ProviderToken
  /** Token quantity held, in whole units (not wei). */
  quantity: number
  /** Latest oracle/NAV price in USD per unit. */
  priceUsd: number
  /** Unix ms of the price observation. Used for NAV staleness checks. */
  priceAsOf: number
}

/** A held debt position in a single stablecoin. */
export interface DebtPosition {
  stablecoin: Stablecoin
  /** Outstanding principal + accrued interest, in stablecoin units. */
  amount: number
  /** Latest oracle price of the stablecoin in USD (≈ 1.0). */
  priceUsd: number
}

/** Market-session context used to apply the market-hours guard. */
export interface MarketContext {
  /** Whether the reference equity market is currently open. */
  equityMarketOpen: boolean
  /** Current wall-clock time (unix ms). */
  now: number
}
