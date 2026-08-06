import { describe, expect, it } from 'vitest'
import {
  HERO_DEBTS,
  HERO_ROTATION_ROUTES,
  HERO_STATE,
} from './heroScenario'
import { assessPosition } from '../agent/engine'
import { validateBorrowShares } from '../domain/stablecoin'
import { compareRoutes } from '../routing/costEngine'

describe('hero scenario', () => {
  it('has a valid borrow book within per-stablecoin share caps', () => {
    expect(validateBorrowShares(HERO_DEBTS).ok).toBe(true)
  })

  it('starts healthy but above the intervention threshold', () => {
    const a = assessPosition(HERO_STATE)
    expect(a.status).toBe('healthy')
    expect(a.healthFactor).toBeGreaterThan(1.5)
    expect(a.healthFactor).toBeGreaterThan(a.effectiveInterventionHf)
  })

  it('tightens the intervention threshold under the NVDA earnings signal', () => {
    const a = assessPosition(HERO_STATE)
    expect(a.effectiveInterventionHf).toBeGreaterThan(1.2)
  })

  it('surfaces the hero de-risk proposal on NVDA with a positive projected HF delta', () => {
    const a = assessPosition(HERO_STATE)
    const hero = a.proposals.find(p => p.kind === 'reduce_weight' && p.underlyingId === 'EQUITY:NVDA')
    expect(hero).toBeDefined()
    expect(hero!.projectedHfDelta).toBeGreaterThan(0)
    expect(hero!.contributingSignals).toContain('nvda-earnings-48h')
    expect(hero!.params.intoUnderlyingId).toBe('EQUITY:SPY')
  })

  it('does not auto-trigger the private-equity sleeve (no signal on SpaceX)', () => {
    const a = assessPosition(HERO_STATE)
    expect(a.proposals.some(p => p.kind === 'reduce_weight' && p.underlyingId === 'EQUITY:SPACEX')).toBe(false)
  })

  it('routes the de-risk rotation via the lower-cost issuer RFQ path', () => {
    const result = compareRoutes(HERO_ROTATION_ROUTES)
    expect(result.best?.routeId).toBe('issuer-rfq')
    expect(result.best?.venue).toBe('issuer_rfq')
  })
})
