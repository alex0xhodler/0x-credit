import type { StrategyOpportunity } from '@gearbox-protocol/sdk/model'
import { BOT_PARTIAL_LIQUIDATION, BotsPlugin } from '@gearbox-protocol/sdk/plugins/bots'
import { OnchainSDK, calcNetStrategyApy } from '@gearbox-protocol/sdk/onchain'
import type { Address } from 'viem'
import { fetchCollateralApys } from './apyFeed'
import {
  calculateLeverageForTargetHealthFactor,
  calculateMinimumCollateralForDebt,
  formatOpportunityApy,
} from './plan'

export const MAINNET_CHAIN_ID = 1
export const DEFAULT_SLIPPAGE_BPS = 50
export const DEFAULT_QUOTA_RESERVE_BPS = 500n
export const TARGET_HEALTH_FACTOR_BPS = 10_400n
export const TARGET_HEALTH_FACTOR_EXECUTION_BUFFER_BPS = 15n
export const DEFAULT_GEARBOX_APY_URL = '/gearbox-apy/latest.json'
export const MAINNET_RPC_URL = import.meta.env.VITE_MAINNET_RPC_URL || 'https://ethereum-rpc.publicnode.com'
export const MAINNET_STRATEGY_ID = 'wmooCurveETH+-WETH'
export const GEARBOX_APY_URL = resolveGearboxApyUrl(import.meta.env.VITE_GEARBOX_APY_URL)

const ETH_YIELD_TARGET_TOKEN = '0x02a4cceed3c400b5ba9fd22ad6ec18d8f7a3d48e' as Address
const MF_ONE_TARGET_TOKEN = '0x238a700eD6165261Cf8b2e544ba797BC11e466Ba' as Address
const MGLOBAL_TARGET_TOKEN = '0x7433806912Eae67919e66aea853d46Fa0aef98A8' as Address

interface AllowlistedTarget {
  targetToken: Address
  strategyId: string
}

const ALLOWLISTED_TARGETS: AllowlistedTarget[] = [
  { targetToken: ETH_YIELD_TARGET_TOKEN, strategyId: MAINNET_STRATEGY_ID },
  { targetToken: MF_ONE_TARGET_TOKEN, strategyId: 'mF-ONE' },
  { targetToken: MGLOBAL_TARGET_TOKEN, strategyId: 'mGLOBAL' },
]

export function resolveGearboxApyUrl(url: string | undefined): string {
  if (!url) return DEFAULT_GEARBOX_APY_URL
  if (url.startsWith('/gearbox-apy/')) return url
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.toString()
      : DEFAULT_GEARBOX_APY_URL
  } catch {
    return DEFAULT_GEARBOX_APY_URL
  }
}

/**
 * Subset of `StrategyOpportunity` (from `@gearbox-protocol/sdk/model`) that
 * `buildCreditManagerRoute` needs. Kept as a structural type so the route
 * builder can be unit-tested without a live SDK/network connection.
 */
export interface StrategyOpportunityLike {
  creditManager: Address
  targetCollateral: { address: Address; symbol: string; decimals: number }
  underlyingToken: { address: Address; symbol: string; decimals: number }
  name: string
  rwa: boolean
  sunset: boolean
  paused: boolean
  liquidationThreshold: number
  borrowApy: number
  quotaRate: number
  minDebt: { value: bigint; valueUsd: number | null }
  maxBorrowAmount: { value: bigint; valueUsd: number | null }
  availableLiquidity: { value: bigint; valueUsd: number | null }
  maxLeverage: number
}

export interface LoadedGearboxOpportunity {
  sdk: OnchainSDK
  strategyId: string
  strategyName: string
  targetToken: Address
  creditManager: Address
  collateralToken: Address
  collateralSymbol: string
  collateralDecimals: number
  chainName: string
  maxApy: number | undefined
  apyLabel: string
  maxLeverage: bigint
  minimumDepositAmount: bigint
  leverageLabel: string
  botAddress?: Address
  rwa: boolean
  creditManagers: GearboxCreditManagerRoute[]
}

export interface GearboxCreditManagerRoute {
  address: Address
  apy: number | undefined
  baseApy: number | undefined
  maxLeverage: bigint
  minimumDepositAmount: bigint
  minDebt: bigint
  maxDebt: bigint
  availableToBorrow: bigint
  baseBorrowRate: number
  baseQuotaRateWithFee: bigint
  totalBorrowRate: number
  collateralToken: Address
  collateralSymbol: string
  collateralDecimals: number
  rwa: boolean
  kycRegistrationLink?: string
}

let cachedOpportunities: Promise<LoadedGearboxOpportunity[]> | undefined

export function resetGearboxOpportunityCache() {
  cachedOpportunities = undefined
}

/**
 * Builds an app-level credit manager route from an on-chain strategy
 * opportunity plus the off-chain collateral APY (undefined while the feed is
 * still loading or has no data for this token). Pure and network-free.
 *
 * Units: `opportunity.borrowApy` / `quotaRate` / `collateralApyBps` are SDK
 * Bps (1% = 100); every rate field on the returned route is in app units
 * (1% = 10_000), matching `GearboxCreditManagerRoute`'s existing fields.
 */
export function buildCreditManagerRoute(
  opportunity: StrategyOpportunityLike,
  collateralApyBps: number | undefined,
  kycRegistrationLink?: string,
): GearboxCreditManagerRoute {
  const maxLeverage = calculateLeverageForTargetHealthFactor({
    liquidationThresholdBps: BigInt(opportunity.liquidationThreshold),
    maxLeverage: BigInt(Math.floor(opportunity.maxLeverage * 100)),
    targetHealthFactorBps: TARGET_HEALTH_FACTOR_BPS + TARGET_HEALTH_FACTOR_EXECUTION_BUFFER_BPS,
  })

  const apy = collateralApyBps === undefined
    ? undefined
    : calcNetStrategyApy(opportunity, collateralApyBps, Number(maxLeverage) / 100, 'aggressive') * 100
  const baseApy = collateralApyBps === undefined ? undefined : collateralApyBps * 100

  const baseBorrowRate = opportunity.borrowApy * 100
  const baseQuotaRateWithFee = BigInt(Math.round(opportunity.quotaRate * 100))
  const totalBorrowRate = baseBorrowRate + Number(baseQuotaRateWithFee)

  return {
    address: opportunity.creditManager,
    apy,
    baseApy,
    maxLeverage,
    minimumDepositAmount: calculateMinimumCollateralForDebt({
      minDebt: opportunity.minDebt.value,
      leverage: maxLeverage,
    }),
    minDebt: opportunity.minDebt.value,
    maxDebt: opportunity.maxBorrowAmount.value,
    availableToBorrow: opportunity.availableLiquidity.value,
    baseBorrowRate,
    baseQuotaRateWithFee,
    totalBorrowRate,
    // For an RWA strategy the target collateral is the wrapped/gated share
    // token (e.g. mF-ONE); deposits and route accounting stay in the credit
    // manager's underlying (e.g. frxUSD), never in allowedDepositTokens.
    collateralToken: opportunity.underlyingToken.address,
    collateralSymbol: opportunity.underlyingToken.symbol,
    collateralDecimals: opportunity.underlyingToken.decimals,
    rwa: opportunity.rwa,
    kycRegistrationLink,
  }
}

export function selectBestCreditManagerForAmount(
  creditManagers: GearboxCreditManagerRoute[],
  collateralAmount: bigint | undefined,
): GearboxCreditManagerRoute | undefined {
  if (creditManagers.length === 0) return undefined
  if (!collateralAmount || collateralAmount <= 0n) {
    return [...creditManagers].sort(compareCreditManagerRoutes)[0]
  }

  const compatible = creditManagers.filter(cm => {
    const debt = (collateralAmount * (cm.maxLeverage - 100n)) / 100n
    return debt >= cm.minDebt && debt <= cm.maxDebt && debt <= cm.availableToBorrow
  })

  return [...compatible].sort(compareCreditManagerRoutes)[0]
}

function compareCreditManagerRoutes(a: GearboxCreditManagerRoute, b: GearboxCreditManagerRoute): number {
  const apyA = a.apy ?? Number.NEGATIVE_INFINITY
  const apyB = b.apy ?? Number.NEGATIVE_INFINITY
  if (apyA !== apyB) return apyB - apyA
  if (a.baseBorrowRate !== b.baseBorrowRate) return a.baseBorrowRate - b.baseBorrowRate
  if (a.availableToBorrow !== b.availableToBorrow) return a.availableToBorrow > b.availableToBorrow ? -1 : 1
  if (a.minDebt !== b.minDebt) return a.minDebt < b.minDebt ? -1 : 1
  return a.address.localeCompare(b.address)
}

async function attachWithRetry(sdk: OnchainSDK): Promise<void> {
  try {
    await sdk.attach()
  } catch {
    await sdk.attach()
  }
}

export async function checkStrategyEligibility(
  sdk: OnchainSDK,
  creditManager: Address,
  wallet: Address,
): Promise<boolean> {
  return sdk.opportunities.isEligibleForStrategy({ chainId: MAINNET_CHAIN_ID, creditManager }, wallet)
}

function loadMainnetOpportunitiesUncached(): Promise<LoadedGearboxOpportunity[]> {
  return (async () => {
    const bots = new BotsPlugin(true)
    const sdk = new OnchainSDK(
      'Mainnet',
      {
        rpcURLs: [MAINNET_RPC_URL],
        timeout: 60_000,
      },
      {
        gasLimit: null,
        plugins: { bots },
      },
    )

    await attachWithRetry(sdk)
    await bots.load(true).catch(() => undefined)
    const botAddress = bots.loaded
      ? (bots.bots.find(bot => bot.contractType === BOT_PARTIAL_LIQUIDATION)?.address as Address | undefined)
      : undefined

    const collateralApys = await fetchCollateralApys(GEARBOX_APY_URL, MAINNET_CHAIN_ID)
    const allOpportunities = await sdk.opportunities.list({ kind: 'strategy' })

    const results: LoadedGearboxOpportunity[] = []

    for (const target of ALLOWLISTED_TARGETS) {
      const liveOpportunities = allOpportunities.filter(
        (opp): opp is StrategyOpportunity =>
          opp.kind === 'strategy' &&
          opp.targetCollateral.address.toLowerCase() === target.targetToken.toLowerCase() &&
          !opp.sunset &&
          !opp.paused,
      )
      if (liveOpportunities.length === 0) continue

      const routes = await Promise.all(
        liveOpportunities.map(async opp => {
          const collateralApyBps = collateralApys.get(target.targetToken.toLowerCase() as Address)
          const kycRegistrationLink = opp.rwa
            ? await sdk.opportunities
                .getStrategy({ chainId: MAINNET_CHAIN_ID, creditManager: opp.creditManager })
                .then(detail => detail.kyc?.registrationLink)
                .catch(() => undefined)
            : undefined
          return buildCreditManagerRoute(opp, collateralApyBps, kycRegistrationLink)
        }),
      )

      const selected = selectBestCreditManagerForAmount(routes, undefined)
      const first = liveOpportunities[0]

      results.push({
        sdk,
        strategyId: target.strategyId,
        strategyName: first.name,
        targetToken: target.targetToken,
        creditManager: (selected?.address ?? first.creditManager) as Address,
        collateralToken: (selected?.collateralToken ?? routes[0].collateralToken) as Address,
        collateralSymbol: selected?.collateralSymbol ?? routes[0].collateralSymbol,
        collateralDecimals: selected?.collateralDecimals ?? routes[0].collateralDecimals,
        chainName: 'Mainnet',
        maxApy: selected?.apy,
        apyLabel: formatOpportunityApy(selected?.apy),
        maxLeverage: selected?.maxLeverage ?? routes[0].maxLeverage,
        minimumDepositAmount: selected?.minimumDepositAmount ?? routes[0].minimumDepositAmount,
        leverageLabel: `${(Number(selected?.maxLeverage ?? routes[0].maxLeverage) / 100).toFixed(2)}x target`,
        botAddress,
        rwa: first.rwa,
        creditManagers: routes,
      })
    }

    return results
  })()
}

export function loadMainnetOpportunities(): Promise<LoadedGearboxOpportunity[]> {
  if (!cachedOpportunities) {
    cachedOpportunities = loadMainnetOpportunitiesUncached()
  }
  return cachedOpportunities
}
