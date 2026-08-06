import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ExecutionStep } from './lib/gearbox/plan'
import { loadEthereumYieldBenchmarks, type YieldBenchmark } from './lib/defillamaYields'
import { buildBalanceTimeline, type ComparisonHorizon } from './lib/comparisonTimeline'
import { orderedComparisonTooltipRows } from './lib/chartTooltip'
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
  routeSteps?: readonly RouteStep[]
}

export interface RouteStep {
  role: string
  provider: string
}

export interface ActivePositionStats {
  totalValue: number
  debt: number
  netValue: number
}

export type HeaderVariant = 'desk' | 'journey' | 'ticket' | 'editorial'
export type TopbarVariant = 'identity' | 'shelf' | 'switchboard' | 'portfolio'

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
  headerVariant?: HeaderVariant
  topbarVariant?: TopbarVariant
}

type Horizon = ComparisonHorizon

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

function useDebouncedNumber(value: number, delayMs: number): number {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delayMs)
    return () => window.clearTimeout(timeout)
  }, [value, delayMs])

  return debouncedValue
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

const comparisonSeries = [
  { id: 'strategy', label: 'Net strategy', color: '#E42B0C', dash: undefined },
  { id: 'weth', label: 'Hold WETH', color: '#737373', dash: '3 4' },
  { id: 'lst', label: 'LST · stETH', color: '#2457ff', dash: undefined },
] as const

function useEthereumYieldBenchmarks() {
  const [benchmarks, setBenchmarks] = useState<YieldBenchmark[]>([])
  const [fetchedAt, setFetchedAt] = useState<Date>()

  useEffect(() => {
    const controller = new AbortController()
    loadEthereumYieldBenchmarks(controller.signal)
      .then(result => {
        setBenchmarks(result)
        setFetchedAt(new Date())
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setBenchmarks([])
        setFetchedAt(undefined)
      })
    return () => controller.abort()
  }, [])

  return { benchmarks, fetchedAt }
}

function YieldComparisonChart({ startingBalance, apyPercent, benchmarks, horizon }: { startingBalance: number; apyPercent: number; benchmarks: readonly YieldBenchmark[]; horizon: Horizon }) {
  const data = useMemo(() => buildBalanceTimeline({ startingBalance, strategyApyPercent: apyPercent, benchmarks, horizon }), [startingBalance, apyPercent, benchmarks, horizon])
  const projectionSeries = [
    { id: 'strategy', apyPercent },
    ...benchmarks.filter(benchmark => benchmark.id !== 'strategyBase').map(benchmark => ({ id: benchmark.id, apyPercent: benchmark.apyPercent })),
  ]
  const spanDays = horizon * 30

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 4, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />
        <XAxis dataKey="time" type="number" domain={[-spanDays, spanDays]} ticks={[-spanDays, 0, spanDays]} tickFormatter={value => value === 0 ? 'Now' : value < 0 ? `Past ${horizon === 1 ? '1M' : `${horizon}M`}` : horizon === 12 ? 'Potential 1Y' : `Potential ${horizon}M`} tick={{ fontSize: 10, fill: 'rgb(150,150,150)' }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={value => Number(value).toFixed(2)} tick={{ fontSize: 10, fill: 'rgb(150,150,150)' }} axisLine={false} tickLine={false} width={38} domain={['auto', 'auto']} />
        <ReferenceLine x={0} stroke="rgba(0,0,0,0.18)" strokeWidth={1} />
        <Tooltip content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null
          const future = Number(label) >= 0
          const values = Object.fromEntries(payload.map(point => [String(point.dataKey), Number(point.value)]))
          const rows = orderedComparisonTooltipRows(values)
          const days = Math.abs(Number(label))
          const timeLabel = days === 0 ? 'Now' : `${Math.round(days / 30)} month${days >= 45 ? 's' : ''} ${future ? 'ahead' : 'ago'}`
          return (
            <div className="chart-tooltip chart-tooltip--comparison">
              <div className="tooltip-time">{timeLabel}</div>
              <div className="tooltip-context">{future ? 'If today’s rates held · projected balance' : 'Historical APY compounded from your deposit'}</div>
              {rows.map(row => (
                <div key={row.id} className={`tooltip-comparison-row tooltip-comparison-row--${row.id}`}>
                  <span className="tooltip-series" style={{ '--series-color': row.color } as CSSProperties}>
                    <b>{!future && row.id === 'strategy' ? 'Strategy base · Beefy' : row.label}</b>
                    <small>{!future && row.id === 'strategy' ? 'Underlying pool APY · before leverage' : row.detail}</small>
                  </span>
                  <span className="tooltip-value"><strong>{row.value.toFixed(3)}</strong>{row.id !== 'weth' && <em>{row.deltaFromWeth >= 0 ? '+' : ''}{row.deltaFromWeth.toFixed(3)} vs hold</em>}</span>
                </div>
              ))}
            </div>
          )
        }} />
        <Line type="monotone" dataKey="weth" name="Hold WETH" stroke="#737373" strokeWidth={1.25} strokeDasharray="3 4" dot={false} isAnimationActive={false} />
        {projectionSeries.map(item => {
          const config = comparisonSeries.find(candidate => candidate.id === item.id)
          return config && <Line key={item.id} type="monotone" dataKey={item.id} name={config.label} stroke={config.color} strokeWidth={item.id === 'strategy' ? 2.4 : 1.6} strokeDasharray={config.dash} dot={false} isAnimationActive={item.id === 'strategy'} animationDuration={500} />
        })}
      </LineChart>
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
  headerVariant = 'editorial',
  topbarVariant = 'shelf',
}: TransactionCockpitProps) {
  const [horizon, setHorizon] = useState<Horizon>(6)
  const pageHeadingId = useId()
  const strategyPanelId = useId()
  const strategyTabListId = useId()
  const strategyTabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const isConnected = accountStatus === 'connected'
  const positionOpen = Boolean(manageUrl)
  const canUseOpportunity = opportunity.isExecutable !== false
  const parsedAmount = Number(amount)
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0

  const canExecute = isConnected && isProjectReady && canUseOpportunity && validAmount && !isBusy && !positionOpen && !routeWarning
  const canStart = isProjectReady && canUseOpportunity && validAmount && !isBusy && !positionOpen && !routeWarning

  const isDataLoading = opportunity.apyPercent === undefined
  const apyPercent = opportunity.apyPercent ?? 0
  const leverageMultiple = opportunity.leverageMultiple ?? 1
  const minimumDeposit = opportunity.minimumDeposit ?? 0
  const requestedChartBalance = validAmount ? parsedAmount : minimumDeposit || 1
  const chartStartingBalance = useDebouncedNumber(requestedChartBalance, 300)
  const { benchmarks, fetchedAt } = useEthereumYieldBenchmarks()
  const selectedOpportunityIndex = Math.max(opportunities.findIndex(item => item.id === opportunity.id), 0)
  const headerLabel = {
    desk: 'Strategy selection',
    journey: 'How your position works',
    ticket: 'Strategy ticket',
    editorial: 'Selected yield strategy',
  }[headerVariant]
  const topbarLabel = {
    identity: 'Product navigation',
    shelf: 'Strategy shelf',
    switchboard: 'Strategy switchboard',
    portfolio: 'Portfolio strategy selection',
  }[topbarVariant]
  const chartTitle = {
    desk: 'Projected balance',
    journey: 'Your projected outcome',
    ticket: 'Projected return',
    editorial: `${opportunity.tokenSymbol} amplified loop`,
  }[headerVariant]

  const annualYield = validAmount ? parsedAmount * (apyPercent / 100) : undefined
  const borrowedEstimate = validAmount ? Math.max(parsedAmount * (leverageMultiple - 1), 0) : undefined

const simulatedPositionValue = useSimulatedPositionValue(amount, apyPercent, positionOpen, activePositionStats)

  const actionLabel = isConnected
    ? isBusy ? 'Opening Smart account...' : `Earn ${apyPercent.toFixed(2)}%`
    : 'Start earning'

  const displayError = error ? formatTransactionError(error) : undefined

  const selectStrategyAt = (index: number) => {
    const nextOpportunity = opportunities[index]
    if (!nextOpportunity) return
    onSelectOpportunity?.(nextOpportunity)
    strategyTabRefs.current[index]?.focus()
  }

  const handleStrategyKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined

    if (event.key === 'ArrowRight') nextIndex = (index + 1) % opportunities.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + opportunities.length) % opportunities.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = opportunities.length - 1
    if (nextIndex === undefined) return

    event.preventDefault()
    selectStrategyAt(nextIndex)
  }

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

  // ── Cockpit ──────────────────────────────────────────────────────────────
  return (
    <div className="cockpit-wrap">
      <h1 className="sr-only" id={pageHeadingId}>Automated yield strategies</h1>

      <main aria-labelledby={pageHeadingId} className={`cockpit cockpit--variant-${headerVariant} cockpit--topbar-${topbarVariant}`}>
        <header aria-label={topbarVariant === 'identity' ? headerLabel : topbarLabel} className="cockpit-header">
          <div aria-label="0x.credit" className="brand-row">
            <span className="brand-mark" aria-hidden="true">0x</span>
          </div>

          <div className="header-context" aria-hidden="true">
            {topbarVariant === 'identity' && <span>Yield strategies</span>}
            {topbarVariant === 'shelf' && <span>Choose a strategy</span>}
            {topbarVariant === 'switchboard' && <span>Automated ETH yield</span>}
            {topbarVariant === 'portfolio' && <span>Portfolio allocation</span>}
          </div>

          <div className="header-right-cluster">
            <div role="tablist" aria-label="Strategy" aria-orientation="horizontal" className="strategy-tabs">
              {opportunities.map((opp, index) => (
                <button
                  aria-controls={strategyPanelId}
                  aria-selected={opp.id === opportunity.id}
                  id={`${strategyTabListId}-tab-${index}`}
                  key={opp.id}
                  role="tab"
                  className={`strategy-tab ${chainTone(opp.chainName)} ${opp.id === opportunity.id ? 'active' : ''}`}
                  onClick={() => onSelectOpportunity?.(opp)}
                  onKeyDown={event => handleStrategyKeyDown(event, index)}
                  ref={element => {
                    strategyTabRefs.current[index] = element
                  }}
                  tabIndex={opp.id === opportunity.id ? 0 : -1}
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

              <a href="?view=advisor" className="strategy-tab strategy-tab--advisor">
                Robo-Advisor
                <span className="advisor-nav-tag">Early access</span>
              </a>
            </div>
          </div>

        </header>

        {/* Two-pane body */}
        <div
          aria-labelledby={`${strategyTabListId}-tab-${selectedOpportunityIndex}`}
          className="cockpit-body"
          id={strategyPanelId}
          role="tabpanel"
        >
          {/* Left: projection chart + APY breakdown */}
          <section className="cockpit-chart-pane" aria-label="Projected earnings">
            <div className="chart-header">
              <div>
                <span className="chart-title">{chartTitle} <span className="chart-title-unit">{headerVariant === 'editorial' ? 'estimated' : opportunity.tokenSymbol}</span></span>
                {isDataLoading
                  ? <span className="chart-apy-badge chart-apy-badge--loading" aria-hidden="true" />
                  : apyPercent > 0 && <span className="chart-apy-badge">{apyPercent.toFixed(1)}% APY</span>
                }
              </div>
              <div className="horizon-toggle" role="radiogroup" aria-label="Comparison period">
                {([
                  [1, '1M', '1 month'],
                  [6, '6M', '6 months'],
                  [12, '1Y', '1 year'],
                ] as const).map(([months, label, accessibleLabel]) => (
                  <button
                    key={months}
                    aria-checked={horizon === months}
                    aria-label={accessibleLabel}
                    role="radio"
                    type="button"
                    className={`horizon-btn ${horizon === months ? 'active' : ''}`}
                    onClick={() => setHorizon(months)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {headerVariant === 'journey' ? (
              <div aria-label="Strategy route" className="route-journey">
                <span><small>Deposit</small>{opportunity.tokenSymbol}</span>
                <i aria-hidden="true">→</i>
                <span><small>Credit account</small>Gearbox</span>
                <i aria-hidden="true">→</i>
                <span><small>Outcome</small>Amplified position</span>
              </div>
            ) : opportunity.routeSteps?.length ? (
              <div aria-label="Strategy route" className="route-summary">
                <span className="route-summary-label">Route</span>
                <span>You deposit: {opportunity.tokenSymbol}</span>
                {opportunity.routeSteps.map(step => (
                  <span key={`${step.role}-${step.provider}`}>{step.role}: {step.provider}</span>
                ))}
              </div>
            ) : null}

            <div className="chart-grow chart-comparison" aria-label="Historical benchmark rates and future yield projection">
              {isDataLoading
                ? <ChartSkeleton />
                : <YieldComparisonChart startingBalance={chartStartingBalance} apyPercent={apyPercent} benchmarks={benchmarks} horizon={horizon} />
              }
            </div>

            {!isDataLoading && (
              <div className="chart-footer">
                <span className="cf-item">
                  <span className="cf-swatch cf-swatch--amp" />
                  Net strategy <strong>{apyPercent.toFixed(1)}%</strong>
                </span>
                <span className="cf-item"><span className="cf-swatch cf-swatch--weth" />Hold WETH <strong>0.0%</strong></span>
                {benchmarks.filter(benchmark => benchmark.id !== 'strategyBase').map(benchmark => {
                  const style = comparisonSeries.find(item => item.id === benchmark.id)
                  return <span className="cf-item" key={benchmark.id}><span className={`cf-swatch cf-swatch--${benchmark.id}`} />{style?.label} <strong>{benchmark.apyPercent.toFixed(1)}%</strong></span>
                })}
                <span className="cf-source">
                  {fetchedAt ? `DefiLlama benchmarks · fetched ${fetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'DefiLlama benchmarks loading…'}
                </span>
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
                    <li>KPK lends you about <strong>{formatCompact(borrowedEstimate, opportunity.tokenSymbol)}</strong> to amplify your position.</li>
                  )}
                  <li>Your earnings rate and auto-protection threshold may adjust as market conditions change.</li>
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
                </div>
              )}
              {actionButton}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
