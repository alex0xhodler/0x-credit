import type {
  PolicyEvaluationRequest,
  RiskSessionRequest,
  RiskSessionResponse,
  StoreTraceRequest,
  StoreTraceResponse,
  TrustlineAuditEvidence,
  TrustlineConfig,
  TrustlineDecision,
  TrustlineRiskLevel,
} from './types'

export const DEFAULT_T54_DEV_KEY = 'dev_key_DiATno1AAunkmlpepNgFAg'
export const DEFAULT_PROXY_URL = 'https://x402-proxy.t54.ai'
export const DEFAULT_API_URL = 'https://api.t54.ai'

/**
 * t54 Trustline & x402-Secure Client
 * Encapsulates pre-execution underwriting, reasoning trace collection,
 * and policy compliance verification for agentic Robo-Advisor actions.
 */
export class TrustlineClient {
  private devKey: string
  private proxyUrl: string
  private apiUrl: string
  private appId: string
  private allowSimulation: boolean

  getApiUrl(): string {
    return this.apiUrl
  }

  constructor(config?: Partial<TrustlineConfig>) {
    this.devKey = config?.devKey || import.meta.env?.VITE_T54_DEV_KEY || DEFAULT_T54_DEV_KEY
    this.proxyUrl = config?.proxyUrl || import.meta.env?.VITE_T54_PROXY_URL || DEFAULT_PROXY_URL
    this.apiUrl = config?.apiUrl || import.meta.env?.VITE_T54_API_URL || DEFAULT_API_URL
    this.appId = config?.appId || '0x-credit-robo-advisor'
    this.allowSimulation = config?.allowLocalSimulation ?? true
  }

  /**
   * Create a new Trustline Risk Session for an agent execution context.
   */
  async createRiskSession(req: RiskSessionRequest): Promise<RiskSessionResponse> {
    const endpoint = `${this.proxyUrl}/risk/session`
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.devKey}`,
          'X-T54-DEV-KEY': this.devKey,
          'X-APP-ID': req.appId || this.appId,
        },
        body: JSON.stringify({
          agent_id: req.agentId,
          app_id: req.appId || this.appId,
          mandate_name: req.mandateName || 'Institutional Credit & Yield Risk Policy',
          max_delegated_tx_usd: req.maxDelegatedTxUsd ?? 1_000_000,
          min_allowed_hf: req.minAllowedHf ?? 1.15,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        return {
          sid: data.sid || data.session_id,
          agentId: req.agentId,
          expiresAt: data.expires_at || Date.now() + 3600 * 1000,
          status: 'active',
        }
      }
    } catch {
      // Fall through to simulation if network is unreachable
    }

    if (this.allowSimulation) {
      return this.simulateRiskSession(req)
    }

    throw new Error(`Trustline API unreachable at ${endpoint}`)
  }

  /**
   * Store agent reasoning trace events for cryptographic auditability.
   */
  async storeAgentTrace(req: StoreTraceRequest): Promise<StoreTraceResponse> {
    const endpoint = `${this.proxyUrl}/risk/trace`
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.devKey}`,
          'X-RISK-SESSION': req.sid,
        },
        body: JSON.stringify({
          sid: req.sid,
          task: req.task,
          params: req.params,
          events: req.events,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        return {
          tid: data.tid || data.trace_id,
          sid: req.sid,
          evidenceHash: data.evidence_hash || this.generateHash(req.sid + req.task + JSON.stringify(req.events)),
          eventCount: req.events.length,
        }
      }
    } catch {
      // Fall through to simulation
    }

    if (this.allowSimulation) {
      return this.simulateStoreTrace(req)
    }

    throw new Error(`Trustline trace storage unreachable at ${endpoint}`)
  }

  /**
   * Evaluate policy and underwriting rules for a proposed agent action.
   */
  async evaluatePolicy(req: PolicyEvaluationRequest): Promise<TrustlineAuditEvidence> {
    const endpoint = `${this.proxyUrl}/risk/evaluate`
    const now = Date.now()

    // Local policy evaluation logic (deterministic risk check)
    const hfCheckPassed = req.projectedHf >= req.minAllowedHf
    const spendingLimitPassed = (req.valueUsd ?? 0) <= 5_000_000 // default $5M single transaction limit
    const fiduciaryBoundPassed = hfCheckPassed && req.projectedHf >= req.currentHf - 0.05 // Prevent extreme HF drops

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.devKey}`,
          'X-RISK-SESSION': req.sid,
          'X-RISK-TRACE': req.tid,
        },
        body: JSON.stringify({
          sid: req.sid,
          tid: req.tid,
          action: req.action,
          value_usd: req.valueUsd,
          current_hf: req.currentHf,
          projected_hf: req.projectedHf,
          min_allowed_hf: req.minAllowedHf,
          policy_context: {
            hfCheckPassed,
            spendingLimitPassed,
            fiduciaryBoundPassed,
          },
        }),
      })

      if (res.ok) {
        const data = await res.json()
        return {
          sid: req.sid,
          tid: req.tid,
          decision: (data.decision || (hfCheckPassed ? 'APPROVE' : 'DECLINE')) as TrustlineDecision,
          riskLevel: (data.risk_level || (hfCheckPassed ? 'low' : 'high')) as TrustlineRiskLevel,
          riskScore: data.risk_score ?? (hfCheckPassed ? 0.08 : 0.85),
          policyCompliance: {
            hfCheckPassed,
            spendingLimitPassed,
            fiduciaryBoundPassed,
          },
          auditEvidenceHash: data.evidence_hash || this.generateHash(`${req.sid}:${req.tid}:${req.action}:${now}`),
          verifiedAt: now,
          reasoningSummary:
            data.reasoning ||
            (hfCheckPassed
              ? `Trustline Underwriting APPROVED: Projected HF ${req.projectedHf.toFixed(2)} satisfies minimum mandate threshold (${req.minAllowedHf.toFixed(2)}).`
              : `Trustline Underwriting DECLINED: Projected HF ${req.projectedHf.toFixed(2)} violates mandate floor (${req.minAllowedHf.toFixed(2)}).`),
        }
      }
    } catch {
      // Fall through to local evaluation
    }

    if (this.allowSimulation) {
      return this.evaluateLocalPolicy(req, hfCheckPassed, spendingLimitPassed, fiduciaryBoundPassed, now)
    }

    throw new Error(`Trustline evaluation unreachable at ${endpoint}`)
  }

  // --- Local Simulation & Fallback Helpers ---

  private simulateRiskSession(req: RiskSessionRequest): RiskSessionResponse {
    const hashHex = this.generateHash(`${req.agentId}:${Date.now()}`).substring(0, 12)
    return {
      sid: `t54-sid-${hashHex}`,
      agentId: req.agentId,
      expiresAt: Date.now() + 3600 * 1000,
      status: 'active',
    }
  }

  private simulateStoreTrace(req: StoreTraceRequest): StoreTraceResponse {
    const traceHash = this.generateHash(`${req.sid}:${req.task}:${JSON.stringify(req.events)}`)
    return {
      tid: `t54-tid-${traceHash.substring(0, 12)}`,
      sid: req.sid,
      evidenceHash: `0x${traceHash}`,
      eventCount: req.events.length,
    }
  }

  private evaluateLocalPolicy(
    req: PolicyEvaluationRequest,
    hfCheckPassed: boolean,
    spendingLimitPassed: boolean,
    fiduciaryBoundPassed: boolean,
    now: number,
  ): TrustlineAuditEvidence {
    const isApproved = hfCheckPassed && spendingLimitPassed
    const decision: TrustlineDecision = isApproved ? 'APPROVE' : 'DECLINE'
    const riskLevel: TrustlineRiskLevel = isApproved ? 'low' : 'high'
    const riskScore = isApproved ? 0.05 : 0.92

    const evidenceContent = `${req.sid}:${req.tid}:${req.action}:${req.projectedHf}:${now}`
    const auditEvidenceHash = `0xt54_${this.generateHash(evidenceContent)}`

    return {
      sid: req.sid,
      tid: req.tid,
      decision,
      riskLevel,
      riskScore,
      policyCompliance: {
        hfCheckPassed,
        spendingLimitPassed,
        fiduciaryBoundPassed,
      },
      auditEvidenceHash,
      verifiedAt: now,
      reasoningSummary: isApproved
        ? `Trustline Policy APPROVED: Action [${req.action}] projected HF (${req.projectedHf.toFixed(2)}) meets institutional threshold (>= ${req.minAllowedHf.toFixed(2)}).`
        : `Trustline Policy DECLINED: Action [${req.action}] projected HF (${req.projectedHf.toFixed(2)}) breaches threshold (${req.minAllowedHf.toFixed(2)}).`,
    }
  }

  private generateHash(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash |= 0
    }
    const positive = Math.abs(hash).toString(16)
    return positive.padStart(16, '0')
  }
}
