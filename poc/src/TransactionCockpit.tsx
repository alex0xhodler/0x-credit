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
  const simulatedPositionValue = useSimulatedPositionValue(amount, opportunity.apyLabel, positionOpen)
  const actionLabel = hasStartedFlow && isConnected
    ? isBusy ? 'Opening position' : `Earn ${opportunity.apyLabel.replace('up to ', '')}`
    : 'Start earning'
  const showExecution = hasStartedFlow || positionOpen || !isProjectReady || Boolean(error)
  const shellRef = useRef<HTMLElement>(null)
  const amountFieldRef = useRef<HTMLLabelElement>(null)

  useEffect(() => {
    if (!hasStartedFlow || positionOpen) return
    if (globalThis.matchMedia?.('(min-width: 900px)').matches) {
      shellRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    amountFieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [hasStartedFlow, positionOpen])

  return (
    <main className={`shell ${positionOpen ? 'is-invested' : showExecution ? 'is-expanded' : 'is-landing'}`} ref={shellRef}>
      {!positionOpen && <section className="opportunity-panel" aria-label="0x.credit opportunities">
        <div className="brand-row">
          <span className="brand-mark" aria-hidden="true">0x</span>
          <span>0x.credit</span>
        </div>

        <div className="headline-grid">
          <h1 className="hero-line">Earn amplified yield effortlessly</h1>
          <p>Pick an opportunity, input the amount, and open your earn account.</p>
        </div>

        <div className="opportunity-list" aria-label="Opportunities">
          {opportunities.map(item => {
            const selected = item.id === opportunity.id

            return (
              <article
                aria-label={`${item.tokenSymbol} on ${item.chainName} opportunity`}
                className={`opportunity-card ${selected ? 'selected' : ''}`}
                key={item.id}
              >
                <button
                  aria-label={`${item.tokenSymbol} on ${item.chainName} ${item.apyLabel}`}
                  className="opportunity-card-main"
                  disabled={positionOpen}
                  type="button"
                  onClick={() => onSelectOpportunity?.(item)}
                >
                  <span>{item.tokenSymbol} on {item.chainName}</span>
                  <strong>{item.apyLabel}</strong>
                  <small>{item.minDepositLabel || 'Best available route for this amount.'}</small>
                </button>

                <div className="route-details">
                  <button type="button">Show details</button>
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
      </section>}

      {showExecution && <section className="execution-panel" aria-label="0x.credit route">
        {!isProjectReady && (
          <p className="alert">Set VITE_REOWN_PROJECT_ID to enable wallet connections.</p>
        )}

        {!positionOpen && hasStartedFlow && (
          <div className="action-grid">
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

            {isConnected ? (
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
            )}
            {!hasStartedFlow && !routeWarning && (
              <p className="start-note">Best available route for this amount.</p>
            )}
          </div>
        )}

        {!positionOpen && hasStartedFlow && annualYield && (
          <section className="journey-summary" aria-label="Earning summary">
            <span>Target</span>
            <strong>Earn {opportunity.apyLabel.replace('up to ', '')} on {opportunity.tokenSymbol}</strong>
            <p>Est. {annualYield} on {Number(amount).toLocaleString()} {opportunity.tokenSymbol}.</p>
          </section>
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
      </section>}
    </main>
  )
}
