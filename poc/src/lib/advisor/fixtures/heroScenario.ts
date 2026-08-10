import type { CollateralPosition, DebtPosition, ProviderToken, Stablecoin, Underlying, UnderlyingId } from '../types'
import type { SignalFeed } from '../agent/signals'
import type { PositionState } from '../agent/engine'
import type { RouteQuote } from '../routing/costEngine'

/**
 * The canonical demo scenario: an institution holding a tokenized-equity basket
 * (NVDA / SPY / AAPL plus a SpaceX private-equity sleeve) borrowing a mixed
 * USDC / USDT / USDe book. An earnings-risk signal on NVDA drives the hero
 * semi-automatic flow: propose → edit → approve. All data is synthetic.
 */

/** Fixed market-open timestamp anchoring the scenario. */
export const HERO_NOW = Date.UTC(2026, 6, 21, 14, 30, 0)

/** USDe on-chain price for the scenario — the single source of truth for the peg. */
export const HERO_USDE_PRICE = 0.999

/**
 * Demo data only; a real deployment reads borrow rates from the venue (v2
 * RateModel). Shown in the onboarding wizard's stablecoin cards.
 */
export const HERO_BORROW_APR: Record<Stablecoin, number> = {
  USDC: 0.078,
  USDT: 0.084,
  USDe: 0.121,
}

export const HERO_UNDERLYINGS: Record<UnderlyingId, Underlying> = {
  'xyz:CL': { id: 'xyz:CL', symbol: 'xyz:CL', name: 'Crude Oil', tier: 'commodity', category: 'Commodity', volumeUsd: 65460000000, formattedVolume: '$65.46B' },
  'xyz:SILVER': { id: 'xyz:SILVER', symbol: 'xyz:SILVER', name: 'Silver', tier: 'commodity', category: 'Commodity', volumeUsd: 55340000000, formattedVolume: '$55.34B' },
  'xyz:XYZ100': { id: 'xyz:XYZ100', symbol: 'xyz:XYZ100', name: 'Tech 100 Index', tier: 'index', category: 'Index', volumeUsd: 51810000000, formattedVolume: '$51.81B' },
  'xyz:SP500': { id: 'xyz:SP500', symbol: 'xyz:SP500', name: 'S&P 500', tier: 'index', category: 'Index', volumeUsd: 30960000000, formattedVolume: '$30.96B' },
  'xyz:BRENTOIL': { id: 'xyz:BRENTOIL', symbol: 'xyz:BRENTOIL', name: 'Brent Crude', tier: 'commodity', category: 'Commodity', volumeUsd: 30410000000, formattedVolume: '$30.41B' },
  'xyz:SKHX': { id: 'xyz:SKHX', symbol: 'xyz:SKHX', name: 'SK Hynix', tier: 'equity', category: 'Equity', volumeUsd: 15150000000, formattedVolume: '$15.15B' },
  'xyz:MU': { id: 'xyz:MU', symbol: 'xyz:MU', name: 'Micron Technology', tier: 'equity', category: 'Equity', volumeUsd: 14550000000, formattedVolume: '$14.55B' },
  'xyz:GOLD': { id: 'xyz:GOLD', symbol: 'xyz:GOLD', name: 'Gold', tier: 'commodity', category: 'Commodity', volumeUsd: 13540000000, formattedVolume: '$13.54B' },
  'xyz:SPCX': { id: 'xyz:SPCX', symbol: 'xyz:SPCX', name: 'SpaceX', tier: 'private_equity', category: 'Private Equity', volumeUsd: 12350000000, formattedVolume: '$12.35B' },
  'xyz:SNDK': { id: 'xyz:SNDK', symbol: 'xyz:SNDK', name: 'SanDisk / Storage', tier: 'equity', category: 'Equity', volumeUsd: 9940000000, formattedVolume: '$9.94B' },
  'EQUITY:NVDA': { id: 'EQUITY:NVDA', symbol: 'NVDA', name: 'NVIDIA', tier: 'blue_chip' },
  'EQUITY:SPY': { id: 'EQUITY:SPY', symbol: 'SPY', name: 'S&P 500 ETF', tier: 'index_etf' },
  'EQUITY:AAPL': { id: 'EQUITY:AAPL', symbol: 'AAPL', name: 'Apple', tier: 'blue_chip' },
  'EQUITY:SPACEX': { id: 'EQUITY:SPACEX', symbol: 'SPACEX', name: 'SpaceX', tier: 'private_equity' },
}

const providerToken = (
  address: string,
  underlyingId: UnderlyingId,
  issuer: string,
  providerRiskScore: ProviderToken['providerRiskScore'],
  extra: Partial<ProviderToken> = {},
): ProviderToken => ({
  address,
  underlyingId,
  issuer,
  providerRiskScore,
  liquidityTier: 'high',
  redemptionType: 'direct',
  usesNavFeed: false,
  ...extra,
})

const equityPos = (token: ProviderToken, valueUsd: number): CollateralPosition => ({
  token,
  quantity: valueUsd / 100,
  priceUsd: 100,
  priceAsOf: HERO_NOW,
})

// $12.5M basket. NVDA split across two providers to showcase aggregation.
export const HERO_COLLATERAL: CollateralPosition[] = [
  equityPos(providerToken('0xbnvda', 'EQUITY:NVDA', 'Backed Finance', 5), 3_000_000),
  equityPos(providerToken('0xonvda', 'EQUITY:NVDA', 'Ondo', 4), 2_000_000),
  equityPos(providerToken('0xbspy', 'EQUITY:SPY', 'Backed Finance', 5), 3_750_000),
  equityPos(providerToken('0xbaapl', 'EQUITY:AAPL', 'Backed Finance', 5), 2_500_000),
  {
    token: providerToken('0xspacex', 'EQUITY:SPACEX', 'Specialist RWA Co', 3, {
      liquidityTier: 'low',
      redemptionType: 'private_placement',
      usesNavFeed: true,
    }),
    quantity: 12_500,
    priceUsd: 100,
    priceAsOf: HERO_NOW - 60 * 60 * 1000, // 1h old NAV — fresh
  },
]

// $5M borrow: USDC-dominant, within USDT (60%) and USDe (40%) share caps.
export const HERO_DEBTS: DebtPosition[] = [
  { stablecoin: 'USDC', amount: 3_000_000, priceUsd: 1 },
  { stablecoin: 'USDT', amount: 1_200_000, priceUsd: 1 },
  { stablecoin: 'USDe', amount: 800_000, priceUsd: HERO_USDE_PRICE },
]

export const HERO_TARGET_WEIGHTS: Record<UnderlyingId, number> = {
  'EQUITY:NVDA': 0.4,
  'EQUITY:SPY': 0.3,
  'EQUITY:AAPL': 0.2,
  'EQUITY:SPACEX': 0.1,
}

export const HERO_SIGNALS: SignalFeed[] = [
  {
    feedId: 'nvda-earnings-48h',
    asset: 'EQUITY:NVDA',
    signalType: 'event',
    value: 0.85,
    direction: 'risk_off',
    confidence: 0.9,
    validUntil: HERO_NOW + 48 * 60 * 60 * 1000,
    sourceLabel: 'Refinitiv earnings calendar',
    trustWeight: 90,
  },
]

export const HERO_STATE: PositionState = {
  collateral: HERO_COLLATERAL,
  debts: HERO_DEBTS,
  underlyings: HERO_UNDERLYINGS,
  targetWeights: HERO_TARGET_WEIGHTS,
  market: { equityMarketOpen: true, now: HERO_NOW },
  signals: HERO_SIGNALS,
}

/**
 * Candidate routes for the hero NVDA→SPY de-risk rotation (~$1.6M). The issuer
 * mint/redeem path wins on total cost despite its fee, demonstrating the
 * cost-driven venue choice across DEX and issuer RFQ.
 */
export const HERO_ROTATION_ROUTES: RouteQuote[] = [
  {
    routeId: 'dex-multihop',
    venue: 'dex',
    steps: [
      { venue: 'dex', fromToken: 'bNVDA', toToken: 'USDC', poolOrIssuer: '0xnvdaPool' },
      { venue: 'dex', fromToken: 'USDC', toToken: 'bSPY', poolOrIssuer: '0xspyPool' },
    ],
    notionalUsd: 1_593_750,
    slippage: 0.004,
    gasUsd: 8,
    feeUsd: 0,
    providerRiskScore: 5,
  },
  {
    routeId: 'issuer-rfq',
    venue: 'issuer_rfq',
    steps: [
      { venue: 'issuer_rfq', fromToken: 'bNVDA', toToken: 'USDC', poolOrIssuer: 'Backed Finance' },
      { venue: 'issuer_rfq', fromToken: 'USDC', toToken: 'bSPY', poolOrIssuer: 'Backed Finance' },
    ],
    notionalUsd: 1_593_750,
    slippage: 0.0006,
    gasUsd: 5,
    feeUsd: 800,
    providerRiskScore: 5,
  },
]
