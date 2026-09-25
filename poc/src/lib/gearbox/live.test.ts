import { calcNetStrategyApy } from '@gearbox-protocol/sdk/onchain'
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { calculateLeverageForTargetHealthFactor, calculateMinimumCollateralForDebt } from './plan'
import {
  TARGET_HEALTH_FACTOR_BPS,
  TARGET_HEALTH_FACTOR_EXECUTION_BUFFER_BPS,
  buildCreditManagerRoute,
  buildNavApySegments,
  calculateNavApyBps,
  selectBestCreditManagerForAmount,
  type GearboxCreditManagerRoute,
  type NavRound,
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
    curator: { name: 'KPK' },
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
    strategyName: 'test strategy',
    targetSymbol: 'TEST',
    curator: 'KPK',
    liquidationThresholdBps: 9000,
    collateralApySource: 'backend',
  }
}

describe('Gearbox live opportunity selection', () => {
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
    const route = buildCreditManagerRoute(ethOpportunity(), undefined, { kycRegistrationLink: 'https://form.typeform.com/to/DqZaw6kr' })
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

  it('carries the on-chain name, target symbol, curator and liquidation threshold per route', () => {
    const opportunity = ethOpportunity({
      name: 'ETH+ / wstETH',
      targetCollateral: { address: TARGET, symbol: 'wmooCurveETH+-WETH', decimals: 18 },
      curator: { name: 'KPK' },
      liquidationThreshold: 9000,
    })

    const route = buildCreditManagerRoute(opportunity, undefined)

    expect(route.strategyName).toBe('ETH+ / wstETH')
    expect(route.targetSymbol).toBe('wmooCurveETH+-WETH')
    expect(route.curator).toBe('KPK')
    expect(route.liquidationThresholdBps).toBe(9000)
  })

  it('falls back to a generic curator label when the on-chain curator name is unknown', () => {
    const route = buildCreditManagerRoute(ethOpportunity({ curator: {} }), undefined)
    expect(route.curator).toBe('Gearbox')
  })

  it('defaults collateralApySource to backend, and carries an explicit nav source through', () => {
    expect(buildCreditManagerRoute(ethOpportunity(), undefined).collateralApySource).toBe('backend')
    expect(buildCreditManagerRoute(ethOpportunity(), undefined, { collateralApySource: 'nav' }).collateralApySource).toBe('nav')
  })
})

// Real mGLOBAL Midas NAV price feed rounds (8-decimal Chainlink-style feed),
// oldest-first as calculateNavApyBps/buildNavApySegments require.
const MGLOBAL_ROUND_1: NavRound = { price: 1.0, updatedAt: Date.UTC(2026, 3, 5) / 1000 }
const MGLOBAL_ROUND_2: NavRound = { price: 1.0, updatedAt: Date.UTC(2026, 4, 15) / 1000 }
const MGLOBAL_ROUND_3: NavRound = { price: 1.00576480, updatedAt: Date.UTC(2026, 5, 29) / 1000 }
const MGLOBAL_ROUND_4: NavRound = { price: 1.01128145, updatedAt: Date.UTC(2026, 6, 23) / 1000 }
const MGLOBAL_ROUND_5: NavRound = { price: 1.01664609, updatedAt: Date.UTC(2026, 7, 20) / 1000 }
const MGLOBAL_ROUND_6: NavRound = { price: 1.02200873, updatedAt: Date.UTC(2026, 8, 23) / 1000 }
const MGLOBAL_ROUND_7: NavRound = { price: 1.02241277, updatedAt: Date.UTC(2026, 8, 24) / 1000 }
const MGLOBAL_ROUNDS = [
  MGLOBAL_ROUND_1, MGLOBAL_ROUND_2, MGLOBAL_ROUND_3, MGLOBAL_ROUND_4, MGLOBAL_ROUND_5, MGLOBAL_ROUND_6, MGLOBAL_ROUND_7,
]
const DAY = 86_400

describe('calculateNavApyBps', () => {
  it('walks back past rounds within 90 days of latest to the first one old enough (mGLOBAL: lands on round 2, ~6.3%)', () => {
    const bps = calculateNavApyBps(MGLOBAL_ROUNDS, MGLOBAL_ROUND_7.updatedAt)
    expect(bps).toBeDefined()
    expect(bps! / 100).toBeCloseTo(6.3, 0)
  })

  it('falls back to the oldest round given when none clear the 90-day cutoff, still requiring a 30-day span', () => {
    const now = MGLOBAL_ROUND_7.updatedAt
    // round5 -> round7 is ~35 days: below the 90-day baseline age, but above
    // the 30-day minimum span, so it computes off round5 (the oldest given).
    const bps = calculateNavApyBps([MGLOBAL_ROUND_5, MGLOBAL_ROUND_6, MGLOBAL_ROUND_7], now)
    expect(bps).toBeDefined()
    // round6 -> round7 alone is only 1 day — below the 30-day minimum span.
    expect(calculateNavApyBps([MGLOBAL_ROUND_6, MGLOBAL_ROUND_7], now)).toBeUndefined()
  })

  it('returns undefined when the reachable span is below 30 days', () => {
    const now = MGLOBAL_ROUND_7.updatedAt
    const tooRecent: NavRound = { price: 1.021, updatedAt: now - 14 * DAY }
    expect(calculateNavApyBps([tooRecent, MGLOBAL_ROUND_7], now)).toBeUndefined()
  })

  it('returns undefined with fewer than two usable rounds', () => {
    expect(calculateNavApyBps([], MGLOBAL_ROUND_7.updatedAt)).toBeUndefined()
    expect(calculateNavApyBps([MGLOBAL_ROUND_7], MGLOBAL_ROUND_7.updatedAt)).toBeUndefined()
  })

  it('returns undefined when the latest price is not positive', () => {
    expect(calculateNavApyBps([MGLOBAL_ROUND_1, { price: 0, updatedAt: MGLOBAL_ROUND_7.updatedAt }], MGLOBAL_ROUND_7.updatedAt)).toBeUndefined()
  })
})

describe('buildNavApySegments', () => {
  it('is anchored at each segment\'s START round, not its end — the rate applies forward from there', () => {
    const segments = buildNavApySegments([MGLOBAL_ROUND_6, MGLOBAL_ROUND_7])
    expect(segments).toHaveLength(1)
    expect(segments[0].timestamp).toBe(MGLOBAL_ROUND_6.updatedAt)
    // 1 day apart at ~0.04% growth compounds to an extreme annualized figure —
    // this is expected of short spans, not a bug in the formula.
    expect(segments[0].apyBps).toBeGreaterThan(0)
  })

  it('trims leading pre-launch flat segments — history starts at the first real growth (mGLOBAL: round2 -> round3, 2026-05-15)', () => {
    const segments = buildNavApySegments(MGLOBAL_ROUNDS)
    expect(segments[0].timestamp).toBe(MGLOBAL_ROUND_2.updatedAt)
    expect(new Date(segments[0].timestamp * 1000).toISOString().slice(0, 10)).toBe('2026-05-15')
    expect(segments.every(s => s.timestamp >= MGLOBAL_ROUND_2.updatedAt)).toBe(true)
  })

  it('keeps an interior flat segment (after accrual has already started) rather than trimming it too', () => {
    const flatInterior: NavRound = { price: MGLOBAL_ROUND_3.price, updatedAt: MGLOBAL_ROUND_3.updatedAt + DAY }
    const segments = buildNavApySegments([MGLOBAL_ROUND_2, MGLOBAL_ROUND_3, flatInterior, MGLOBAL_ROUND_4])
    expect(segments.map(s => s.apyBps)).toEqual([
      segments[0].apyBps, // round2 -> round3: real growth
      0,                  // round3 -> flatInterior: no change, but AFTER accrual started — kept
      segments[2].apyBps, // flatInterior -> round4: real growth
    ])
  })

  it('returns no segments when the given rounds never show any growth', () => {
    expect(buildNavApySegments([MGLOBAL_ROUND_1, MGLOBAL_ROUND_2])).toEqual([])
  })

  it('produces one segment per consecutive pair after trimming, in order', () => {
    const segments = buildNavApySegments(MGLOBAL_ROUNDS)
    expect(segments).toHaveLength(MGLOBAL_ROUNDS.length - 2) // one fewer: the leading flat segment is trimmed
    expect(segments.map(s => s.timestamp)).toEqual(MGLOBAL_ROUNDS.slice(1, -1).map(r => r.updatedAt))
  })

  it('drops non-positive-price rounds rather than producing a nonsensical segment', () => {
    const segments = buildNavApySegments([MGLOBAL_ROUND_1, { price: 0, updatedAt: MGLOBAL_ROUND_1.updatedAt + DAY }, MGLOBAL_ROUND_2])
    expect(segments).toEqual([])
  })
})
