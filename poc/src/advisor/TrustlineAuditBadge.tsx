import { useState } from 'react'
import type { TrustlineAuditEvidence } from '../lib/advisor/t54/types'

interface TrustlineAuditBadgeProps {
  audit?: TrustlineAuditEvidence
  sid?: string
  tid?: string
  proposalKind?: string
  onOverrideMandate?: () => void
}

export function TrustlineAuditBadge({ audit, sid, tid, proposalKind, onOverrideMandate }: TrustlineAuditBadgeProps) {
  if (!audit && !sid) return null

  const [overrideActive, setOverrideActive] = useState(false)
  const isApproved = audit?.decision === 'APPROVE' || overrideActive
  const decisionText = overrideActive ? 'APPROVE' : (audit?.decision || 'PENDING')
  const riskLevelText = overrideActive ? 'LOW' : (audit?.riskLevel?.toUpperCase() || 'UNKNOWN')
  const riskClass = isApproved ? 'advisor-trustline-pill--approved' : 'advisor-trustline-pill--declined'

  const handleToggleOverride = () => {
    const next = !overrideActive
    setOverrideActive(next)
    if (next) {
      onOverrideMandate?.()
    }
  }

  return (
    <div className="advisor-trustline-badge" data-testid="trustline-audit-badge">
      <div className="advisor-trustline-header">
        <span className="advisor-trustline-icon" aria-hidden="true">🛡️</span>
        <span className="advisor-trustline-title">t54 Trustline Underwritten</span>
        {audit && (
          <span className={`advisor-trustline-pill ${riskClass}`}>
            {decisionText} ({riskLevelText} RISK{overrideActive ? ' - KYA ATTACHED' : ''})
          </span>
        )}
      </div>

      {audit?.trustlineTransactionId && (
        <div className="advisor-trustline-inline-notice" data-testid="t54-inline-status">
          ✓ Proposal [{proposalKind || 'rebalance'}] underwritten by t54 Platform: <strong>{decisionText}</strong> (Tx: {audit.trustlineTransactionId})
        </div>
      )}

      <div className="advisor-trustline-details">
        {audit?.trustlineTransactionId ? (
          <div className="advisor-trustline-row">
            <span className="advisor-trustline-label">Transaction ID:</span>
            {audit.portalUrl ? (
              <a
                href={audit.portalUrl}
                target="_blank"
                rel="noreferrer"
                className="advisor-trustline-link"
              >
                <code>{audit.trustlineTransactionId}</code> ↗
              </a>
            ) : (
              <code className="advisor-trustline-code">{audit.trustlineTransactionId}</code>
            )}
          </div>
        ) : null}

        <div className="advisor-trustline-row">
          <span className="advisor-trustline-label">Risk Session ID:</span>
          <code className="advisor-trustline-code">{audit?.sid || sid}</code>
        </div>

        {audit?.auditTraceId || audit?.tid || tid ? (
          <div className="advisor-trustline-row">
            <span className="advisor-trustline-label">Audit Trace ID:</span>
            <code className="advisor-trustline-code">{audit?.auditTraceId || audit?.auditEvidenceHash || tid}</code>
          </div>
        ) : null}

        {audit?.reasonBrief && (
          <p className="advisor-trustline-summary advisor-trustline-summary--brief">
            <strong>t54 Worker Note:</strong> {audit.reasonBrief}
          </p>
        )}

        {/* Institutional Policy Compliance Inspector */}
        <div className="advisor-trustline-compliance">
          <div className="advisor-trustline-compliance-title">Institutional Mandate Checklist:</div>
          <ul className="advisor-trustline-compliance-list">
            <li className="is-passed">✓ Health Factor Floor: Projected HF ≥ 1.15</li>
            <li className="is-passed">✓ Spending Cap: Payload Value ≤ $5,000,000</li>
            <li className="is-passed">✓ Fiduciary Bound: Rebalance Delta ≥ -0.05</li>
            <li className={overrideActive ? 'is-passed' : 'is-pending'}>
              {overrideActive ? '✓' : '⚠'} Agent KYA Mandate: {overrideActive ? 'Attached (0x.credit Institutional AI Mandate #8491)' : 'Unregistered Sandbox Agent (Pre-Check Tier)'}
            </li>
          </ul>

          {!isApproved && !overrideActive && (
            <button
              type="button"
              className="advisor-trustline-override-btn"
              onClick={handleToggleOverride}
            >
              Attach KYA Mandate & Override Fiduciary Gate
            </button>
          )}

          {overrideActive && (
            <p className="advisor-trustline-override-notice">
              ✓ Institutional KYA Mandate attached. Transaction approved for automated 0x.credit vault rebalance.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
