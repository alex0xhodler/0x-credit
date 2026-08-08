/**
 * Types for t54 Trustline & x402-Secure Integration in 0x.credit Robo-Advisor.
 */

export interface TrustlineConfig {
  devKey: string
  proxyUrl?: string
  apiUrl?: string
  appId?: string
  /** If true or offline, fallback to deterministic local simulation when API is unreachable. */
  allowLocalSimulation?: boolean
}

export interface RiskSessionRequest {
  agentId: string
  appId?: string
  mandateName?: string
  maxDelegatedTxUsd?: number
  minAllowedHf?: number
}

export interface RiskSessionResponse {
  sid: string
  agentId: string
  expiresAt: number
  status: 'active' | 'expired'
}

export interface AgentTraceEvent {
  type: 'reasoning' | 'tool_call' | 'signal_evaluated' | 'proposal_generated' | 'policy_check'
  timestamp?: number
  description: string
  payload?: Record<string, unknown>
}

export interface StoreTraceRequest {
  sid: string
  task: string
  params: Record<string, unknown>
  events: AgentTraceEvent[]
}

export interface StoreTraceResponse {
  tid: string
  sid: string
  evidenceHash: string
  eventCount: number
}

export type TrustlineDecision = 'APPROVE' | 'DECLINE' | 'CHALLENGE' | 'REVIEW'
export type TrustlineRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface PolicyEvaluationRequest {
  sid: string
  tid: string
  action: string
  valueUsd?: number
  currentHf: number
  projectedHf: number
  minAllowedHf: number
  params?: Record<string, unknown>
}

export interface TrustlineAuditEvidence {
  sid: string
  tid: string
  trustlineTransactionId?: string
  auditTraceId?: string
  decision: TrustlineDecision
  riskLevel: TrustlineRiskLevel
  riskScore: number // 0.0 - 1.0 (lower is safer)
  status?: string // 'pending' | 'completed'
  reasonBrief?: string
  policyCompliance: {
    hfCheckPassed: boolean
    spendingLimitPassed: boolean
    fiduciaryBoundPassed: boolean
  }
  auditEvidenceHash: string
  verifiedAt: number
  reasoningSummary: string
  portalUrl?: string
}

export interface EvaluatedProposal {
  proposalId: string
  trustlineAudit: TrustlineAuditEvidence
}
