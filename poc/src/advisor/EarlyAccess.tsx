import { useState, type FormEvent } from 'react'
import { HERO_UNDERLYINGS } from '../lib/advisor/fixtures/heroScenario'
import type { IntentConfig } from '../lib/advisor/onboarding/intent'
import type { UnderlyingId } from '../lib/advisor/types'

/**
 * Early-access lead-capture gate shown between "Activate agent" and the
 * dashboard on the demo's first activation. Posts the visitor's email plus a
 * compact snapshot of their configured mandate to Formspree; AdvisorApp
 * decides (via `onSubmitted`/localStorage) whether to show this gate again
 * on future activations.
 */
const EARLY_ACCESS_ENDPOINT = 'https://formspree.io/f/xrenlrpa'

const UNDERLYING_ORDER: UnderlyingId[] = [
  'xyz:CL',
  'xyz:SILVER',
  'xyz:XYZ100',
  'xyz:SP500',
  'xyz:BRENTOIL',
  'xyz:SKHX',
  'xyz:MU',
  'xyz:GOLD',
  'xyz:SPCX',
  'xyz:SNDK',
]

const MODE_LABEL: Record<IntentConfig['mode'], string> = {
  manual: 'Manual',
  semi: 'Semi-automatic',
  auto: 'Automatic',
}

/** Formats a USD amount with commas and no decimals, e.g. `$12,500,000`. */
function formatUsd(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function selectedDeposits(intent: IntentConfig): { id: UnderlyingId; amountUsd: number }[] {
  return UNDERLYING_ORDER.filter(id => (intent.deposits[id] ?? 0) > 0).map(id => ({
    id,
    amountUsd: intent.deposits[id],
  }))
}

/** Compact deposit summary for the lead payload, e.g. `SPY $100,000, NVDA $50,000`. */
function compactDepositsSummary(intent: IntentConfig): string {
  return selectedDeposits(intent)
    .map(({ id, amountUsd }) => `${HERO_UNDERLYINGS[id].symbol} ${formatUsd(amountUsd)}`)
    .join(', ')
}

/** Compact borrow summary for the lead payload, e.g. `USDC $51,250, USDT $10,000`. */
function compactBorrowSummary(intent: IntentConfig): string {
  return intent.borrows
    .filter(borrow => borrow.amountUsd > 0)
    .map(borrow => `${borrow.stablecoin} ${formatUsd(borrow.amountUsd)}`)
    .join(', ')
}

const ACCESS_STEP_LABELS = ['Position', 'Mandate', 'Review', 'Access']

/** Right-rail step strip: the three onboarding steps fully checked, Access highlighted as current. */
function AccessSteps() {
  return (
    <div className="advisor-exec-steps" aria-label="Execution steps">
      {ACCESS_STEP_LABELS.map((label, index) => {
        const isAccess = label === 'Access'
        return (
          <div className="advisor-exec-node-wrap" key={label}>
            {index > 0 && <span className="advisor-exec-connector is-done" aria-hidden="true" />}
            <div className={`advisor-exec-node advisor-exec-node--${isAccess ? 'active' : 'done'}`}>
              <span className="advisor-exec-node-circle">{isAccess ? index + 1 : '✓'}</span>
              <span className="advisor-exec-node-label">{label}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export interface EarlyAccessProps {
  /** The mandate the visitor just activated — summarized on this screen and sent with the lead. */
  intent: IntentConfig
  /** Called once, right after a successful submission, so AdvisorApp can persist the "don't re-gate" flag. */
  onSubmitted: () => void
  /** Called when the visitor clicks "Preview your dashboard →" after submitting. */
  onPreviewDashboard: () => void
}

export function EarlyAccess({ intent, onSubmitted, onPreviewDashboard }: EarlyAccessProps) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus('submitting')
    try {
      const response = await fetch(EARLY_ACCESS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          email,
          source: '0x-credit robo-advisor early access',
          deposits: compactDepositsSummary(intent),
          borrow: compactBorrowSummary(intent),
          mode: intent.mode,
          interventionHf: intent.interventionHf,
        }),
      })
      if (!response.ok) throw new Error('early access request failed')
      setStatus('success')
      onSubmitted()
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="advisor-wizard">
      <div className="advisor-card">
        <header className="advisor-topbar">
          <span className="advisor-brand-mark" aria-hidden="true">
            0x
          </span>
          <span className="advisor-topbar-divider" aria-hidden="true" />
          <span className="advisor-topbar-label">Institutional Credit</span>
        </header>

        <div className="advisor-body">
          <section className="advisor-pane-content">
            <h2>Get early access</h2>
            <p className="advisor-explainer">
              Your agent is configured and ready. Leave your email and we&apos;ll onboard you as soon as your seat is
              ready.
            </p>

            <div className="advisor-agent-summary">
              <p className="advisor-overline">Your configured agent</p>
              <dl className="advisor-position-summary">
                {selectedDeposits(intent).map(({ id, amountUsd }) => (
                  <div className="advisor-position-line" key={id}>
                    <dt>{HERO_UNDERLYINGS[id].symbol}</dt>
                    <dd>{formatUsd(amountUsd)}</dd>
                  </div>
                ))}
                {intent.borrows
                  .filter(borrow => borrow.amountUsd > 0)
                  .map(borrow => (
                    <div className="advisor-position-line" key={borrow.stablecoin}>
                      <dt>{borrow.stablecoin}</dt>
                      <dd>{formatUsd(borrow.amountUsd)}</dd>
                    </div>
                  ))}
                <div className="advisor-position-line">
                  <dt>Mode</dt>
                  <dd>{MODE_LABEL[intent.mode]}</dd>
                </div>
                <div className="advisor-position-line">
                  <dt>Intervention threshold</dt>
                  <dd>{intent.interventionHf.toFixed(2)}</dd>
                </div>
              </dl>
            </div>

            {status === 'success' ? (
              <div className="advisor-early-access-confirm" data-testid="early-access-confirm">
                <p className="advisor-early-access-check">
                  <span className="advisor-early-access-check-mark" aria-hidden="true">
                    ✓
                  </span>
                  You&apos;re on the list.
                </p>
                <p className="advisor-hint">We&apos;ll reach out when your configured agent is ready to go live.</p>
                <button
                  type="button"
                  className="advisor-link-button"
                  data-testid="preview-dashboard"
                  onClick={onPreviewDashboard}
                >
                  Preview your dashboard →
                </button>
              </div>
            ) : (
              <form className="advisor-early-access-form" onSubmit={handleSubmit}>
                <label className="advisor-deposit-field">
                  <span className="advisor-deposit-label" aria-hidden="true">
                    Email address
                  </span>
                  <input
                    className="advisor-deposit-input"
                    type="email"
                    aria-label="Email address"
                    required
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                  />
                </label>
                {status === 'error' && (
                  <p className="advisor-early-access-error">Something went wrong — please try again.</p>
                )}
                <button type="submit" className="advisor-cta" disabled={status === 'submitting'}>
                  {status === 'submitting' ? 'Requesting…' : 'Request access'}
                </button>
              </form>
            )}
          </section>

          <aside className="advisor-pane-rail">
            <AccessSteps />
          </aside>
        </div>
      </div>
    </div>
  )
}
