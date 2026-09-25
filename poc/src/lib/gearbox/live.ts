import type { StrategyOpportunity } from '@gearbox-protocol/sdk/model'
import { GearboxAPI } from '@gearbox-protocol/sdk/offchain'
import { BOT_PARTIAL_LIQUIDATION, BotsPlugin } from '@gearbox-protocol/sdk/plugins/bots'
import { OnchainSDK, calcNetStrategyApy } from '@gearbox-protocol/sdk/onchain'
import type { Address } from 'viem'
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
export const MAINNET_RPC_URL = import.meta.env.VITE_MAINNET_RPC_URL || 'https://ethereum-rpc.publicnode.com'
export const MAINNET_STRATEGY_ID = 'wmooCurveETH+-WETH'
export const GEARBOX_API_URL = import.meta.env.VITE_GEARBOX_API_URL || 'https://api.gearbox.foundation'

export const gearboxApi = new GearboxAPI({ baseUrl: GEARBOX_API_URL, chainIds: [MAINNET_CHAIN_ID] })

const ETH_YIELD_TARGET_TOKEN = '0x02a4cceed3c400b5ba9fd22ad6ec18d8f7a3d48e' as Address
const MF_ONE_TARGET_TOKEN = '0x238a700eD6165261Cf8b2e544ba797BC11e466Ba' as Address
const MGLOBAL_TARGET_TOKEN = '0x7433806912Eae67919e66aea853d46Fa0aef98A8' as Address

export type CollateralApySource = 'backend' | 'nav'

interface AllowlistedTarget {
  targetToken: Address
  strategyId: string
  collateralApySource: CollateralApySource
}

const ALLOWLISTED_TARGETS: AllowlistedTarget[] = [
  { targetToken: ETH_YIELD_TARGET_TOKEN, strategyId: MAINNET_STRATEGY_ID, collateralApySource: 'backend' },
  // Both Midas RWAs price their collateral off a monthly/near-daily NAV
  // oracle rather than a market rate; the backend's collateralApy annualizes
  // that oracle over too short a window to be meaningful (seen as high as
  // 145%). Derive it on-chain from the NAV feed instead — see
  // calculateNavApyBps / fetchNavRounds.
  { targetToken: MF_ONE_TARGET_TOKEN, strategyId: 'mF-ONE', collateralApySource: 'nav' },
  { targetToken: MGLOBAL_TARGET_TOKEN, strategyId: 'mGLOBAL', collateralApySource: 'nav' },
]

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
  curator: { name?: string }
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
  /** On-chain opportunity name, e.g. "ETH+ / wstETH" — one per credit manager. */
  strategyName: string
  /** Symbol of the collateral the position is built around (e.g. mF-ONE), for display headings — never the deposit token. */
  targetSymbol: string
  /** On-chain curator name (e.g. "KPK"), or a generic fallback when unknown. */
  curator: string
  liquidationThresholdBps: number
  collateralApySource: CollateralApySource
}

let cachedOpportunities: Promise<LoadedGearboxOpportunity[]> | undefined
let attachedMainnetSdk: OnchainSDK | undefined

/**
 * The one `OnchainSDK` attached by `loadMainnetOpportunities`, for callers
 * (the strategy back-test's NAV history read) that need on-chain access but
 * aren't handed an `OpportunityView`'s sdk directly. Undefined before the
 * first successful load.
 */
export function getAttachedMainnetSdk(): OnchainSDK | undefined {
  return attachedMainnetSdk
}

export function resetGearboxOpportunityCache() {
  cachedOpportunities = undefined
  attachedMainnetSdk = undefined
}

export interface BuildRouteOptions {
  kycRegistrationLink?: string
  collateralApySource?: CollateralApySource
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
  { kycRegistrationLink, collateralApySource = 'backend' }: BuildRouteOptions = {},
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
    strategyName: opportunity.name,
    targetSymbol: opportunity.targetCollateral.symbol,
    curator: opportunity.curator.name ?? 'Gearbox',
    liquidationThresholdBps: opportunity.liquidationThreshold,
    collateralApySource,
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

/** One Chainlink-style aggregator round: whole-unit NAV price and its update time (unix seconds). */
export interface NavRound {
  price: number
  updatedAt: number
}

const YEAR_SECONDS = 365 * 24 * 60 * 60
const NAV_MIN_BASELINE_AGE_SECONDS = 90 * 24 * 60 * 60
const NAV_MIN_SPAN_SECONDS = 30 * 24 * 60 * 60

/**
 * Current collateral APY for a NAV-priced RWA target (mF-ONE, mGLOBAL):
 * compound-annualized NAV growth over a trailing ~90-day window. `rounds`
 * must be ordered oldest-first (ascending `updatedAt`), as read from the
 * aggregator. Walks backward from the round just before the latest one for
 * the first (closest to latest) round at least 90 days old; if none of the
 * given rounds reach that age, falls back to the oldest one given. Returns
 * undefined when fewer than two usable rounds are given, or the resulting
 * span is under 30 days — too short to annualize responsibly.
 */
export function calculateNavApyBps(rounds: readonly NavRound[], nowSeconds: number): number | undefined {
  const usable = rounds.filter(round => round.price > 0)
  if (usable.length < 2) return undefined

  const latest = usable[usable.length - 1]
  const cutoff = nowSeconds - NAV_MIN_BASELINE_AGE_SECONDS
  let baseline: NavRound | undefined
  for (let i = usable.length - 2; i >= 0; i--) {
    if (usable[i].updatedAt <= cutoff) {
      baseline = usable[i]
      break
    }
  }
  baseline ??= usable[0]

  const spanSeconds = latest.updatedAt - baseline.updatedAt
  if (spanSeconds < NAV_MIN_SPAN_SECONDS) return undefined

  const years = spanSeconds / YEAR_SECONDS
  const rate = Math.pow(latest.price / baseline.price, 1 / years) - 1
  return Math.round(rate * 10_000)
}

/** Annualized NAV growth of one segment between two consecutive rounds, for the strategy back-test's collateral-apy history. */
export interface NavApySegment {
  /**
   * START of the segment (the earlier round's `updatedAt`), seconds — not
   * the end. The back-test applies this rate going forward from here until
   * the next segment's timestamp, so anchoring at the end would apply each
   * segment's growth to the WRONG window (the one after it, not the one it
   * measured).
   */
  timestamp: number
  apyBps: number
}

/**
 * Builds one segment per consecutive pair of NAV rounds (oldest-first),
 * each annualizing that pair's growth with compounding, anchored at the
 * segment's start round. Leading segments with no growth at all (e.g.
 * mGLOBAL's rounds before the token started accruing) are trimmed —
 * history starts at the first round where the NAV actually begins to
 * move, never a flat pre-launch placeholder; an interior flat segment
 * (after accrual has started) is kept as a real 0%. Pure — rounds already
 * read on-chain.
 */
export function buildNavApySegments(rounds: readonly NavRound[]): NavApySegment[] {
  const usable = rounds.filter(round => round.price > 0)
  const segments: NavApySegment[] = []

  for (let i = 1; i < usable.length; i++) {
    const previous = usable[i - 1]
    const current = usable[i]
    const spanSeconds = current.updatedAt - previous.updatedAt
    if (spanSeconds <= 0) continue

    const apyBps = current.price === previous.price
      ? 0
      : Math.round((Math.pow(current.price / previous.price, YEAR_SECONDS / spanSeconds) - 1) * 10_000)
    segments.push({ timestamp: previous.updatedAt, apyBps })
  }

  const firstGrowthIndex = segments.findIndex(segment => segment.apyBps !== 0)
  return firstGrowthIndex === -1 ? [] : segments.slice(firstGrowthIndex)
}

const NAV_AGGREGATOR_ABI = [
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
  {
    type: 'function',
    name: 'getRoundData',
    stateMutability: 'view',
    inputs: [{ name: '_roundId', type: 'uint80' }],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const

const NAV_HISTORY_MAX_ROUNDS = 500
const NAV_HISTORY_BATCH_SIZE = 50
const NAV_HISTORY_MAX_AGE_SECONDS = YEAR_SECONDS

/**
 * Reads a NAV price feed's rounds back at least one year (or to round 1),
 * capped at 500 reads, batched via multicall. Returns oldest-first — ready
 * for both `calculateNavApyBps` and `buildNavApySegments` — or undefined
 * when the credit manager has no configured feed for `targetToken` or any
 * read fails.
 */
export async function fetchNavRounds(
  sdk: OnchainSDK,
  creditManager: Address,
  targetToken: Address,
): Promise<NavRound[] | undefined> {
  try {
    const feed = sdk.marketRegister.findCreditManager(creditManager).market.priceOracle.mainPriceFeeds.get(targetToken)
    if (!feed) return undefined

    const decimals = await sdk.client.readContract({
      address: feed.address,
      abi: NAV_AGGREGATOR_ABI,
      functionName: 'decimals',
    })
    const scale = 10 ** decimals

    const latest = await sdk.client.readContract({
      address: feed.address,
      abi: NAV_AGGREGATOR_ABI,
      functionName: 'latestRoundData',
    })
    const nowSeconds = Math.floor(Date.now() / 1000)
    const roundsNewestFirst: NavRound[] = [{ price: Number(latest[1]) / scale, updatedAt: Number(latest[3]) }]

    let nextRoundId = latest[0] - 1n
    while (
      roundsNewestFirst.length < NAV_HISTORY_MAX_ROUNDS &&
      nextRoundId > 0n &&
      nowSeconds - roundsNewestFirst[roundsNewestFirst.length - 1].updatedAt < NAV_HISTORY_MAX_AGE_SECONDS
    ) {
      const batchIds: bigint[] = []
      for (
        let i = 0;
        i < NAV_HISTORY_BATCH_SIZE && nextRoundId > 0n && roundsNewestFirst.length + batchIds.length < NAV_HISTORY_MAX_ROUNDS;
        i++
      ) {
        batchIds.push(nextRoundId)
        nextRoundId -= 1n
      }

      const results = await sdk.client.multicall({
        contracts: batchIds.map(roundId => ({
          address: feed.address,
          abi: NAV_AGGREGATOR_ABI,
          functionName: 'getRoundData',
          args: [roundId],
        } as const)),
      })

      for (const result of results) {
        if (result.status !== 'success') continue
        const [, answer, , updatedAt] = result.result
        roundsNewestFirst.push({ price: Number(answer) / scale, updatedAt: Number(updatedAt) })
      }
    }

    return roundsNewestFirst.reverse()
  } catch {
    return undefined
  }
}

/**
 * Collateral APY per credit manager from the Gearbox backend (`totalApy`,
 * fee-incl. Bps). Keyed by credit manager rather than target token: the
 * backend correctly gives each route its own value (e.g. a WETH ETH+ route
 * differs from its wstETH sibling), unlike the flat state-cache feed this
 * replaced. Any failure resolves to an empty map — apy renders as "n/a"
 * rather than throwing.
 */
async function fetchCollateralApysByCreditManager(): Promise<Map<Address, number>> {
  const result = new Map<Address, number>()
  try {
    const response = await gearboxApi.opportunities.list({ kind: 'strategy' })
    for (const opp of response.data) {
      if (opp.kind !== 'strategy') continue
      const totalApy = opp.collateralApy?.totalApy
      if (totalApy === undefined || totalApy === null) continue
      result.set(opp.creditManager.toLowerCase() as Address, totalApy)
    }
  } catch {
    // empty map — collateral apy renders as "n/a", never throws
  }
  return result
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
    attachedMainnetSdk = sdk
    await bots.load(true).catch(() => undefined)
    const botAddress = bots.loaded
      ? (bots.bots.find(bot => bot.contractType === BOT_PARTIAL_LIQUIDATION)?.address as Address | undefined)
      : undefined

    const collateralApysByCm = await fetchCollateralApysByCreditManager()
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
          const kycRegistrationLink = opp.rwa
            ? await sdk.opportunities
                .getStrategy({ chainId: MAINNET_CHAIN_ID, creditManager: opp.creditManager })
                .then(detail => detail.kyc?.registrationLink)
                .catch(() => undefined)
            : undefined
          const collateralApyBps = target.collateralApySource === 'nav'
            ? await fetchNavRounds(sdk, opp.creditManager, target.targetToken)
                .then(rounds => rounds && calculateNavApyBps(rounds, Math.floor(Date.now() / 1000)))
            : collateralApysByCm.get(opp.creditManager.toLowerCase() as Address)
          return buildCreditManagerRoute(opp, collateralApyBps, {
            kycRegistrationLink,
            collateralApySource: target.collateralApySource,
          })
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
    cachedOpportunities = loadMainnetOpportunitiesUncached().catch((error: unknown) => {
      cachedOpportunities = undefined
      throw error
    })
  }
  return cachedOpportunities
}
