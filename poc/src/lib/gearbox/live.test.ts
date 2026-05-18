import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { GEARBOX_APY_URL, resolveGearboxApyUrl, selectBestCreditManagerForAmount } from './live'

function cm(overrides: {
  address: Address
  apy: number
  minDebt: bigint
  leverage?: bigint
  maxDebt?: bigint
  availableToBorrow?: bigint
}) {
  return {
    address: overrides.address,
    apy: overrides.apy,
    maxLeverage: overrides.leverage ?? 925n,
    minimumDepositAmount: 0n,
    minDebt: overrides.minDebt,
    maxDebt: overrides.maxDebt ?? 1_000_000_000_000n,
    availableToBorrow: overrides.availableToBorrow ?? 1_000_000_000_000n,
    baseBorrowRate: 10_000,
    baseQuotaRateWithFee: 0n,
    collateralToken: '0x0000000000000000000000000000000000000000' as Address,
    collateralSymbol: 'USDC',
    collateralDecimals: 6,
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
