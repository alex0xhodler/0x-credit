import { describe, expect, it } from 'vitest'
import { TrustlineClient } from './trustlineClient'

describe('TrustlineClient', () => {
  it('creates a risk session with default or configured params', async () => {
    const client = new TrustlineClient({ allowLocalSimulation: true })
    const session = await client.createRiskSession({
      agentId: '0x0d79860366926b7685428dcd2b2d1eefcbd45178',
      mandateName: 'Test Mandate',
    })

    expect(session.sid).toContain('t54-sid-')
    expect(session.agentId).toBe('0x0d79860366926b7685428dcd2b2d1eefcbd45178')
    expect(session.status).toBe('active')
    expect(session.expiresAt).toBeGreaterThan(Date.now())
  })

  it('stores agent reasoning trace events and returns evidence hash', async () => {
    const client = new TrustlineClient({ allowLocalSimulation: true })
    const trace = await client.storeAgentTrace({
      sid: 't54-sid-test-session',
      task: 'Evaluate De-Risk Proposal',
      params: { symbol: 'NVDA', valueUsd: 500000 },
      events: [
        {
          type: 'reasoning',
          timestamp: Date.now(),
          description: 'Observed earnings risk signal on NVDA',
        },
      ],
    })

    expect(trace.tid).toContain('t54-tid-')
    expect(trace.evidenceHash).toMatch(/^0x/)
    expect(trace.eventCount).toBe(1)
  })

  it('evaluates policy and approves valid projected health factor', async () => {
    const client = new TrustlineClient({ allowLocalSimulation: true })
    const audit = await client.evaluatePolicy({
      sid: 't54-sid-test',
      tid: 't54-tid-test',
      action: 'reduce_weight',
      valueUsd: 250000,
      currentHf: 1.18,
      projectedHf: 1.35,
      minAllowedHf: 1.15,
    })

    expect(audit.decision).toBe('APPROVE')
    expect(audit.riskLevel).toBe('low')
    expect(audit.policyCompliance.hfCheckPassed).toBe(true)
    expect(audit.policyCompliance.spendingLimitPassed).toBe(true)
    expect(audit.auditEvidenceHash).toContain('0xt54_')
  })

  it('declines proposal that breaches minimum health factor threshold', async () => {
    const client = new TrustlineClient({ allowLocalSimulation: true })
    const audit = await client.evaluatePolicy({
      sid: 't54-sid-test',
      tid: 't54-tid-test',
      action: 'borrow_more',
      valueUsd: 1000000,
      currentHf: 1.18,
      projectedHf: 1.05, // Below 1.15 minimum
      minAllowedHf: 1.15,
    })

    expect(audit.decision).toBe('DECLINE')
    expect(audit.riskLevel).toBe('high')
    expect(audit.policyCompliance.hfCheckPassed).toBe(false)
  })
})
