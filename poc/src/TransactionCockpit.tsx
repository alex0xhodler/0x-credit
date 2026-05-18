import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExecutionStep } from './lib/gearbox/plan'

export interface OpportunityView {
  id: string
  strategyId: string
  strategyName: string
  tokenSymbol: string
  chainName: string
  apyLabel: string
  leverageLabel: string
  protectionLabel: string
  minDepositLabel?: string
  isExecutable?: boolean
  disabledReason?: string
}

export interface TransactionCockpitProps {
  amount: string
  accountStatus: 'connected' | 'disconnected'
  hasStartedFlow?: boolean
  isProjectReady: boolean
  isBusy: boolean
  opportunity: OpportunityView
  opportunities?: OpportunityView[]
  manageUrl?: string
  steps: ExecutionStep[]
  error?: string
  routeWarning?: string
  onAmountChange(value: string): void
  onConnect(): void
  onExecute(): void
  onSelectOpportunity?(opportunity: OpportunityView): void
}

const POWERED_BY_PARTNERS = [
  { name: 'Gearbox', logo: '/powered-by/gearbox.png' },
  { name: 'KPK', logo: '/powered-by/kpk.svg' },
  { name: 'Beefy', logo: '/powered-by/beefy.svg' },
  { name: 'Edge UltraYield', logo: '/powered-by/edge-ultrayield.svg' },
  { name: 'Curve', logo: '/powered-by/curve.svg' },
] as const

function stepStatusLabel(step: ExecutionStep): string {
  if (step.status === 'active') return 'In progress'
  if (step.status === 'done') return 'Done'
  if (step.status === 'error') return 'Needs attention'
  return 'Waiting'
}

function isCollapsedApproval(step: ExecutionStep): boolean {
  return step.id === 'approve' && step.status === 'done'
}

function estimateAnnualYield(amount: string, apyLabel: string, symbol: string): string | undefined {
  const parsedAmount = Number(amount)
  const apyMatch = apyLabel.match(/(\d+(?:\.\d+)?)%/)
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || !apyMatch) return undefined

  const yearlyYield = parsedAmount * (Number(apyMatch[1]) / 100)
  return `${yearlyYield.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })} ${symbol} / year`
}

function parseApyPercent(apyLabel: string): number | undefined {
  const apyMatch = apyLabel.match(/(\d+(?:\.\d+)?)%/)
  if (!apyMatch) return undefined
  return Number(apyMatch[1])
}

function formatPositionValue(value: number, symbol: string): string {
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: 4,
    minimumFractionDigits: 4,
  })} ${symbol}`
}

function formatDisplayAmount(amount: string): string {
  const parsed = Number(amount)
  if (!Number.isFinite(parsed)) return amount
  return parsed.toLocaleString(undefined, {
    maximumFractionDigits: 6,
  })
}

function parseLeverageMultiplier(leverageLabel: string): number | undefined {
  const leverageMatch = leverageLabel.match(/(\d+(?:\.\d+)?)x/)
  if (!leverageMatch) return undefined
  return Number(leverageMatch[1])
}

function formatCompactTokenAmount(value: number, symbol: string): string {
  if (!Number.isFinite(value) || value <= 0) return `0 ${symbol}`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M ${symbol}`
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K ${symbol}`
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol}`
}

function chainTone(chainName: string): string {
  return chainName.toLowerCase().includes('ethereum') ? 'ethereum' : 'monad'
}

function TokenIcon({ symbol }: { symbol: string }) {
  if (symbol.toUpperCase().includes('ETH')) {
    return (
      <svg aria-hidden="true" className="token-icon eth" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r="15" />
        <path d="M16 4.8 8.4 16.3 16 20.8l7.6-4.5L16 4.8Z" />
        <path d="M8.4 17.8 16 27.2l7.6-9.4-7.6 4.5-7.6-4.5Z" />
        <path d="m16 12.6-7.6 3.7 7.6 4.5 7.6-4.5-7.6-3.7Z" />
      </svg>
    )
  }

  return (
    <svg aria-hidden="true" className="token-icon usdc" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="15" />
      <path d="M9.8 9.4a9.6 9.6 0 0 0 0 13.2M22.2 9.4a9.6 9.6 0 0 1 0 13.2" />
      <text x="16" y="20.3">$</text>
    </svg>
  )
}

function useSimulatedPositionValue(amount: string, apyLabel: string, active: boolean): number {
  const baseAmount = useMemo(() => {
    const parsed = Number(amount)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }, [amount])
  const apyPercent = useMemo(() => parseApyPercent(apyLabel) ?? 0, [apyLabel])
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    setElapsedMs(0)
    if (!active || baseAmount <= 0 || apyPercent <= 0) return
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const startedAt = Date.now()
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt)
    }, 2000)

    return () => window.clearInterval(interval)
  }, [active, apyPercent, baseAmount])

  const yearlyYield = baseAmount * (apyPercent / 100)
  const elapsedYearFraction = elapsedMs / (365 * 24 * 60 * 60 * 1000)
  return baseAmount + yearlyYield * elapsedYearFraction
}

export function TransactionCockpit({
  amount,
  accountStatus,
  hasStartedFlow = false,
  isProjectReady,
  isBusy,
  opportunity,
  opportunities = [opportunity],
  manageUrl,
  steps,
  error,
  routeWarning,
  onAmountChange,
  onConnect,
  onExecute,
  onSelectOpportunity,
}: TransactionCockpitProps) {
  const isConnected = accountStatus === 'connected'
  const positionOpen = Boolean(manageUrl)
  const canUseOpportunity = opportunity.isExecutable !== false
  const canExecute = isConnected && isProjectReady && canUseOpportunity && Number(amount) > 0 && !isBusy && !positionOpen && !routeWarning
  const canStart = isProjectReady && canUseOpportunity && Number(amount) > 0 && !isBusy && !positionOpen && !routeWarning
  const annualYield = estimateAnnualYield(amount, opportunity.apyLabel, opportunity.tokenSymbol)
  const parsedAmount = Number(amount)
  const displayAmount = Number.isFinite(parsedAmount) ? parsedAmount.toLocaleString() : amount
  const leverageMultiplier = parseLeverageMultiplier(opportunity.leverageLabel)
  const borrowedEstimate = leverageMultiplier && Number.isFinite(parsedAmount)
    ? Math.max(parsedAmount * (leverageMultiplier - 1), 0)
    : undefined
  const simulatedPositionValue = useSimulatedPositionValue(amount, opportunity.apyLabel, positionOpen)
  const actionLabel = hasStartedFlow && isConnected
    ? isBusy ? 'Opening position' : `Earn ${opportunity.apyLabel.replace('up to ', '')}`
    : 'Start earning'
  const showExecution = hasStartedFlow || positionOpen || !isProjectReady || Boolean(error)
  const shellRef = useRef<HTMLElement>(null)
  const amountFieldRef = useRef<HTMLLabelElement>(null)
  const actionButton = isConnected ? (
    <button
      className="primary-action"
      disabled={hasStartedFlow ? !canExecute : !canStart}
      type="button"
      onClick={onExecute}
    >
      {actionLabel}
    </button>
  ) : (
    <button
      className="primary-action"
      disabled={!canStart}
      type="button"
      onClick={onConnect}
    >
      Start earning
    </button>
  )

  useEffect(() => {
    if (!hasStartedFlow || positionOpen) return
    if (globalThis.matchMedia?.('(min-width: 900px)').matches) return
    amountFieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [hasStartedFlow, positionOpen])

  return (
    <main className={`shell ${positionOpen ? 'is-invested' : showExecution ? 'is-expanded' : 'is-landing'}`} ref={shellRef}>
      {!positionOpen && <section className={`opportunity-panel ${showExecution ? 'route-context' : ''}`} aria-label="0x.credit opportunities">
        <div className="brand-row">
          <span className="brand-mark" aria-hidden="true">0x</span>
          <span>0x.credit</span>
        </div>

        {showExecution ? (
          <div className="route-masthead" aria-label="Selected route">
            <div className="route-crumbs">
              <span>Opportunities</span>
              <span aria-hidden="true">/</span>
              <strong>{opportunity.tokenSymbol} on {opportunity.chainName}</strong>
            </div>
            <span>Pool</span>
            <strong>{opportunity.strategyName}</strong>
            <p>{opportunity.apyLabel} · {opportunity.leverageLabel}</p>
          </div>
        ) : (
          <div className="headline-grid">
            <h1 className="hero-line">Earn amplified yield effortlessly</h1>
            <p>Pick an opportunity, input the amount, and open your earn account.</p>
          </div>
        )}

        <div className="opportunity-list" aria-label="Opportunities">
          {opportunities.map(item => {
            const selected = item.id === opportunity.id
            const tone = chainTone(item.chainName)
            if (showExecution && !selected) return null

            return (
              <article
                aria-label={`${item.tokenSymbol} on ${item.chainName} opportunity`}
                className={`opportunity-card ${tone} ${selected ? 'selected' : ''}`}
                key={item.id}
              >
                <button
                  aria-label={`${item.tokenSymbol} on ${item.chainName} ${item.apyLabel}`}
                  className="opportunity-card-main"
                  disabled={positionOpen}
                  type="button"
                  onClick={() => onSelectOpportunity?.(item)}
                >
                  <span className={`opportunity-title ${tone}`}>
                    <TokenIcon symbol={item.tokenSymbol} />
                    <span className="asset-copy">
                      <strong>{item.tokenSymbol}</strong>
                      <small>{item.chainName}</small>
                    </span>
                  </span>
                  <span className="apy-pill">{item.apyLabel}</span>
                </button>

                <div className={`route-details ${showExecution ? 'inline-details' : ''}`}>
                  <button
                    type="button"
                    onClick={() => onSelectOpportunity?.(item)}
                  >
                    Show details
                  </button>
                  <div className="facts-row" aria-label="Route facts">
                    <span>Pool: {item.strategyName}</span>
                    <span>Strategy: {item.strategyId}</span>
                    <span>{item.leverageLabel}</span>
                    <span>{item.protectionLabel}</span>
                    {item.minDepositLabel && <span>{item.minDepositLabel}</span>}
                  </div>
                </div>

              </article>
            )
          })}
        </div>

        {!showExecution && (
          <section className="powered-by" aria-label="Powered by">
            <span>Powered by</span>
            <div className="powered-by-logos">
              {POWERED_BY_PARTNERS.map(partner => (
                <span className="powered-by-logo" key={partner.name}>
                  <img alt={partner.name} src={partner.logo} />
                </span>
              ))}
            </div>
          </section>
        )}

        {showExecution && (
          <div className="route-context-note">
            <span>Route details</span>
            <div className="context-facts" aria-label="Selected route details">
              <span>Pool: {opportunity.strategyName}</span>
              <span>Strategy: {opportunity.strategyId}</span>
              <span>{opportunity.leverageLabel}</span>
              <span>{opportunity.protectionLabel}</span>
              {opportunity.minDepositLabel && <span>{opportunity.minDepositLabel}</span>}
            </div>
          </div>
        )}

        {showExecution && (
          <section className="position-explained" aria-label="Your position explained">
            <h3>Your position explained</h3>
            <ol>
              <li>You deposit <strong>{displayAmount} {opportunity.tokenSymbol}</strong> as collateral.</li>
              {borrowedEstimate !== undefined && (
                <li>Gearbox lends about <strong>{formatCompactTokenAmount(borrowedEstimate, opportunity.tokenSymbol)}</strong> to amplify the route.</li>
              )}
              <li><strong>{opportunity.protectionLabel}</strong> is included where available.</li>
              <li>APY and health factor can move after opening.</li>
            </ol>
          </section>
        )}
      </section>}

      {showExecution && <section className="execution-panel" aria-label="0x.credit route">
        {!isProjectReady && (
          <p className="alert">Set VITE_REOWN_PROJECT_ID to enable wallet connections.</p>
        )}

        {!positionOpen && hasStartedFlow && (
          <header className="flow-heading">
            <span>Selected route</span>
            <h2>Open {opportunity.tokenSymbol} earn account</h2>
            <p>Approve once, then open the account. The approved amount is supplied inside the account opening action.</p>
          </header>
        )}

        {!positionOpen && hasStartedFlow && (
          <div className="route-topline">
            <label className="amount-field" ref={amountFieldRef}>
              <span>Deposit amount</span>
              <input
                aria-label="Deposit amount"
                inputMode="decimal"
                placeholder="0.00"
                type="text"
                value={amount}
                onChange={event => onAmountChange(event.target.value)}
              />
            </label>

            {annualYield && (
              <section className="journey-summary" aria-label="Earning summary">
                <span>Est. yield</span>
                <strong>{annualYield}</strong>
              </section>
            )}
          </div>
        )}

        {routeWarning && <p className="alert">{routeWarning}</p>}
        {!routeWarning && opportunity.disabledReason && <p className="alert">{opportunity.disabledReason}</p>}
        {error && <p className="alert">{error}</p>}

        {positionOpen && manageUrl && (
          <section className="position-live" aria-label="Open position">
            <div className="live-kicker">
              <span>0x.credit</span>
              <strong>Position live</strong>
            </div>
            <h2>Account earning</h2>
            <span className="value-label">Credit account value</span>
            <strong>{formatPositionValue(simulatedPositionValue, opportunity.tokenSymbol)}</strong>
            <div className="live-stats" aria-label="Position summary">
              <span>Route APY <strong>{opportunity.apyLabel.replace('up to ', '')}</strong></span>
              {annualYield && <span>Annual pace <strong>{annualYield}</strong></span>}
            </div>
            <p>Simulated live from the current route.</p>
            <a className="manage-link" href={manageUrl} rel="noreferrer" target="_blank">
              Manage position
            </a>
          </section>
        )}

        {!positionOpen && hasStartedFlow && (
          <ol className="step-list" aria-label="Execution steps">
            {steps.map(step => {
              const collapsedApproval = isCollapsedApproval(step)

              return (
                <li
                  className={`step-card ${step.status}${collapsedApproval ? ' compact' : ''}`}
                  key={step.id}
                >
                  <div className="step-index" aria-hidden="true" />
                  <div>
                    <div className="step-heading">
                      <span>{collapsedApproval ? 'Approved' : step.label}</span>
                      <small>{stepStatusLabel(step)}</small>
                    </div>
                    {!collapsedApproval && (
                      <p>
                        {step.id === 'account'
                          ? `Opening with ${formatDisplayAmount(amount)} ${opportunity.tokenSymbol}. The approved amount is supplied inside this wallet action.`
                          : step.detail}
                      </p>
                    )}
                    {!collapsedApproval && step.walletPrompt && <p className="wallet-prompt">{step.walletPrompt}</p>}
                    {!collapsedApproval && step.txHash && <p className="tx-hash">{step.txHash}</p>}
                    {step.error && <p className="step-error">{step.error}</p>}
                  </div>
                </li>
              )
            })}
          </ol>
        )}

        {!positionOpen && hasStartedFlow && (
          <div className="flow-footer">
            {actionButton}
          </div>
        )}
      </section>}
    </main>
  )
}
