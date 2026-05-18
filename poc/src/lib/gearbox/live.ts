import { OnchainSDK } from '@gearbox-protocol/sdk'
import { ApyPlugin } from '@gearbox-protocol/sdk/plugins/apy'
import { BotsPlugin } from '@gearbox-protocol/sdk/plugins/bots'
import { RemoteConfigsPlugin } from '@gearbox-protocol/sdk/plugins/remote-configs'
import type { Address } from 'viem'
import {
  calculateApyForLeverage,
  calculateLeverageForTargetHealthFactor,
  calculateMinimumCollateralForDebt,
  formatOpportunityApy,
} from './plan'

export const STRATEGY_ID = 'AUSDCT0'
export const TARGET_TOKEN = '0x942644106B073E30D72c2C5D7529D5C296ea91ab' as Address
export const MONAD_CHAIN_ID = 143
export const DEFAULT_SLIPPAGE_BPS = 50
export const DEFAULT_QUOTA_RESERVE_BPS = 500n
export const TARGET_HEALTH_FACTOR_BPS = 10_300n
export const TARGET_HEALTH_FACTOR_EXECUTION_BUFFER_BPS = 15n
export const MONAD_RPC_URL = import.meta.env.VITE_MONAD_RPC_URL || 'https://rpc.monad.xyz'
export const GEARBOX_APY_URL = import.meta.env.VITE_GEARBOX_APY_URL
  || 'https://state-cache.gearbox.foundation/apy-server/latest.json'

interface StrategyConfigLike {
  id: string
  name: string
  tokenOutAddress: Address
  creditManagers: Address[]
  maxLeverage?: number
}

interface StrategyCreditManagerLike {
  address: Address
  baseBorrowRate: number
  availableToBorrow: bigint
  feeInterest: number
  minDebt: bigint
  maxDebt: bigint
  quotas: Record<Address, { rate: bigint | number; isActive: boolean } | undefined>
}

const FALLBACK_STRATEGY: StrategyConfigLike = {
  id: STRATEGY_ID,
  name: 'Curve AUSD/USDC/USDT0',
  tokenOutAddress: TARGET_TOKEN,
  creditManagers: [
    '0xf6f044485ac54eecbddfd71586daf351c3ebda88',
    '0xeCa8b626B91fbf1191230C5d11D5f5ebC1ADbB04',
    '0x3626c30d386f5900a444b77464ae1b78f8281481',
    '0xe756919cc2e2b6e844a45dbbacf566b85cb928ab',
  ],
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
  creditManagers: GearboxCreditManagerRoute[]
}

export interface GearboxCreditManagerRoute {
  address: Address
  apy: number | undefined
  maxLeverage: bigint
  minimumDepositAmount: bigint
  minDebt: bigint
  maxDebt: bigint
  availableToBorrow: bigint
  baseBorrowRate: number
  baseQuotaRateWithFee: bigint
}

let cachedOpportunity: Promise<LoadedGearboxOpportunity> | undefined

export function resetGearboxOpportunityCache() {
  cachedOpportunity = undefined
}

export function loadGearboxOpportunity(): Promise<LoadedGearboxOpportunity> {
  cachedOpportunity ??= createGearboxOpportunity()
  return cachedOpportunity
}

function addressKey(address: Address): Address {
  return address.toLowerCase() as Address
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

function getSingleQuotaRateWithFee(creditManager: StrategyCreditManagerLike, targetToken: Address): bigint {
  const quota = creditManager.quotas[addressKey(targetToken)]
  if (!quota?.isActive) return 0n
  return (BigInt(quota.rate) * BigInt(10_000 + creditManager.feeInterest)) / 10_000n
}

async function createGearboxOpportunity(): Promise<LoadedGearboxOpportunity> {
  const remoteConfigs = new RemoteConfigsPlugin(true)
  const apy = new ApyPlugin(true, { apyUrl: GEARBOX_APY_URL })
  const bots = new BotsPlugin(true)

  const sdk = new OnchainSDK(
    'Monad',
    {
      rpcURLs: [MONAD_RPC_URL],
      timeout: 60_000,
    },
    {
      gasLimit: null,
      plugins: {
        remoteConfigs,
        apy,
        bots,
      },
    },
  )

  await sdk.attach()

  await remoteConfigs.load(true).catch(() => undefined)
  await apy.load(true).catch(() => undefined)
  await bots.load(true).catch(() => undefined)

  const strategy = (
    remoteConfigs.loaded
      ? remoteConfigs.strategies.find(item => item.id === STRATEGY_ID)
      : undefined
  ) as StrategyConfigLike | undefined

  const resolvedStrategy = strategy || FALLBACK_STRATEGY
  const strategyInfoSnapshot = apy.loaded
    ? apy.getStrategyInfoSnapshot({
        slippage: DEFAULT_SLIPPAGE_BPS,
        quotaReserve: Number(DEFAULT_QUOTA_RESERVE_BPS),
        curatorFilter: undefined,
        strategyPayloadsList: remoteConfigs.loaded ? remoteConfigs.strategies : undefined,
        showHiddenStrategies: false,
      })
    : undefined
  const info = strategyInfoSnapshot?.strategiesInfo[MONAD_CHAIN_ID]?.[STRATEGY_ID]
  const strategyCreditManagers = strategyInfoSnapshot?.cmsOfStrategiesByChain?.[MONAD_CHAIN_ID]?.[STRATEGY_ID] as
    | Record<Address, StrategyCreditManagerLike>
    | undefined
  const targetTokenApy = apy.loaded
    ? apy.state.apySnapshot.apy.apyList?.[resolvedStrategy.tokenOutAddress.toLowerCase() as Address]
    : undefined
  const creditManagerOptions = resolvedStrategy.creditManagers
    .map(address => strategyCreditManagers?.[address] ?? strategyCreditManagers?.[addressKey(address)])
    .filter((cm): cm is StrategyCreditManagerLike => Boolean(cm))
  const creditManagers = creditManagerOptions.map(cm => {
    const cmSuite = sdk.marketRegister.findCreditManager(cm.address)
    const marketMaxLeverage = info?.maxLeverage && info.maxLeverage > 0n
      ? info.maxLeverage
      : BigInt(resolvedStrategy.maxLeverage || 300)
    const liquidationThreshold = BigInt(cmSuite.creditManager.liquidationThresholds.mustGet(resolvedStrategy.tokenOutAddress))
    const maxLeverage = calculateLeverageForTargetHealthFactor({
      liquidationThresholdBps: liquidationThreshold,
      maxLeverage: marketMaxLeverage,
      targetHealthFactorBps: TARGET_HEALTH_FACTOR_BPS + TARGET_HEALTH_FACTOR_EXECUTION_BUFFER_BPS,
    })
    const minDebt = cmSuite.creditFacade.minDebt ?? cm.minDebt ?? 0n
    const maxDebt = cmSuite.creditFacade.maxDebt ?? cm.maxDebt ?? 0n
    const baseQuotaRateWithFee = getSingleQuotaRateWithFee(cm, resolvedStrategy.tokenOutAddress)
    const adjustedApy = targetTokenApy === undefined || !info
      ? info?.maxAPY
      : calculateApyForLeverage({
          collateralApy: targetTokenApy,
          leverage: maxLeverage,
          baseRateWithFee: cm.baseBorrowRate,
          quotaRateWithFee: Number(baseQuotaRateWithFee),
          bonusApy: info.bonusAPY?.value,
        })

    return {
      address: cm.address,
      apy: adjustedApy,
      maxLeverage,
      minimumDepositAmount: calculateMinimumCollateralForDebt({ minDebt, leverage: maxLeverage }),
      minDebt,
      maxDebt,
      availableToBorrow: cm.availableToBorrow,
      baseBorrowRate: cm.baseBorrowRate,
      baseQuotaRateWithFee,
    }
  })
  const selectedCreditManager = selectBestCreditManagerForAmount(creditManagers, 1_000_000_000n)
  const creditManager = (selectedCreditManager?.address || info?.minCreditManager.address || resolvedStrategy.creditManagers[0]) as Address
  const cmSuite = sdk.marketRegister.findCreditManager(creditManager)
  const collateralToken = cmSuite.underlying as Address
  const collateralMeta = sdk.tokensMeta.get(collateralToken)
  const collateralSymbol = collateralMeta?.symbol || 'USDC'
  const collateralDecimals = collateralMeta?.decimals || 6
  const maxLeverage = selectedCreditManager?.maxLeverage ?? info?.maxLeverage ?? BigInt(resolvedStrategy.maxLeverage || 300)
  const minimumDepositAmount = selectedCreditManager?.minimumDepositAmount ?? 0n
  const adjustedApy = selectedCreditManager?.apy ?? info?.maxAPY
  const botAddress = bots.loaded ? bots.bots[0]?.address as Address | undefined : undefined

  return {
    sdk,
    strategyId: STRATEGY_ID,
    strategyName: resolvedStrategy.name,
    targetToken: resolvedStrategy.tokenOutAddress,
    creditManager,
    collateralToken,
    collateralSymbol,
    collateralDecimals,
    chainName: 'Monad',
    maxApy: adjustedApy,
    apyLabel: formatOpportunityApy(adjustedApy),
    maxLeverage,
    minimumDepositAmount,
    leverageLabel: `${(Number(maxLeverage) / 100).toFixed(2)}x target`,
    botAddress,
    creditManagers,
  }
}
