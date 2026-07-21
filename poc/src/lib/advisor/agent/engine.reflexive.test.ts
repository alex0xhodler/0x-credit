import { describe, expect, it } from 'vitest'
import { assessPosition } from './engine'
import type { PositionState } from './engine'
import type { StablecoinIssuerBacking } from '../domain/correlation'
import type { CollateralPosition, DebtPosition, ProviderToken, Underlying } from '../types'

const NOW = Date.UTC(2026, 6, 21, 12, 0, 0)

const NVDA: Underlying = { id: 'EQUITY:NVDA', symbol: 'NVDA', name: 'NVIDIA', tier: 'blue_chip' }
const SPY: Underlying = { id: 'EQUITY:SPY', symbol: 'SPY', name: 'S&P 500 ETF', tier: 'index_etf' }
const underlyings = { [NVDA.id]: NVDA, [SPY.id]: SPY }

const token = (address: string, underlyingId: string, issuer: string): ProviderToken => ({
  address,
  underlyingId,
  issuer,
  providerRiskScore: 5,
  liquidityTier: 'high',
  redemptionType: 'direct',
  usesNavFeed: false,
})

const pos = (t: ProviderToken, valueUsd: number): CollateralPosition => ({
  token: t,
  quantity: valueUsd / 100,
  priceUsd: 100,
  priceAsOf: NOW,
})

const debt = (stablecoin: DebtPosition['stablecoin'], amount: number): DebtPosition => ({
  stablecoin,
  amount,
  priceUsd: 1,
})

const usdeBackedBySecuritize: StablecoinIssuerBacking[] = [
  { stablecoin: 'USDe', issuer: 'Securitize', reserveShare: 0.2 },
]

const baseState = (overrides: Partial<PositionState> = {}): PositionState => ({
  collateral: [pos(token('0xsec', NVDA.id, 'Securitize'), 5_000_000), pos(token('0xbspy', SPY.id, 'Ondo'), 5_000_000)],
  debts: [debt('USDe', 2_000_000), debt('USDC', 2_000_000)],
  underlyings,
  targetWeights: { [NVDA.id]: 0.5, [SPY.id]: 0.5 },
  market: { equityMarketOpen: true, now: NOW },
  signals: [],
  stablecoinBackings: usdeBackedBySecuritize,
  ...overrides,
})

describe('assessPosition — reflexive risk', () => {
  it('surfaces a reflexive warning when the collateral issuer also backs the borrowed stablecoin', () => {
    const a = assessPosition(baseState())
    expect(a.reflexiveWarnings.some(w => w.issuer === 'Securitize' && w.reflexive)).toBe(true)
  })

  it('proposes refinancing the affected stablecoin into USDC, improving projected HF', () => {
    const a = assessPosition(baseState())
    const refinance = a.proposals.find(p => p.kind === 'refinance_stablecoin')
    expect(refinance).toBeDefined()
    expect(refinance!.params.fromStablecoin).toBe('USDe')
    expect(refinance!.params.toStablecoin).toBe('USDC')
    // Dropping the USDe conservatism markup lowers effective debt → HF rises.
    expect(refinance!.projectedHfDelta).toBeGreaterThan(0)
    expect(refinance!.urgency).toBe('high')
  })

  it('emits no reflexive warning or refinance proposal without a shared issuer', () => {
    const a = assessPosition(
      baseState({
        collateral: [
          pos(token('0xbnvda', NVDA.id, 'Backed Finance'), 5_000_000),
          pos(token('0xbspy', SPY.id, 'Ondo'), 5_000_000),
        ],
      }),
    )
    expect(a.reflexiveWarnings.some(w => w.reflexive)).toBe(false)
    expect(a.proposals.some(p => p.kind === 'refinance_stablecoin')).toBe(false)
  })

  it('treats an absent backing declaration as no reflexive loop', () => {
    const a = assessPosition(baseState({ stablecoinBackings: undefined }))
    expect(a.reflexiveWarnings.some(w => w.reflexive)).toBe(false)
    expect(a.proposals.some(p => p.kind === 'refinance_stablecoin')).toBe(false)
  })
})
