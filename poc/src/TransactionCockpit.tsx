import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ExecutionStep } from './lib/gearbox/plan'
import { getDepositControls } from './lib/gearbox/deposit'
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
  { name: 'Gearbox', logo: 'https://docs.gearbox.finance/assets/brand/gearbox-icon.svg' },
  { name: 'KPK', logo: '/powered-by/kpk.svg' },
  { name: 'Beefy', logo: '/powered-by/beefy.svg' },
  { name: 'Edge UltraYield', logo: '/powered-by/edge-ultrayield.svg' },
  { name: 'Curve', logo: 'https://www.gearbox.finance/assets/partners/partner-curve.svg' },
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

function ApyBreakdown({ baseApyPercent, apyPercent, leverageMultiple, borrowRatePercent }: {
  baseApyPercent: number
  apyPercent: number
  leverageMultiple: number
  borrowRatePercent?: number
}) {
  const leverageNetGain = apyPercent - baseApyPercent
  const total = apyPercent
  const baseWidth = total > 0 ? (baseApyPercent / total) * 100 : 0
  const leverageWidth = total > 0 ? (leverageNetGain / total) * 100 : 0
  const borrowCostPct = borrowRatePercent !== undefined
    ? (borrowRatePercent * (leverageMultiple - 1)).toFixed(2)
    : undefined

  return (
    <div className="apy-breakdown">
      <div className="breakdown-title">How your yield is built</div>
      <div className="breakdown-bar">
        <div className="breakdown-seg base-seg" style={{ width: `${baseWidth}%` }} />
        <div className="breakdown-seg leverage-seg" style={{ width: `${leverageWidth}%` }} />
      </div>
      <div className="breakdown-meta">
        <span><span className="breakdown-dot base-dot" /> Base APY {baseApyPercent.toFixed(1)}%</span>
        <span><span className="breakdown-dot leverage-dot" /> Leverage ×{leverageMultiple.toFixed(1)} boost</span>
        {borrowRatePercent !== undefined && (
          <span className="breakdown-cost">Borrow rate {borrowRatePercent.toFixed(2)}% · Cost {borrowCostPct}%</span>
        )}
      </div>
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

  // Domain based on amplified + optimistic for top, start just below deposit
  const [yMin, yMax] = useMemo(() => {
    if (!data.length) return [deposit * 0.9, deposit * 2]
    const maxAmp = Math.max(...data.map(d => d.amplified))
    const maxOpt = Math.max(...data.map(d => d.optimistic))
    return [deposit * 0.92, Math.max(maxAmp, maxOpt) * 1.06]
  }, [data, deposit])

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 12, right: 24, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
        <XAxis
          dataKey="month"
          tickFormatter={m => m === 0 ? 'Now' : `${m}m`}
          tick={{ fontSize: 11, fill: 'rgb(120,120,120)' }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={v => `${v.toFixed(1)}`}
          tick={{ fontSize: 11, fill: 'rgb(120,120,120)' }}
          axisLine={false}
          tickLine={false}
          width={48}
          domain={[yMin, yMax]}
          allowDataOverflow
          unit={` ${symbol}`}
        />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            const relevant = (payload as unknown as Array<{ dataKey: string; value: number; stroke: string }>)
              .filter(p => p.dataKey === 'amplified' || p.dataKey === 'plain')
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

        {/* Deposit reference */}
        <ReferenceLine
          y={deposit}
          stroke="rgba(0,0,0,0.18)"
          strokeDasharray="4 4"
        />

        {/* Scenario range: thin dashed envelope lines */}
        <Line
          type="monotone"
          dataKey="optimistic"
          stroke="rgba(228,43,12,0.22)"
          strokeWidth={1}
          strokeDasharray="3 5"
          dot={false}
          isAnimationActive={false}
          legendType="none"
        />
        <Line
          type="monotone"
          dataKey="pessimistic"
          stroke="rgba(228,43,12,0.22)"
          strokeWidth={1}
          strokeDasharray="3 5"
          dot={false}
          isAnimationActive={false}
          legendType="none"
        />

        {/* Main trajectories */}
        {baseApyPercent !== undefined && (
          <Line
            type="monotone"
            dataKey="plain"
            stroke="#2457ff"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive={false}
          />
        )}
        <Line
          type="monotone"
          dataKey="amplified"
          stroke="#E42B0C"
          strokeWidth={2.5}
          dot={false}
          isAnimationActive={false}
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

  const apyPercent = opportunity.apyPercent ?? 0
  const baseApyPercent = opportunity.baseApyPercent
  const borrowRatePercent = opportunity.borrowRatePercent
  const leverageMultiple = opportunity.leverageMultiple ?? 1
  const minimumDeposit = opportunity.minimumDeposit ?? 0

  const annualYield = validAmount ? parsedAmount * (apyPercent / 100) : undefined
  const borrowedEstimate = validAmount ? Math.max(parsedAmount * (leverageMultiple - 1), 0) : undefined

  const controls = useMemo(() => getDepositControls(minimumDeposit > 0 ? minimumDeposit : 1), [minimumDeposit])

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
                {opp.apyPercent !== undefined && (
                  <span className="tab-apy">{opp.apyPercent.toFixed(1)}%</span>
                )}
              </button>
            ))}
          </div>

          <w3m-button size="sm" />
        </header>

        {/* Two-pane body */}
        <div className="cockpit-body">
          {/* Left: projection chart + APY breakdown */}
          <section className="cockpit-chart-pane" aria-label="Projected earnings">
            <div className="chart-header">
              <div>
                <span className="chart-title">Projected balance</span>
                {apyPercent > 0 && (
                  <span className="chart-apy-badge">{apyPercent.toFixed(1)}% APY</span>
                )}
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
              <ProjectionChart
                deposit={depositForChart}
                apyPercent={apyPercent}
                baseApyPercent={baseApyPercent}
                horizon={horizon}
                symbol={opportunity.tokenSymbol}
              />
            </div>

            {baseApyPercent !== undefined && (
              <div className="chart-legend">
                <span className="legend-amplified">━ Amplified ({apyPercent.toFixed(1)}%)</span>
                <span className="legend-plain">┅ Plain ({baseApyPercent.toFixed(1)}%)</span>
                <span className="legend-band">░ ±30% scenario range</span>
              </div>
            )}

            {baseApyPercent !== undefined && (
              <ApyBreakdown
                baseApyPercent={baseApyPercent}
                apyPercent={apyPercent}
                leverageMultiple={leverageMultiple}
                borrowRatePercent={borrowRatePercent}
              />
            )}
          </section>

          {/* Right: builder */}
          <section className="cockpit-builder" aria-label="Open Smart account">
            <div className="builder-heading">
              <span className="selected-label">Selected strategy</span>
              <strong className="builder-token">{opportunity.tokenSymbol} · {apyPercent > 0 ? `${apyPercent.toFixed(2)}% APY` : opportunity.apyLabel}</strong>
              <span className="builder-strategy">{opportunity.strategyName}</span>
            </div>

            {/* Deposit input */}
            <div className="deposit-section">
              <label className="deposit-label" htmlFor="deposit-amount">Deposit amount</label>
              <input
                id="deposit-amount"
                aria-label="Deposit amount"
                className="deposit-input"
                inputMode="decimal"
                placeholder="0.00"
                type="text"
                value={amount}
                onChange={e => onAmountChange(e.target.value)}
              />

              {/* Preset chips */}
              <div className="deposit-presets">
                {controls.presets.map(preset => (
                  <button
                    key={preset.label}
                    type="button"
                    className="preset-chip"
                    onClick={() => onAmountChange(preset.value.toFixed(Math.min(4, opportunity.collateralDecimals ?? 4)))}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Stepper */}
              <div className="deposit-stepper">
                <button
                  type="button"
                  className="stepper-btn reset-btn"
                  aria-label="Reset"
                  onClick={() => onAmountChange(controls.reset.toFixed(Math.min(4, opportunity.collateralDecimals ?? 4)))}
                >
                  Reset
                </button>
                {controls.steps.map(step => (
                  <button
                    key={step}
                    type="button"
                    className="stepper-btn"
                    aria-label={`+${step}`}
                    onClick={() => {
                      const next = (validAmount ? parsedAmount : 0) + step
                      onAmountChange(next.toFixed(Math.min(4, opportunity.collateralDecimals ?? 4)))
                    }}
                  >
                    +{step}
                  </button>
                ))}
              </div>
            </div>

            {/* Position preview card */}
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

            {/* Alerts */}
            {!isProjectReady && (
              <p className="alert">Set VITE_REOWN_PROJECT_ID to enable wallet connections.</p>
            )}
            {routeWarning && <p className="alert">{routeWarning}</p>}
            {!routeWarning && opportunity.disabledReason && <p className="alert">{opportunity.disabledReason}</p>}
            {displayError && <p className="alert">{displayError}</p>}

            {/* Execution steps */}
            {steps.length > 0 && (
              <ol className="step-rail" aria-label="Execution steps">
                {steps.map(step => {
                  const collapsed = isCollapsedApproval(step)
                  const stepError = step.error ? formatTransactionError(step.error) : undefined
                  return (
                    <li key={step.id} className={`step-card ${step.status}${collapsed ? ' compact' : ''}`}>
                      <div className="step-index" aria-hidden="true" />
                      <div>
                        <div className="step-heading">
                          <span>{collapsed ? 'Approved' : step.label}</span>
                          <small>{stepStatusLabel(step)}</small>
                        </div>
                        {!collapsed && <p>{step.id === 'account' ? `Opening with ${amount} ${opportunity.tokenSymbol}. The approved amount is supplied inside this wallet action.` : step.detail}</p>}
                        {!collapsed && step.walletPrompt && <p className="wallet-prompt">{step.walletPrompt}</p>}
                        {!collapsed && step.txHash && <p className="tx-hash">{step.txHash}</p>}
                        {stepError && <p className="step-error">{stepError}</p>}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}

            {hasStoredPosition && !positionOpen && onViewPosition && (
              <button type="button" className="view-position-link" onClick={onViewPosition}>
                View your active Smart account →
              </button>
            )}

            {/* CTA */}
            <div className="builder-footer">
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
