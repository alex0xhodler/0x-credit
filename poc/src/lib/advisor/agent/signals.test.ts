import { describe, expect, it } from 'vitest'
import { activeSignals, signalsForAsset, weightedRiskScore } from './signals'
import type { SignalFeed } from './signals'

const NOW = Date.UTC(2026, 6, 21, 12, 0, 0)
const HOUR = 60 * 60 * 1000

const feed = (overrides: Partial<SignalFeed>): SignalFeed => ({
  feedId: 'f1',
  asset: 'EQUITY:NVDA',
  signalType: 'volatility',
  value: 0.8,
  direction: 'risk_off',
  confidence: 0.9,
  validUntil: NOW + HOUR,
  sourceLabel: 'Proprietary vol model',
  trustWeight: 80,
  ...overrides,
})

describe('activeSignals', () => {
  it('drops feeds whose validUntil has passed', () => {
    const feeds = [feed({ feedId: 'live' }), feed({ feedId: 'stale', validUntil: NOW - 1 })]
    expect(activeSignals(feeds, NOW).map(f => f.feedId)).toEqual(['live'])
  })
})

describe('signalsForAsset', () => {
  it('matches the exact underlying plus portfolio-wide feeds', () => {
    const feeds = [
      feed({ feedId: 'nvda', asset: 'EQUITY:NVDA' }),
      feed({ feedId: 'wide', asset: '*' }),
      feed({ feedId: 'spy', asset: 'EQUITY:SPY' }),
    ]
    expect(signalsForAsset(feeds, 'EQUITY:NVDA', NOW).map(f => f.feedId).sort()).toEqual(['nvda', 'wide'])
  })

  it('excludes expired feeds even on an asset match', () => {
    const feeds = [feed({ feedId: 'nvda', validUntil: NOW - 1 })]
    expect(signalsForAsset(feeds, 'EQUITY:NVDA', NOW)).toEqual([])
  })
})

describe('weightedRiskScore', () => {
  it('returns 0 for no feeds', () => {
    expect(weightedRiskScore([])).toBe(0)
  })

  it('returns a high score when a trusted risk-off feed dominates', () => {
    expect(weightedRiskScore([feed({ value: 0.9, direction: 'risk_off' })])).toBeCloseTo(0.9, 6)
  })

  it('nets risk-on against risk-off', () => {
    const score = weightedRiskScore([
      feed({ feedId: 'off', value: 0.8, direction: 'risk_off', trustWeight: 100, confidence: 1 }),
      feed({ feedId: 'on', value: 0.8, direction: 'risk_on', trustWeight: 100, confidence: 1 }),
    ])
    expect(score).toBeCloseTo(0, 6)
  })

  it('ignores neutral feeds', () => {
    const score = weightedRiskScore([
      feed({ value: 0.6, direction: 'risk_off', trustWeight: 100, confidence: 1 }),
      feed({ feedId: 'n', value: 1, direction: 'neutral' }),
    ])
    expect(score).toBeCloseTo(0.6, 6)
  })

  it('weights higher-trust feeds more heavily', () => {
    const score = weightedRiskScore([
      feed({ feedId: 'trusted', value: 0.9, direction: 'risk_off', trustWeight: 100, confidence: 1 }),
      feed({ feedId: 'weak', value: 0.1, direction: 'risk_on', trustWeight: 10, confidence: 1 }),
    ])
    expect(score).toBeGreaterThan(0.7)
  })
})
