import type { Assessment, PositionState, Proposal } from '../agent/engine'
import type { TrustlineAuditEvidence } from './types'
import { TrustlineClient } from './trustlineClient'

export interface ProposalWithTrustlineAudit extends Proposal {
  trustlineAudit?: TrustlineAuditEvidence
}

export interface AssessmentWithTrustlineAudit extends Assessment {
  proposals: ProposalWithTrustlineAudit[]
  trustlineSession?: {
    sid: string
    tid: string
    agentId: string
    verifiedAt: number
  }
}

export interface AuditOptions {
  agentId?: string
  mandateName?: string
  minAllowedHf?: number
  trustlineClient?: TrustlineClient
}

/**
 * Audits a Robo-Advisor assessment through t54 Trustline underwriting.
 * Collects agentic reasoning traces and verifies each proposal against institutional
 * policy rules pre-execution.
 */
export async function auditAssessmentWithTrustline(
  state: PositionState,
  assessment: Assessment,
  options?: AuditOptions,
): Promise<AssessmentWithTrustlineAudit> {
  const client = options?.trustlineClient || new TrustlineClient()
  const agentId = options?.agentId || '0x0d79860366926b7685428dcd2b2d1eefcbd45178'
  const minAllowedHf = options?.minAllowedHf ?? state.interventionHf ?? 1.15

  // 1. Create or bind Trustline Risk Session
  const session = await client.createRiskSession({
    agentId,
    mandateName: options?.mandateName || '0x.credit Institutional AI Robo-Advisor Mandate',
    minAllowedHf,
  })

  // 2. Build agentic reasoning trace events
  const events = [
    {
      type: 'reasoning' as const,
      timestamp: state.market.now,
      description: `Evaluated portfolio health factor (${assessment.healthFactor.toFixed(2)}) against effective intervention floor (${assessment.effectiveInterventionHf.toFixed(2)}).`,
      payload: {
        healthFactor: assessment.healthFactor,
        status: assessment.status,
        effectiveInterventionHf: assessment.effectiveInterventionHf,
        signalCount: state.signals.length,
      },
    },
    ...assessment.proposals.map(p => ({
      type: 'proposal_generated' as const,
      timestamp: state.market.now,
      description: `Generated ${p.kind} proposal (${p.id}): ${p.rationale}`,
      payload: {
        proposalId: p.id,
        kind: p.kind,
        urgency: p.urgency,
        projectedHf: p.projectedHf,
        projectedHfDelta: p.projectedHfDelta,
        contributingSignals: p.contributingSignals,
      },
    })),
  ]

  // 3. Store agent reasoning trace
  const trace = await client.storeAgentTrace({
    sid: session.sid,
    task: `Assess Portfolio Risk & Underwrite Rebalance Proposals for ${agentId}`,
    params: {
      collateralCount: state.collateral.length,
      debtCount: state.debts.length,
      signalsCount: state.signals.length,
    },
    events,
  })

  // 4. Underwrite each proposal against t54 Trustline policy rules
  const auditedProposals: ProposalWithTrustlineAudit[] = await Promise.all(
    assessment.proposals.map(async proposal => {
      const audit = await client.evaluatePolicy({
        sid: session.sid,
        tid: trace.tid,
        action: proposal.kind,
        valueUsd: proposal.params.valueUsd,
        currentHf: assessment.healthFactor,
        projectedHf: proposal.projectedHf,
        minAllowedHf,
        params: {
          proposalId: proposal.id,
          urgency: proposal.urgency,
          contributingSignals: proposal.contributingSignals,
        },
      })

      return {
        ...proposal,
        trustlineAudit: audit,
      }
    }),
  )

  return {
    ...assessment,
    proposals: auditedProposals,
    trustlineSession: {
      sid: session.sid,
      tid: trace.tid,
      agentId,
      verifiedAt: Date.now(),
    },
  }
}
