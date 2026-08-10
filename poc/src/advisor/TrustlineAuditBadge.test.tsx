import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TrustlineAuditBadge } from './TrustlineAuditBadge'

describe('TrustlineAuditBadge', () => {
  it('renders nothing when no audit or sid is provided', () => {
    const { container } = render(<TrustlineAuditBadge />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the Trustline audit badge with APPROVED status and evidence hash', () => {
    render(
      <TrustlineAuditBadge
        audit={{
          sid: 't54-sid-12345678',
          tid: 't54-tid-87654321',
          decision: 'APPROVE',
          riskLevel: 'low',
          riskScore: 0.05,
          policyCompliance: {
            hfCheckPassed: true,
            spendingLimitPassed: true,
            fiduciaryBoundPassed: true,
          },
          auditEvidenceHash: '0xt54_abc123def456',
          verifiedAt: Date.now(),
          reasoningSummary: 't54 Trustline Underwriting APPROVED: Projected HF satisfies mandate floor.',
        }}
      />,
    )

    expect(screen.getByText(/t54 Trustline Underwritten/i)).toBeInTheDocument()
    expect(screen.getByText(/APPROVE \(LOW RISK\)/i)).toBeInTheDocument()
    expect(screen.getByText(/t54-sid-12345678/i)).toBeInTheDocument()
    expect(screen.getByText(/0xt54_abc123def456/i)).toBeInTheDocument()
  })

  it('renders DECLINED status for risky proposals and supports KYA Mandate override', () => {
    render(
      <TrustlineAuditBadge
        audit={{
          sid: 't54-sid-risky',
          tid: 't54-tid-risky',
          decision: 'DECLINE',
          riskLevel: 'high',
          riskScore: 0.95,
          policyCompliance: {
            hfCheckPassed: false,
            spendingLimitPassed: true,
            fiduciaryBoundPassed: false,
          },
          auditEvidenceHash: '0xt54_bad123',
          verifiedAt: Date.now(),
          reasoningSummary: 't54 Trustline Underwriting DECLINED: Projected HF breaches mandate floor.',
        }}
      />,
    )

    expect(screen.getByText(/DECLINE \(HIGH RISK\)/i)).toBeInTheDocument()

    const overrideBtn = screen.getByRole('button', { name: /Attach KYA Mandate & Override Fiduciary Gate/i })
    expect(overrideBtn).toBeInTheDocument()

    fireEvent.click(overrideBtn)

    expect(screen.getByText(/APPROVE \(LOW RISK - KYA ATTACHED\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Institutional KYA Mandate attached/i)).toBeInTheDocument()
  })
})
