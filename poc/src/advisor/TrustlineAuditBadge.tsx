import type { TrustlineAuditEvidence } from '../lib/advisor/t54/types'

interface TrustlineAuditBadgeProps {
  audit?: TrustlineAuditEvidence
  sid?: string
  tid?: string
}

export function TrustlineAuditBadge({ audit, sid, tid }: TrustlineAuditBadgeProps) {
  if (!audit && !sid) return null

  const isApproved = audit?.decision === 'APPROVE'
  const riskClass = isApproved ? 'advisor-trustline-pill--approved' : 'advisor-trustline-pill--declined'

  return (
    <div className="advisor-trustline-badge" data-testid="trustline-audit-badge">
      <div className="advisor-trustline-header">
        <span className="advisor-trustline-icon" aria-hidden="true">🛡️</span>
        <span className="advisor-trustline-title">t54 Trustline Underwritten</span>
        {audit && (
          <span className={`advisor-trustline-pill ${riskClass}`}>
            {audit.decision} ({audit.riskLevel.toUpperCase()} RISK)
          </span>
        )}
      </div>

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
            <strong>Reason:</strong> {audit.reasonBrief}
          </p>
        )}

        {audit?.reasoningSummary && !audit.reasonBrief && (
          <p className="advisor-trustline-summary">{audit.reasoningSummary}</p>
        )}
      </div>
    </div>
  )
}
