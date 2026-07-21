import { describe, expect, it } from 'vitest'
import { assessPosition, effectiveInterventionHf } from './engine'
import type { PositionState } from './engine'
import type { SignalFeed } from './signals'
import type { CollateralPosition, DebtPosition, ProviderToken, Underlying } from '../types'

const NOW = Date.UTC(2026, 6, 21, 12, 0, 0)
const HOUR = 60 * 60 * 1000

const NVDA: Underlying = { id: 'EQUITY:NVDA', symbol: 'NVDA', name: 'NVIDIA', tier: 'blue_chip' }
const SPY: Underlying = { id: 'EQUITY:SPY', symbol: 'SPY', name: 'S&P 500 ETF', tier: 'index_etf' }
const underlyings = { [NVDA.id]: NVDA, [SPY.id]: SPY }

const token = (address: string, underlyingId: string, usesNavFeed = false): ProviderToken => ({
  address,
  underlyingId,
  issuer: 'Backed Finance',
  providerRiskScore: 5,
  liquidityTier: 'high',
  redemptionType: 'direct',
  usesNavFeed,
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

const earningsSignal = (overrides: Partial<SignalFeed> = {}): SignalFeed => ({
  feedId: 'earnings-nvda',
  asset: 'EQUITY:NVDA',
  signalType: 'event',
  value: 0.85,
  direction: 'risk_off',
  confidence: 0.9,
  validUntil: NOW + HOUR,
  sourceLabel: 'Refinitiv earnings calendar',
  trustWeight: 90,
  ...overrides,
})

const baseState = (overrides: Partial<PositionState> = {}): PositionState => ({
  collateral: [pos(token('0xbnvda', NVDA.id), 40_000), pos(token('0xbspy', SPY.id), 60_000)],
  debts: [debt('USDC', 55_000)],
  underlyings,
  targetWeights: { [NVDA.id]: 0.4, [SPY.id]: 0.6 },
  market: { equityMarketOpen: true, now: NOW },
  signals: [],
  ...overrides,
})

describe('effectiveInterventionHf', () => {
  it('leaves the threshold unchanged with no signals', () => {
    expect(effectiveInterventionHf(1.2, [], NOW)).toBeCloseTo(1.2, 6)
  })

  it('tightens (raises) the threshold under risk-off signals', () => {
    const raised = effectiveInterventionHf(1.2, [earningsSignal()], NOW)
    expect(raised).toBeGreaterThan(1.2)
  })

  it('ignores expired signals', () => {
    expect(effectiveInterventionHf(1.2, [earningsSignal({ validUntil: NOW - 1 })], NOW)).toBeCloseTo(1.2, 6)
  })
})

describe('assessPosition', () => {
  it('reports HF and status', () => {
    const a = assessPosition(baseState())
    // NVDA 40k @0.75 + SPY 60k @0.82 = 30k + 49.2k = 79.2k risk-adjusted; debt 55k.
    expect(a.healthFactor).toBeCloseTo(79_200 / 55_000, 5)
    expect(a.status).toBe('healthy')
  })

  it('emits a signal-driven reduce-weight proposal that improves projected HF', () => {
    const a = assessPosition(baseState({ signals: [earningsSignal()] }))
    const reduce = a.proposals.find(p => p.kind === 'reduce_weight' && p.underlyingId === NVDA.id)
    expect(reduce).toBeDefined()
    // Rotating blue-chip (0.75) into the index (0.82) lifts risk-adjusted collateral.
    expect(reduce!.projectedHfDelta).toBeGreaterThan(0)
    expect(reduce!.projectedHf).toBeGreaterThan(a.healthFactor)
    expect(reduce!.contributingSignals).toContain('earnings-nvda')
    expect(reduce!.params.toWeight).toBeLessThan(reduce!.params.fromWeight!)
  })

  it('does not emit signal proposals when there are no active signals', () => {
    const a = assessPosition(baseState())
    expect(a.proposals.some(p => p.kind === 'reduce_weight')).toBe(false)
  })

  it('flags provider concentration and proposes diversification', () => {
    const concentrated = baseState({
      // 100% of NVDA via a single provider.
      collateral: [pos(token('0xbnvda', NVDA.id), 40_000), pos(token('0xbspy', SPY.id), 60_000)],
    })
    const a = assessPosition(concentrated)
    expect(a.concentrationWarnings.some(w => w.underlyingId === NVDA.id)).toBe(true)
    expect(a.proposals.some(p => p.kind === 'provider_diversify' && p.underlyingId === NVDA.id)).toBe(true)
  })

  it('marks private-equity proposals as requiring approval', () => {
    const SPACEX: Underlying = { id: 'EQUITY:SPACEX', symbol: 'SPACEX', name: 'SpaceX', tier: 'private_equity' }
    const state = baseState({
      underlyings: { ...underlyings, [SPACEX.id]: SPACEX },
      collateral: [
        pos(token('0xspacex', SPACEX.id, true), 40_000),
        pos(token('0xbspy', SPY.id), 60_000),
      ],
      targetWeights: { [SPACEX.id]: 0.4, [SPY.id]: 0.6 },
      signals: [earningsSignal({ feedId: 'spacex-risk', asset: SPACEX.id })],
    })
    const a = assessPosition(state)
    const pe = a.proposals.find(p => p.underlyingId === SPACEX.id)
    expect(pe?.requiresApproval).toBe(true)
  })
})

describe('assessPosition — zero debt (B5 root fix)', () => {
  it('emits no reduce_weight proposal and no NaN/Infinity anywhere under the NVDA earnings signal with zero debt', () => {
    const a = assessPosition(baseState({ debts: [], signals: [earningsSignal()] }))

    expect(a.healthFactor).toBe(Infinity)
    expect(a.proposals.some(p => p.kind === 'reduce_weight')).toBe(false)
    expect(a.proposals.some(p => p.kind === 'refinance_stablecoin')).toBe(false)

    for (const proposal of a.proposals) {
      // provider_diversify is HF-neutral, so projectedHf legitimately mirrors
      // the current (Infinity, zero-debt) HF — only NaN is disallowed.
      expect(Number.isNaN(proposal.projectedHf)).toBe(false)
      expect(Number.isNaN(proposal.projectedHfDelta)).toBe(false)
    }
  })

  it('still proposes provider diversification with zero debt, HF-neutral', () => {
    const concentrated = baseState({
      debts: [],
      collateral: [pos(token('0xbnvda', NVDA.id), 40_000), pos(token('0xbspy', SPY.id), 60_000)],
    })
    const a = assessPosition(concentrated)

    expect(a.healthFactor).toBe(Infinity)
    const diversify = a.proposals.find(p => p.kind === 'provider_diversify' && p.underlyingId === NVDA.id)
    expect(diversify).toBeDefined()
    expect(diversify!.projectedHfDelta).toBe(0)
    expect(Number.isNaN(diversify!.projectedHf)).toBe(false)
  })
})
