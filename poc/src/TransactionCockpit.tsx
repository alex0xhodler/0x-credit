import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ExecutionStep } from './lib/gearbox/plan'
import { buildProjection } from './lib/projection'
import { formatTransactionError } from './lib/gearbox/transactions'

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
  apyPercent?: number
  baseApyPercent?: number
  borrowRatePercent?: number
  leverageMultiple?: number
  minimumDeposit?: number
  collateralDecimals?: number
}

export interface ActivePositionStats {
  totalValue: number
  debt: number
  netValue: number
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
  onResetFlow?(): void
  hasStoredPosition?: boolean
  onViewPosition?(): void
  activePositionStats?: ActivePositionStats
}

type Horizon = 1 | 3 | 5

const POWERED_BY_PARTNERS = [
  { name: 'Gearbox', logo: '/powered-by/gearbox.webp' },
  { name: 'KPK', logo: '/powered-by/kpk.svg' },
  { name: 'Beefy', logo: '/powered-by/beefy.svg' },
  { name: 'Curve', logo: 'https://www.gearbox.finance/assets/partners/partner-curve.svg' },
] as const


function formatPositionValue(value: number, symbol: string): string {
  return `${value.toLocaleString('en-US', {
    maximumFractionDigits: 4,
    minimumFractionDigits: 4,
  })} ${symbol}`
}

function useSimulatedPositionValue(amount: string, apyPercent: number, active: boolean, activeStats?: ActivePositionStats): number {
  const baseAmount = useMemo(() => {
    if (activeStats) return activeStats.netValue
    const parsed = Number(amount)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }, [amount, activeStats])
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    setElapsedMs(0)
    if (!active || baseAmount <= 0 || apyPercent <= 0) return
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const startedAt = Date.now()
    const interval = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 2000)
    return () => window.clearInterval(interval)
  }, [active, apyPercent, baseAmount])

  const yearlyYield = baseAmount * (apyPercent / 100)
  const elapsedYearFraction = elapsedMs / (365 * 24 * 60 * 60 * 1000)
  return baseAmount + yearlyYield * elapsedYearFraction
}

function TokenIcon({ symbol }: { symbol: string }) {
  if (symbol.toUpperCase().includes('ETH')) {
    return <img aria-hidden="true" className="token-icon eth" src="https://cryptoicon.io/wp-content/uploads/cc-assets/SVG/Dark/ETH.svg" alt="" />
  }
  if (symbol.toUpperCase() === 'AUSD') {
    return <img aria-hidden="true" className="token-icon ausd" src="/agora-bug--agora-gold.svg" alt="" />
  }
  return <img aria-hidden="true" className="token-icon usdc" src="https://cryptoicon.io/wp-content/uploads/cc-assets/SVG/Color/USDC.svg" alt="" />
}

function chainTone(chainName: string): string {
  return chainName.toLowerCase().includes('ethereum') ? 'ethereum' : 'monad'
}

function formatCompact(value: number, symbol: string): string {
  if (!Number.isFinite(value) || value <= 0) return `0 ${symbol}`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M ${symbol}`
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K ${symbol}`
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol}`
}


function ChartSkeleton() {
  return (
    <div className="chart-skeleton">
      {[0,1,2,3,4].map(i => <div key={i} className="csk-grid" />)}
      <svg className="csk-path" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0,54 C18,50 38,42 58,30 S82,17 100,11 L100,60 L0,60 Z"
              fill="rgba(228,43,12,0.05)" />
        <path className="csk-curve" d="M0,54 C18,50 38,42 58,30 S82,17 100,11"
              stroke="rgba(228,43,12,0.22)" strokeWidth="2.5" fill="none"
              strokeLinecap="round" />
      </svg>
      <div className="csk-shimmer" />
    </div>
  )
}

function ProjectionChart({ deposit, apyPercent, baseApyPercent, horizon, symbol }: {
  deposit: number
  apyPercent: number
  baseApyPercent?: number
  horizon: Horizon
  symbol: string
}) {
  const data = useMemo(
    () => buildProjection({ deposit, apyPercent, baseApyPercent, years: horizon }),
    [deposit, apyPercent, baseApyPercent, horizon],
  )

  const [yMin, yMax] = useMemo(() => {
    if (!data.length) return [deposit * 0.9, deposit * 2]
    const maxAmp = Math.max(...data.map(d => d.amplified))
    return [deposit * 0.96, maxAmp * 1.04]
  }, [data, deposit])

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 16, right: 20, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="grad-amplified" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E42B0C" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#E42B0C" stopOpacity={0.01} />
          </linearGradient>
          <linearGradient id="grad-plain" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2457ff" stopOpacity={0.1} />
            <stop offset="100%" stopColor="#2457ff" stopOpacity={0.0} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />

        <XAxis
          dataKey="month"
          tickFormatter={m => m === 0 ? 'Now' : `${m}m`}
          tick={{ fontSize: 11, fill: 'rgb(150,150,150)' }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />

        <YAxis
          tickFormatter={v => v.toFixed(1)}
          tick={{ fontSize: 11, fill: 'rgb(150,150,150)' }}
          axisLine={false}
          tickLine={false}
          width={32}
          domain={[yMin, yMax]}
          allowDataOverflow
          tickCount={4}
        />

        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            const relevant = (payload as unknown as Array<{ dataKey: string; value: number; stroke: string }>)
              .filter(p => p.dataKey === 'amplified' || p.dataKey === 'plain')
              .sort((a, _b) => a.dataKey === 'amplified' ? -1 : 1)
            if (!relevant.length) return null
            const m = Number(label)
            const timeLabel = m >= 12
              ? `${Math.floor(m / 12)}Y${m % 12 ? ` ${m % 12}m` : ''}`
              : `Month ${m}`
            return (
              <div className="chart-tooltip">
                <div className="tooltip-time">{timeLabel}</div>
                {relevant.map(p => {
                  const val = Number(p.value)
                  const pctGain = deposit > 0 ? ((val / deposit - 1) * 100) : 0
                  return (
                    <div key={p.dataKey} className="tooltip-row" style={{ color: p.stroke }}>
                      {p.dataKey === 'amplified' ? '↑ Amplified' : '→ Plain'}{' '}
                      <strong>{val.toFixed(3)} {symbol}</strong>
                      {pctGain > 0.5 && (
                        <span className="tooltip-gain"> +{pctGain.toFixed(0)}%</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          }}
        />

        {baseApyPercent !== undefined && (
          <Area
            type="monotone"
            dataKey="plain"
            stroke="rgba(36,87,255,0.55)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            fill="url(#grad-plain)"
            dot={false}
            isAnimationActive={false}
          />
        )}

        <Area
          type="monotone"
          dataKey="amplified"
          stroke="#E42B0C"
          strokeWidth={2.5}
          fill="url(#grad-amplified)"
          dot={false}
          isAnimationActive={true}
          animationDuration={700}
          animationEasing="ease-out"
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function TransactionCockpit({
  amount,
  accountStatus,
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
  onResetFlow,
  hasStoredPosition,
  onViewPosition,
  activePositionStats,
}: TransactionCockpitProps) {
  const [horizon, setHorizon] = useState<Horizon>(1)
  const isConnected = accountStatus === 'connected'
  const positionOpen = Boolean(manageUrl)
  const canUseOpportunity = opportunity.isExecutable !== false
  const parsedAmount = Number(amount)
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0

  const canExecute = isConnected && isProjectReady && canUseOpportunity && validAmount && !isBusy && !positionOpen && !routeWarning
  const canStart = isProjectReady && canUseOpportunity && validAmount && !isBusy && !positionOpen && !routeWarning

  const isDataLoading = opportunity.apyPercent === undefined
  const apyPercent = opportunity.apyPercent ?? 0
  const baseApyPercent = opportunity.baseApyPercent
  const borrowRatePercent = opportunity.borrowRatePercent
  const leverageMultiple = opportunity.leverageMultiple ?? 1
  const minimumDeposit = opportunity.minimumDeposit ?? 0

  const annualYield = validAmount ? parsedAmount * (apyPercent / 100) : undefined
  const borrowedEstimate = validAmount ? Math.max(parsedAmount * (leverageMultiple - 1), 0) : undefined

const simulatedPositionValue = useSimulatedPositionValue(amount, apyPercent, positionOpen, activePositionStats)

  const actionLabel = isConnected
    ? isBusy ? 'Opening Smart account...' : `Earn ${apyPercent.toFixed(2)}%`
    : 'Start earning'

  const displayError = error ? formatTransactionError(error) : undefined

  const positionAnnualYield = useMemo(() => {
    const base = activePositionStats ? activePositionStats.netValue : parsedAmount
    if (!Number.isFinite(base) || base <= 0 || apyPercent <= 0) return undefined
    const y = base * (apyPercent / 100)
    return `${y.toFixed(2)} ${opportunity.tokenSymbol} / year`
  }, [activePositionStats, parsedAmount, apyPercent, opportunity.tokenSymbol])

  const actionButton = isConnected ? (
    <button
      className="primary-action"
      disabled={!canExecute}
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

  // ── Invested (position open) ─────────────────────────────────────────────
  if (positionOpen) {
    return (
      <main className="shell is-invested">
        <section className="execution-panel" aria-label="0x.credit route">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
            <w3m-button size="sm" />
          </div>
          <section className="position-live" aria-label="Open position">
            <div className="live-kicker">
              <span>0x.credit</span>
              <strong>Position live</strong>
            </div>
            <h2>Smart account earning</h2>
            <span className="value-label">Smart account value</span>
            <strong>{formatPositionValue(simulatedPositionValue, opportunity.tokenSymbol)}</strong>
            <div className="live-stats" aria-label="Position summary">
              {activePositionStats && (
                <>
                  <span>Total value <strong>{formatPositionValue(activePositionStats.totalValue, opportunity.tokenSymbol)}</strong></span>
                  <span>Debt <strong>{formatPositionValue(activePositionStats.debt, opportunity.tokenSymbol)}</strong></span>
                </>
              )}
              <span>Strategy APY <strong>{apyPercent.toFixed(2)}%</strong></span>
              {positionAnnualYield && <span>Annual pace <strong>{positionAnnualYield}</strong></span>}
            </div>
            <div className="position-actions">
              <a className="manage-link" href={manageUrl} rel="noreferrer" target="_blank">
                Manage position
              </a>
              {onResetFlow && (
                <button type="button" className="reset-flow-link" onClick={onResetFlow}>
                  Create a new Smart account
                </button>
              )}
            </div>
          </section>
        </section>
      </main>
    )
  }

  const depositForChart = validAmount ? parsedAmount : minimumDeposit || 1

  // ── Cockpit ──────────────────────────────────────────────────────────────
  return (
    <div className="cockpit-wrap">
      {/* Small hero */}
      <div className="cockpit-hero">
        <p className="cockpit-tagline">Earn amplified yields on auto-pilot</p>
      </div>

      <main className="cockpit">
        {/* Header row: brand + tabs + wallet */}
        <header className="cockpit-header">
          <div className="brand-row">
            <span className="brand-mark" aria-hidden="true">0x</span>
            <span>0x.credit</span>
          </div>

          <div role="tablist" aria-label="Strategy" className="strategy-tabs">
            {opportunities.map(opp => (
              <button
                key={opp.id}
                role="tab"
                aria-selected={opp.id === opportunity.id}
                className={`strategy-tab ${chainTone(opp.chainName)} ${opp.id === opportunity.id ? 'active' : ''}`}
                onClick={() => onSelectOpportunity?.(opp)}
                type="button"
              >
                <TokenIcon symbol={opp.tokenSymbol} />
                <span>{opp.tokenSymbol}</span>
                {opp.apyPercent !== undefined
                  ? <span className="tab-apy">{opp.apyPercent.toFixed(1)}%</span>
                  : <span className="tab-apy tab-apy--loading" aria-hidden="true" />
                }
              </button>
            ))}
          </div>

        </header>

        {/* Two-pane body */}
        <div className="cockpit-body">
          {/* Left: projection chart + APY breakdown */}
          <section className="cockpit-chart-pane" aria-label="Projected earnings">
            <div className="chart-header">
              <div>
                <span className="chart-title">Projected balance <span className="chart-title-unit">{opportunity.tokenSymbol}</span></span>
                {isDataLoading
                  ? <span className="chart-apy-badge chart-apy-badge--loading" aria-hidden="true" />
                  : apyPercent > 0 && <span className="chart-apy-badge">{apyPercent.toFixed(1)}% APY</span>
                }
              </div>
              <div className="horizon-toggle" role="group" aria-label="Projection horizon">
                {([1, 3, 5] as Horizon[]).map(y => (
                  <button
                    key={y}
                    type="button"
                    className={`horizon-btn ${horizon === y ? 'active' : ''}`}
                    onClick={() => setHorizon(y)}
                  >
                    {y}Y
                  </button>
                ))}
              </div>
            </div>

            <div className="chart-grow">
              {isDataLoading
                ? <ChartSkeleton />
                : <ProjectionChart
                    deposit={depositForChart}
                    apyPercent={apyPercent}
                    baseApyPercent={baseApyPercent}
                    horizon={horizon}
                    symbol={opportunity.tokenSymbol}
                  />
              }
            </div>

            {!isDataLoading && (
              <div className="chart-footer">
                <span className="cf-item">
                  <span className="cf-swatch cf-swatch--amp" />
                  Amplified <strong>{apyPercent.toFixed(1)}%</strong>
                </span>
                {baseApyPercent !== undefined && (
                  <span className="cf-item">
                    <span className="cf-swatch cf-swatch--plain" />
                    Base <strong>{baseApyPercent.toFixed(1)}%</strong>
                  </span>
                )}
                <span className="cf-sep">·</span>
                <span className="cf-item">×{leverageMultiple.toFixed(1)} leverage</span>
                {borrowRatePercent !== undefined && (
                  <>
                    <span className="cf-sep">·</span>
                    <span className="cf-item cf-item--cost">{borrowRatePercent.toFixed(2)}% borrow/yr</span>
                  </>
                )}
              </div>
            )}
          </section>

          {/* Right: builder */}
          <section className="cockpit-builder" aria-label="Open Smart account">
            <div className="builder-scroll">
            <div className="builder-heading">
              <span className="selected-label">Selected strategy</span>
              <strong className="builder-token">
                {opportunity.tokenSymbol}
                <span className="builder-token-sep"> · </span>
                {isDataLoading
                  ? <span className="builder-apy-shimmer" aria-hidden="true" />
                  : `${apyPercent.toFixed(2)}% APY`
                }
              </strong>
              <span className="builder-strategy">{opportunity.strategyName}</span>
            </div>

            {/* Deposit input */}
            <div className={`deposit-section${isDataLoading ? ' is-loading' : ''}`}>
              <label className="deposit-label" htmlFor="deposit-amount">Deposit amount</label>
              <input
                id="deposit-amount"
                aria-label="Deposit amount"
                className="deposit-input"
                inputMode="decimal"
                placeholder={isDataLoading ? '—' : '0.00'}
                type="text"
                value={amount}
                disabled={isDataLoading}
                onChange={e => onAmountChange(e.target.value)}
              />

              {/* Amount presets — single row */}
              <div className="deposit-controls">
                <button
                  type="button"
                  className="deposit-preset"
                  onClick={() => onAmountChange(minimumDeposit.toFixed(Math.min(4, opportunity.collateralDecimals ?? 4)))}
                >
                  Min
                </button>
                {[5, 7, 10].map(v => (
                  <button
                    key={v}
                    type="button"
                    className="deposit-preset"
                    onClick={() => onAmountChange(String(v))}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Position explanation */}
            {validAmount && borrowedEstimate !== undefined && (
              <div className="position-explained">
                <p className="position-explained-title">Your position explained</p>
                <ul>
                  <li>You deposit <strong>{parsedAmount.toFixed(2)} {opportunity.tokenSymbol}</strong> as collateral.</li>
                  {borrowedEstimate > 0 && (
                    <li>KPK on Gearbox lends you about <strong>{formatCompact(borrowedEstimate, opportunity.tokenSymbol)}</strong> to amplify the strategy.</li>
                  )}
                  <li>APY and health factor can move after opening.</li>
                </ul>
              </div>
            )}

            {/* Alerts */}
            {!isProjectReady && (
              <p className="alert">Set VITE_REOWN_PROJECT_ID to enable wallet connections.</p>
            )}
            {routeWarning && <p className="alert">{routeWarning}</p>}
            {!routeWarning && opportunity.disabledReason && <p className="alert">{opportunity.disabledReason}</p>}
            {displayError && <p className="alert">{displayError}</p>}

            {hasStoredPosition && !positionOpen && onViewPosition && (
              <button type="button" className="view-position-link" onClick={onViewPosition}>
                View your active Smart account →
              </button>
            )}
            </div>{/* end builder-scroll */}

            {/* CTA — outside scroll area, always visible */}
            <div className="builder-footer">
            {/* Horizontal step track */}
            {(() => {
              const approveStep = steps.find(s => s.id === 'approve')
              const accountStep = steps.find(s => s.id === 'account')
              const approveStatus = approveStep?.status ?? 'waiting'
              const accountStatus = accountStep?.status ?? 'waiting'
              const approveDone = approveStatus === 'done'
              const accountDone = accountStatus === 'done'
              return (
                <div className="step-track" aria-label="Execution steps">
                  <div className={`step-node ${approveStatus}`}>
                    <div className="step-node-circle">{approveDone ? '✓' : '1'}</div>
                    <span className="step-node-label">Approve</span>
                    {approveStatus === 'active' && <span className="step-node-hint">Check wallet</span>}
                    {approveStep?.error && <span className="step-node-error">{formatTransactionError(approveStep.error)}</span>}
                  </div>
                  <div className={`step-connector${approveDone ? ' done' : ''}`} />
                  <div className={`step-node ${accountStatus}`}>
                    <div className="step-node-circle">{accountDone ? '✓' : '2'}</div>
                    <span className="step-node-label">Open account</span>
                    {accountStatus === 'active' && <span className="step-node-hint">Check wallet</span>}
                    {accountStep?.error && <span className="step-node-error">{formatTransactionError(accountStep.error)}</span>}
                  </div>
                  <div className={`step-connector${accountDone ? ' done' : ''}`} />
                  <div className="step-node info">
                    <div className="step-node-circle">✓</div>
                    <span className="step-node-label">Automated protection</span>
                  </div>
                </div>
              )
            })()}
              {validAmount && annualYield !== undefined && (
                <div className="position-preview" aria-label="Position preview">
                  <div className="preview-row">
                    <span className="preview-pay">
                      <span className="preview-dim">Deposit</span>
                      <strong>{parsedAmount} {opportunity.tokenSymbol}</strong>
                    </span>
                    <span className="preview-arrow">→</span>
                    <span className="preview-get">
                      <span className="preview-dim">Earn</span>
                      <strong className="preview-yield">{annualYield.toFixed(2)} {opportunity.tokenSymbol} / year</strong>
                    </span>
                  </div>
                  {borrowedEstimate !== undefined && borrowedEstimate > 0 && (
                    <div className="preview-meta">
                      <span>Leverage ×{leverageMultiple.toFixed(1)}</span>
                      <span>·</span>
                      <span>Borrows {formatCompact(borrowedEstimate, opportunity.tokenSymbol)}</span>
                    </div>
                  )}
                </div>
              )}
              {actionButton}
            </div>
          </section>
        </div>
      </main>

      {/* Footer: powered by */}
      <footer className="cockpit-footer" role="contentinfo">
        <span>Powered by</span>
        <div className="powered-by-logos">
          {POWERED_BY_PARTNERS.map(partner => (
            <span className="powered-by-logo" key={partner.name}>
              <img alt={partner.name} src={partner.logo} />
            </span>
          ))}
        </div>
      </footer>
    </div>
  )
}
