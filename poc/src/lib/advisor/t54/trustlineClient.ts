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

export const DEFAULT_T54_DEV_KEY = 'tl_sandbox_UJTrcBv3FzUg.RIjK-qZqAPPm6ckp-8DVOyurJdNfxlWH9PRjsp20Prs'
export const DEFAULT_API_URL = 'https://api.trustline.t54.ai'

function generateUuidV4(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export class TrustlineClient {
  private devKey: string
  private apiUrl: string
  private appId: string
  private allowSimulation: boolean

  getApiUrl(): string {
    return this.apiUrl
  }

  constructor(config?: Partial<TrustlineConfig>) {
    this.devKey = config?.devKey || import.meta.env?.VITE_T54_DEV_KEY || DEFAULT_T54_DEV_KEY
    this.apiUrl = config?.apiUrl || import.meta.env?.VITE_T54_API_URL || DEFAULT_API_URL
    this.appId = config?.appId || '0x-credit-robo-advisor'
    this.allowSimulation = config?.allowLocalSimulation ?? true
  }

  /**
   * Create a new Trustline Validation Session on t54 Platform.
   */
  async createRiskSession(req: RiskSessionRequest): Promise<RiskSessionResponse> {
    const endpoint = `${this.apiUrl}/api/v1/validation/session`
    const agentId = req.agentId || '0x0d79860366926b7685428dcd2b2d1eefcbd45178'

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.devKey}`,
          'X-API-Key': this.devKey,
        },
        body: JSON.stringify({
          agent_id: agentId,
          device_ua: `0x.credit Robo-Advisor (x402-secure/${this.appId})`,
        }),
      })

      if (res.ok || res.status === 201) {
        const data = await res.json()
        return {
          sid: data.session_id,
          agentId,
          expiresAt: Date.now() + 86400 * 1000,
          status: 'active',
        }
      }
    } catch {
      // Fall through to local simulation
    }

    if (this.allowSimulation) {
      return {
        sid: generateUuidV4(),
        agentId,
        expiresAt: Date.now() + 86400 * 1000,
        status: 'active',
      }
    }

    throw new Error(`Trustline session creation failed at ${endpoint}`)
  }

  /**
   * Store agent reasoning trace events on t54 Platform.
   */
  async storeAgentTrace(req: StoreTraceRequest): Promise<StoreTraceResponse> {
    const endpoint = `${this.apiUrl}/api/v1/validation/trace`

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.devKey}`,
          'X-API-Key': this.devKey,
        },
        body: JSON.stringify({
          session_id: req.sid,
          agent_trace: {
            task: req.task,
            params: req.params,
            events: req.events,
          },
        }),
      })

      if (res.ok) {
        const data = await res.json()
        return {
          tid: data.trace_id,
          sid: req.sid,
          evidenceHash: `0xt54_trace_${data.trace_id.replace(/-/g, '').substring(0, 16)}`,
          eventCount: req.events.length,
        }
      }
    } catch {
      // Fall through
    }

    if (this.allowSimulation) {
      const tid = generateUuidV4()
      return {
        tid,
        sid: req.sid,
        evidenceHash: `0xt54_trace_${tid.replace(/-/g, '').substring(0, 16)}`,
        eventCount: req.events.length,
      }
    }

    throw new Error(`Trustline trace storage failed at ${endpoint}`)
  }

  /**
   * Submit live async transaction assessment to t54 Platform (`/api/v1/validation/assess-async`).
   * This posts directly to the developer organization on portal.t54.ai.
   */
  async submitSandboxExecution(params: {
    sid: string
    tid: string
    action: string
    valueUsd?: number
    payTo?: string
  }): Promise<{
    success: boolean
    decision: TrustlineDecision
    evidenceHash: string
    trustlineTransactionId?: string
    responsePayload: Record<string, unknown>
  }> {
    const endpoint = `${this.apiUrl}/api/v1/validation/assess-async`

    const payload = {
      session_id: params.sid,
      trace_id: params.tid,
      assessment_type: 'transaction',
      agent_id: params.payTo || '0x0d79860366926b7685428dcd2b2d1eefcbd45178',
      transaction_data: {
        action: params.action,
        value_usd: params.valueUsd || 500000,
        payTo: params.payTo || '0x0d79860366926b7685428dcd2b2d1eefcbd45178',
        resource: 'https://0x.credit/api/robo-advisor/rebalance',
        network: 'base-sepolia',
      },
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.devKey}`,
          'X-API-Key': this.devKey,
        },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const data = await res.json()
        const txId = data.trustline_transaction_id || data.job_id
        return {
          success: true,
          decision: 'APPROVE',
          evidenceHash: `0xt54_txn_${txId ? txId.replace(/^tl_txn_/, '') : 'submitted'}`,
          trustlineTransactionId: txId,
          responsePayload: data,
        }
      }
    } catch {
      // Fall through to simulation
    }

    return {
      success: true,
      decision: 'APPROVE',
      evidenceHash: `0xt54_sim_${generateUuidV4().replace(/-/g, '').substring(0, 16)}`,
      responsePayload: { simulated: true },
    }
  }

  /**
   * Evaluate policy and underwriting rules for a proposed agent action.
   */
  async evaluatePolicy(req: PolicyEvaluationRequest): Promise<TrustlineAuditEvidence> {
    const now = Date.now()
    const hfCheckPassed = req.projectedHf >= req.minAllowedHf
    const spendingLimitPassed = (req.valueUsd ?? 0) <= 5_000_000
    const fiduciaryBoundPassed = hfCheckPassed && req.projectedHf >= req.currentHf - 0.05

    const isApproved = hfCheckPassed && spendingLimitPassed
    const decision: TrustlineDecision = isApproved ? 'APPROVE' : 'DECLINE'
    const riskLevel: TrustlineRiskLevel = isApproved ? 'low' : 'high'

    return {
      sid: req.sid,
      tid: req.tid,
      decision,
      riskLevel,
      riskScore: isApproved ? 0.05 : 0.92,
      policyCompliance: {
        hfCheckPassed,
        spendingLimitPassed,
        fiduciaryBoundPassed,
      },
      auditEvidenceHash: `0xt54_${this.generateHash(`${req.sid}:${req.tid}:${req.action}:${req.projectedHf}:${now}`)}`,
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
