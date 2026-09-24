import { calcNetStrategyApy } from '@gearbox-protocol/sdk/onchain'
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { calculateLeverageForTargetHealthFactor, calculateMinimumCollateralForDebt } from './plan'
import {
  GEARBOX_APY_URL,
  TARGET_HEALTH_FACTOR_BPS,
  TARGET_HEALTH_FACTOR_EXECUTION_BUFFER_BPS,
  buildCreditManagerRoute,
  resolveGearboxApyUrl,
  selectBestCreditManagerForAmount,
  type GearboxCreditManagerRoute,
  type StrategyOpportunityLike,
} from './live'

const CM = '0x0000000000000000000000000000000000000cda' as Address
const TARGET = '0x00000000000000000000000000000000000000a1' as Address
const WETH = '0x00000000000000000000000000000000000000c1' as Address
const FRXUSD = '0xCAcd6fd266aF91b8AeD52aCCc382b4e165586E29' as Address
const MF_ONE = '0x238a700eD6165261Cf8b2e544ba797BC11e466Ba' as Address

function ethOpportunity(overrides: Partial<StrategyOpportunityLike> = {}): StrategyOpportunityLike {
  return {
    creditManager: CM,
    targetCollateral: { address: TARGET, symbol: 'wmooCurveETH+-WETH', decimals: 18 },
    underlyingToken: { address: WETH, symbol: 'WETH', decimals: 18 },
    name: 'ETH+ / WETH',
    rwa: false,
    sunset: false,
    paused: false,
    liquidationThreshold: 9000,
    borrowApy: 520,
    quotaRate: 90,
    minDebt: { value: 1_000_000_000_000_000_000n, valueUsd: 3000 },
    maxBorrowAmount: { value: 500_000_000_000_000_000_000n, valueUsd: 1_500_000 },
    availableLiquidity: { value: 600_000_000_000_000_000_000n, valueUsd: 1_800_000 },
    maxLeverage: 9.5,
    ...overrides,
  }
}

function cm(overrides: {
  address: Address
  apy: number
  minDebt: bigint
  leverage?: bigint
  maxDebt?: bigint
  availableToBorrow?: bigint
}): GearboxCreditManagerRoute {
  return {
    address: overrides.address,
    apy: overrides.apy,
    baseApy: undefined,
    maxLeverage: overrides.leverage ?? 925n,
    minimumDepositAmount: 0n,
    minDebt: overrides.minDebt,
    maxDebt: overrides.maxDebt ?? 1_000_000_000_000n,
    availableToBorrow: overrides.availableToBorrow ?? 1_000_000_000_000n,
    baseBorrowRate: 10_000,
    baseQuotaRateWithFee: 0n,
    totalBorrowRate: 10_000,
    collateralToken: '0x0000000000000000000000000000000000000000' as Address,
    collateralSymbol: 'USDC',
    collateralDecimals: 6,
    rwa: false,
  }
}

describe('Gearbox live opportunity selection', () => {
  it('uses the hosted Gearbox APY snapshot when no Vite override is configured', () => {
    expect(GEARBOX_APY_URL).toBe('/gearbox-apy/latest.json')
  })

  it('keeps the same-origin APY proxy path', () => {
    expect(resolveGearboxApyUrl('/gearbox-apy/latest.json')).toBe(
      '/gearbox-apy/latest.json',
    )
  })

  it('ignores unsupported relative APY overrides', () => {
    expect(resolveGearboxApyUrl('/other/latest.json')).toBe('/gearbox-apy/latest.json')
  })

  it('keeps absolute APY overrides when explicitly configured', () => {
    expect(resolveGearboxApyUrl('https://example.com/latest.json')).toBe('https://example.com/latest.json')
  })

  it('uses the lower-min-debt credit manager when the better-APY route is incompatible', () => {
    const highMin = '0x0000000000000000000000000000000000000001' as Address
    const lowMin = '0x0000000000000000000000000000000000000002' as Address

    expect(selectBestCreditManagerForAmount([
      cm({ address: highMin, apy: 20_00, minDebt: 10_000_000_000n }),
      cm({ address: lowMin, apy: 18_00, minDebt: 3_000_000_000n }),
    ], 1_100_000_000n)?.address).toBe(lowMin)
  })

  it('uses the highest APY credit manager when multiple routes support the amount', () => {
    const lowerApy = '0x0000000000000000000000000000000000000003' as Address
    const higherApy = '0x0000000000000000000000000000000000000004' as Address

    expect(selectBestCreditManagerForAmount([
      cm({ address: lowerApy, apy: 18_00, minDebt: 3_000_000_000n }),
      cm({ address: higherApy, apy: 20_00, minDebt: 10_000_000_000n }),
    ], 2_000_000_000n)?.address).toBe(higherApy)
  })
})

describe('buildCreditManagerRoute', () => {
  it('derives leverage, apy and minimum deposit from on-chain opportunity fields plus an off-chain collateral apy', () => {
    const opportunity = ethOpportunity()
    const collateralApyBps = 1265

    const expectedLeverage = calculateLeverageForTargetHealthFactor({
      liquidationThresholdBps: BigInt(opportunity.liquidationThreshold),
      maxLeverage: BigInt(Math.floor(opportunity.maxLeverage * 100)),
      targetHealthFactorBps: TARGET_HEALTH_FACTOR_BPS + TARGET_HEALTH_FACTOR_EXECUTION_BUFFER_BPS,
    })
    const expectedApy = calcNetStrategyApy(
      opportunity,
      collateralApyBps,
      Number(expectedLeverage) / 100,
      'aggressive',
    ) * 100
    const expectedMinimumDeposit = calculateMinimumCollateralForDebt({
      minDebt: opportunity.minDebt.value,
      leverage: expectedLeverage,
    })

    const route = buildCreditManagerRoute(opportunity, collateralApyBps)

    expect(route.address).toBe(CM)
    expect(route.maxLeverage).toBe(expectedLeverage)
    expect(route.apy).toBe(expectedApy)
    expect(route.baseApy).toBe(collateralApyBps * 100)
    expect(route.minimumDepositAmount).toBe(expectedMinimumDeposit)
    expect(route.minDebt).toBe(opportunity.minDebt.value)
    expect(route.maxDebt).toBe(opportunity.maxBorrowAmount.value)
    expect(route.availableToBorrow).toBe(opportunity.availableLiquidity.value)
    expect(route.rwa).toBe(false)
  })

  it('leaves apy and baseApy undefined when no collateral apy is available', () => {
    const route = buildCreditManagerRoute(ethOpportunity(), undefined)
    expect(route.apy).toBeUndefined()
    expect(route.baseApy).toBeUndefined()
  })

  it('converts fee-inclusive borrow apy and quota rate from sdk Bps (1%=100) to app units (1%=10_000)', () => {
    const opportunity = ethOpportunity({ borrowApy: 520, quotaRate: 90 })
    const route = buildCreditManagerRoute(opportunity, undefined)

    expect(route.baseBorrowRate).toBe(52_000)
    expect(route.baseQuotaRateWithFee).toBe(9_000n)
    expect(route.totalBorrowRate).toBe(61_000)
  })

  it('passes through the kyc registration link when provided', () => {
    const route = buildCreditManagerRoute(ethOpportunity(), undefined, 'https://form.typeform.com/to/DqZaw6kr')
    expect(route.kycRegistrationLink).toBe('https://form.typeform.com/to/DqZaw6kr')
  })

  it('takes the collateral token, symbol and decimals for an RWA route from the underlying, never from the target collateral or allowed deposit tokens', () => {
    const rwaOpportunity = ethOpportunity({
      creditManager: '0xBAdfE155662646A1A668c00276220B02FB7f1b23' as Address,
      targetCollateral: { address: MF_ONE, symbol: 'mF-ONE', decimals: 18 },
      underlyingToken: { address: FRXUSD, symbol: 'frxUSD', decimals: 18 },
      rwa: true,
    })

    const route = buildCreditManagerRoute(rwaOpportunity, undefined)

    expect(route.collateralToken).toBe(FRXUSD)
    expect(route.collateralSymbol).toBe('frxUSD')
    expect(route.collateralDecimals).toBe(18)
    expect(route.rwa).toBe(true)
  })
})
