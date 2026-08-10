import { describe, expect, it } from 'vitest'
import { assessPosition } from '../agent/engine'
import { HERO_STATE } from '../fixtures/heroScenario'
import { auditAssessmentWithTrustline } from './advisorTrustline'

describe('auditAssessmentWithTrustline', () => {
  it('audits robo-advisor hero scenario assessment with t54 Trustline evidence', async () => {
    const rawAssessment = assessPosition(HERO_STATE)

    const auditedAssessment = await auditAssessmentWithTrustline(HERO_STATE, rawAssessment, {
      agentId: '0x0d79860366926b7685428dcd2b2d1eefcbd45178',
      mandateName: '0x.credit Hero Scenario Mandate',
      minAllowedHf: 1.15,
    })

    expect(auditedAssessment.trustlineSession).toBeDefined()
    expect(auditedAssessment.trustlineSession?.sid).toBeDefined()
    expect(auditedAssessment.trustlineSession?.tid).toBeDefined()
    expect(auditedAssessment.trustlineSession?.agentId).toBe('0x0d79860366926b7685428dcd2b2d1eefcbd45178')

    expect(auditedAssessment.proposals.length).toBeGreaterThan(0)
    for (const proposal of auditedAssessment.proposals) {
      expect(proposal.trustlineAudit).toBeDefined()
      expect(proposal.trustlineAudit?.sid).toBe(auditedAssessment.trustlineSession?.sid)
      expect(proposal.trustlineAudit?.auditEvidenceHash).toBeDefined()
      expect(['APPROVE', 'DECLINE', 'CHALLENGE']).toContain(proposal.trustlineAudit?.decision)
    }
  })
})
