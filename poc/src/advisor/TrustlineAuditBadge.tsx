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
        <span className="advisor-trustline-title">t54 Trustline Secured</span>
        {audit && (
          <span className={`advisor-trustline-pill ${riskClass}`}>
            {audit.decision} ({audit.riskLevel.toUpperCase()} RISK)
          </span>
        )}
      </div>

      <div className="advisor-trustline-details">
        <div className="advisor-trustline-row">
          <span className="advisor-trustline-label">Risk Session ID:</span>
          <code className="advisor-trustline-code">{audit?.sid || sid}</code>
        </div>
        {audit?.tid || tid ? (
          <div className="advisor-trustline-row">
            <span className="advisor-trustline-label">Trace Evidence Hash:</span>
            <code className="advisor-trustline-code">{audit?.auditEvidenceHash || tid}</code>
          </div>
        ) : null}
        {audit?.reasoningSummary && (
          <p className="advisor-trustline-summary">{audit.reasoningSummary}</p>
        )}
      </div>
    </div>
  )
}
