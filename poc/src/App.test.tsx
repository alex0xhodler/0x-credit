import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OnchainSDK } from '@gearbox-protocol/sdk/onchain'
import type { Address } from 'viem'
import type { GearboxCreditManagerRoute, LoadedGearboxOpportunity } from './lib/gearbox/live'

const wethRoute: GearboxCreditManagerRoute = {
  address: '0x1111111111111111111111111111111111111111' as Address,
  apy: 513_900,
  baseApy: 42_000,
  maxLeverage: 760n,
  minimumDepositAmount: 1_500_000_000_000_000_000n,
  minDebt: 1_000_000_000_000_000_000n,
  maxDebt: 1_000_000_000_000_000_000_000n,
  availableToBorrow: 1_000_000_000_000_000_000_000n,
  baseBorrowRate: 20_000,
  baseQuotaRateWithFee: 5_000n,
  totalBorrowRate: 25_000,
  collateralToken: '0x2222222222222222222222222222222222222222' as Address,
  collateralSymbol: 'WETH',
  collateralDecimals: 18,
  rwa: false,
}

const mfOneRoute: GearboxCreditManagerRoute = {
  address: '0x3333333333333333333333333333333333333333' as Address,
  apy: undefined,
  baseApy: undefined,
  maxLeverage: 500n,
  minimumDepositAmount: 37_500_000_000_000_000_000_000n,
  minDebt: 10_000_000_000_000_000_000_000n,
  maxDebt: 500_000_000_000_000_000_000_000n,
  availableToBorrow: 500_000_000_000_000_000_000_000n,
  baseBorrowRate: 30_000,
  baseQuotaRateWithFee: 3_000n,
  totalBorrowRate: 33_000,
  collateralToken: '0x4444444444444444444444444444444444444444' as Address,
  collateralSymbol: 'frxUSD',
  collateralDecimals: 18,
  rwa: true,
  kycRegistrationLink: undefined,
}

const mGlobalRoute: GearboxCreditManagerRoute = {
  ...mfOneRoute,
  address: '0x5555555555555555555555555555555555555555' as Address,
  minimumDepositAmount: 40_540_000_000_000_000_000_000n,
  maxLeverage: 470n,
  kycRegistrationLink: 'https://form.typeform.com/to/DqZaw6kr',
}

function loadedOpportunity(
  strategyId: string,
  strategyName: string,
  rwa: boolean,
  routes: GearboxCreditManagerRoute[],
): LoadedGearboxOpportunity {
  return {
    sdk: {} as unknown as OnchainSDK,
    strategyId,
    strategyName,
    targetToken: routes[0].collateralToken,
    creditManager: routes[0].address,
    collateralToken: routes[0].collateralToken,
    collateralSymbol: routes[0].collateralSymbol,
    collateralDecimals: routes[0].collateralDecimals,
    chainName: 'Mainnet',
    maxApy: routes[0].apy,
    apyLabel: 'APY loading',
    maxLeverage: routes[0].maxLeverage,
    minimumDepositAmount: routes[0].minimumDepositAmount,
    leverageLabel: `${(Number(routes[0].maxLeverage) / 100).toFixed(2)}x target`,
    rwa,
    creditManagers: routes,
  }
}

const fixtureOpportunities: LoadedGearboxOpportunity[] = [
  loadedOpportunity('wmooCurveETH+-WETH', 'Convex ETH+/WETH (Optimized by Beefy)', false, [wethRoute]),
  loadedOpportunity('mF-ONE', 'mF-ONE', true, [mfOneRoute]),
  loadedOpportunity('mGLOBAL', 'mGLOBAL', true, [mGlobalRoute]),
]

vi.mock('./lib/gearbox/live', async () => {
  const actual = await vi.importActual<typeof import('./lib/gearbox/live')>('./lib/gearbox/live')
  return {
    ...actual,
    loadMainnetOpportunities: vi.fn().mockResolvedValue(fixtureOpportunities),
  }
})

afterEach(() => {
  window.history.pushState({}, '', '/')
})

describe('App — routing', () => {
  it('renders the cockpit instead of the advisor experience for ?view=advisor', async () => {
    window.history.pushState({}, '', '/?view=advisor')
    const { App } = await import('./App')
    render(<App />)

    expect(await screen.findByRole('tablist', { name: /strategy/i })).toBeInTheDocument()
  })
})

describe('App — RWA opportunities', () => {
  it('lists RWA opportunities without filtering them out via the negative-APY rule', async () => {
    const { App } = await import('./App')
    render(<App />)

    const frxUsdTabs = await screen.findAllByRole('tab', { name: /frxusd/i })
    expect(frxUsdTabs).toHaveLength(2)
  })
})
