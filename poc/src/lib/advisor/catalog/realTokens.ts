import type { ProviderToken, Underlying, UnderlyingId } from '../types'
import { HERO_UNDERLYINGS } from '../fixtures/heroScenario'

/**
 * Real, Gearbox-supported RWA catalog: tokenized US Treasury / cash-equivalent
 * products from Midas (mTBILL, mBASIS) and Securitize (BUIDL).
 *
 * Addresses below were verified against Etherscan and are used exactly as
 * checksummed. `@gearbox-protocol/sdk` has no static token list — markets and
 * tokens are discovered at runtime via `attach()` — so these addresses are
 * this demo's own catalog entries, not values read from the SDK; the Midas
 * and Securitize issuance/redemption vault adapters that make these
 * underlyings usable as Gearbox collateral first shipped in
 * `@gearbox-protocol/sdk` >= 14.11. LTV parameters below remain this demo
 * engine's tier table ({@link BASE_LTV_TIERS}.treasury) — Gearbox's real
 * liquidation thresholds are per-credit-manager and would be read live via
 * `attach()` in a production integration, not hardcoded here.
 */

/** Midas US Treasury Bill Token — verified against Etherscan. */
export const MTBILL_ADDRESS = '0xDD629E5241CbC5919847783e6C96B2De4754e438'
/** Midas Basis Trading Token — verified against Etherscan. */
export const MBASIS_ADDRESS = '0x2a8c22E3b10036f3AEF5875d04f8441d4188b656'
/** BlackRock USD Institutional Digital Liquidity Fund (Securitize) — verified against Etherscan. */
export const BUIDL_ADDRESS = '0x7712c34205737192402172409a8F7ccef8aA2AEc'

export const REAL_UNDERLYINGS: Record<UnderlyingId, Underlying> = {
  'RWA:MTBILL': { id: 'RWA:MTBILL', symbol: 'mTBILL', name: 'Midas US Treasury Bill', tier: 'treasury' },
  'RWA:MBASIS': { id: 'RWA:MBASIS', symbol: 'mBASIS', name: 'Midas Basis Trading', tier: 'treasury' },
  'RWA:BUIDL': {
    id: 'RWA:BUIDL',
    symbol: 'BUIDL',
    name: 'BlackRock USD Institutional Digital Liquidity Fund',
    tier: 'treasury',
  },
}

export const REAL_PROVIDER_TOKENS: ProviderToken[] = [
  {
    address: MTBILL_ADDRESS.toLowerCase(),
    underlyingId: 'RWA:MTBILL',
    issuer: 'Midas',
    providerRiskScore: 4,
    liquidityTier: 'medium',
    redemptionType: 'direct',
    usesNavFeed: true,
  },
  {
    // Delta-neutral basis trading strategy — riskier than a plain T-bill token, so a lower provider score.
    address: MBASIS_ADDRESS.toLowerCase(),
    underlyingId: 'RWA:MBASIS',
    issuer: 'Midas',
    providerRiskScore: 3,
    liquidityTier: 'medium',
    redemptionType: 'direct',
    usesNavFeed: true,
  },
  {
    address: BUIDL_ADDRESS.toLowerCase(),
    underlyingId: 'RWA:BUIDL',
    issuer: 'Securitize',
    providerRiskScore: 5,
    liquidityTier: 'medium',
    redemptionType: 'direct',
    usesNavFeed: true,
  },
]

/** Provenance of each catalog underlying — RWA rows are real Gearbox-supported assets; hero equities remain the illustrative demo scenario. */
export const CATALOG_SOURCE: Record<UnderlyingId, 'gearbox_sdk' | 'illustrative'> = {
  'RWA:MTBILL': 'gearbox_sdk',
  'RWA:MBASIS': 'gearbox_sdk',
  'RWA:BUIDL': 'gearbox_sdk',
  ...Object.fromEntries(Object.keys(HERO_UNDERLYINGS).map(id => [id, 'illustrative' as const])),
}

/** The full onboarding catalog: hero (illustrative) equities plus the real RWA underlyings. */
export const CATALOG_UNDERLYINGS: Record<UnderlyingId, Underlying> = { ...HERO_UNDERLYINGS, ...REAL_UNDERLYINGS }
