import { useMemo, useState, type ReactNode } from 'react'
import { assessPosition, type Assessment, type Proposal } from '../lib/advisor/agent/engine'
import { applyRefinance, rotateExposure, underlyingRawValueUsd } from '../lib/advisor/agent/rebalance'
import { computeHealthFactor, type HealthFactorResult } from '../lib/advisor/domain/healthFactor'
import { STABLECOIN_CONFIG } from '../lib/advisor/domain/stablecoin'
import type { StablecoinIssuerBacking } from '../lib/advisor/domain/correlation'
import {
  HERO_BORROW_APR,
  HERO_NOW,
  HERO_SIGNALS,
  HERO_UNDERLYINGS,
  HERO_USDE_PRICE,
} from '../lib/advisor/fixtures/heroScenario'
import { buildCollateralFromIntent, buildDebtsFromIntent, maxBorrowUsd, type IntentConfig } from '../lib/advisor/onboarding/intent'
import type { CollateralPosition, DebtPosition, UnderlyingId } from '../lib/advisor/types'

const MARKET = { equityMarketOpen: true, now: HERO_NOW }

const UNDERLYING_ORDER: UnderlyingId[] = ['EQUITY:NVDA', 'EQUITY:SPY', 'EQUITY:AAPL', 'EQUITY:SPACEX']

const SERIES_COLOR: Record<UnderlyingId, string> = {
  'EQUITY:NVDA': '#7DA2FF',
  'EQUITY:SPY': '#34D399',
  'EQUITY:AAPL': '#FBBF24',
  'EQUITY:SPACEX': '#C084FC',
}

const MODE_LABEL: Record<IntentConfig['mode'], string> = {
  manual: 'Manual',
  semi: 'Semi-automatic',
  auto: 'Automatic',
}

const PERMISSION_LABEL: Record<string, string> = {
  autoTopUp: 'Auto top-up from reserve',
  partialRepay: 'Partial debt repayment',
  collateralSwap: 'Collateral swaps',
  providerSwap: 'Provider swaps',
  rebalance: 'Basket rebalancing',
}

const HF_METER_MIN = 0.8
const HF_METER_MAX = 2.5

/** AAPL re-issued by Securitize while USDe reserves hold Securitize credit — the closed loop the engine must flag. */
const REFLEXIVE_BACKINGS: StablecoinIssuerBacking[] = [{ stablecoin: 'USDe', issuer: 'Securitize', reserveShare: 0.2 }]

/** Formats a USD amount with commas and no decimals, e.g. `$12,500,000`. */
function formatUsd(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

/** Formats a fraction as a percentage with one decimal, e.g. `12.3%`. */
function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

/**
 * Verb-first disclosure title per proposal kind, per the dashboard spec.
 * `showProviderSymbol` disambiguates grouped provider_diversify rows, which
 * otherwise all read identically; the standalone case keeps the plain title.
 */
function proposalTitle(proposal: Proposal, showProviderSymbol = false): string {
  if (proposal.kind === 'reduce_weight') {
    const symbol = proposal.underlyingId ? HERO_UNDERLYINGS[proposal.underlyingId]?.symbol ?? proposal.underlyingId : ''
    return `Reduce ${symbol} exposure`
  }
  if (proposal.kind === 'provider_diversify') {
    const base = 'Diversify provider concentration'
    if (!showProviderSymbol) return base
    const symbol = proposal.underlyingId ? HERO_UNDERLYINGS[proposal.underlyingId]?.symbol ?? proposal.underlyingId : ''
    return symbol ? `${base} · ${symbol}` : base
  }
  if (proposal.kind === 'refinance_stablecoin') return `Refinance ${proposal.params.fromStablecoin ?? ''} borrow`
  return proposal.kind
}

function hfColor(status: Assessment['status']): 'good' | 'warn' | 'bad' {
  if (status === 'healthy') return 'good'
  if (status === 'warning') return 'warn'
  return 'bad'
}

/** Thumb-only reprise of the wizard's HF meter, scaled to a 4px strip. */
function MiniHfMeter({ hf }: { hf: number }) {
  const finite = Number.isFinite(hf)
  const clamped = finite ? Math.min(HF_METER_MAX, Math.max(HF_METER_MIN, hf)) : HF_METER_MAX
  const thumbPct = ((clamped - HF_METER_MIN) / (HF_METER_MAX - HF_METER_MIN)) * 100
  return (
    <span className="advisor-mini-meter" aria-hidden="true">
      <span className="advisor-mini-meter-thumb" style={{ left: `${thumbPct}%` }} />
    </span>
  )
}

interface ProposalCardProps {
  proposal: Proposal
  currentHf: number
  open: boolean
  onToggle: () => void
  editedWeight: number
  onEditWeight: (value: number) => void
  projectedHf: number
  onApprove: () => void
  onDismiss: () => void
  nested?: boolean
  showProviderSymbol?: boolean
}

/**
 * A single agent proposal rendered as a disclosure: the header button carries
 * the urgency pill and verb-first title and toggles the body, whose content
 * (rationale, signal chips, editable weight, projection, actions) is
 * conditionally rendered rather than hidden — closed bodies leave the DOM.
 */
function ProposalCard({
  proposal,
  currentHf,
  open,
  onToggle,
  editedWeight,
  onEditWeight,
  projectedHf,
  onApprove,
  onDismiss,
  nested,
  showProviderSymbol,
}: ProposalCardProps) {
  const bodyId = `proposal-body-${proposal.id}`
  const delta = projectedHf - currentHf
  const isUp = delta >= 0

  return (
    <article
      data-testid={`proposal-${proposal.id}`}
      className={`advisor-proposal-card advisor-proposal-card--${proposal.urgency}${nested ? ' is-nested' : ''}`}
    >
      <button type="button" className="advisor-proposal-toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className={`advisor-urgency-pill advisor-urgency-pill--${proposal.urgency}`}>{proposal.urgency}</span>
        <span className="advisor-proposal-title">{proposalTitle(proposal, showProviderSymbol)}</span>
        <span className={`advisor-chevron${open ? ' is-open' : ''}`} aria-hidden="true">
          ⌄
        </span>
      </button>
      {open && (
        <div id={bodyId} className="advisor-proposal-body">
          <p className="advisor-proposal-rationale">{proposal.rationale}</p>
          {proposal.contributingSignals.length > 0 && (
            <div className="advisor-signal-chips">
              {proposal.contributingSignals.map(feedId => (
                <span key={feedId} className="advisor-signal-chip">
                  {HERO_SIGNALS.find(s => s.feedId === feedId)?.sourceLabel ?? feedId}
                </span>
              ))}
            </div>
          )}
          {proposal.kind === 'reduce_weight' && proposal.underlyingId && (
            <label className="advisor-weight-edit">
              Target {HERO_UNDERLYINGS[proposal.underlyingId].symbol} weight
              <div className="advisor-weight-edit-row">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(editedWeight * 100)}
                  onChange={e => onEditWeight(Number(e.target.value) / 100)}
                />
                <span>%</span>
              </div>
            </label>
          )}
          <div className="advisor-proposal-footer">
            <span className="advisor-proposal-projection">
              Projected HF <strong data-testid="projected-hf">{projectedHf.toFixed(3)}</strong>{' '}
              <span className={isUp ? 'advisor-delta-up' : 'advisor-delta-down'}>
                ({isUp ? '+' : ''}
                {delta.toFixed(3)})
              </span>
            </span>
            <div className="advisor-proposal-actions">
              <button type="button" className="advisor-btn advisor-btn--ghost" onClick={onDismiss}>
                Dismiss
              </button>
              <button type="button" className="advisor-btn" onClick={onApprove}>
                Approve
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  )
}

export interface DashboardProps {
  /** Confirmed onboarding intent; the dashboard builds its starting position from it. */
  intent: IntentConfig
  onReconfigure: () => void
  /** Fires with the cumulative count of approved proposals, for the A8 reconfigure notice. */
  onAppliedChangesChange?: (count: number) => void
}

/**
 * The post-activation advisor dashboard: header status + controls, a
 * reflexive-risk banner, portfolio/borrow/capacity/health metrics, the agent
 * proposal feed (disclosure cards, editable weights, approve/dismiss), and a
 * right rail (basket, borrow, signals, mandate). State lives in memory,
 * seeded from the confirmed onboarding intent.
 */
export function Dashboard({ intent, onReconfigure, onAppliedChangesChange }: DashboardProps) {
  const [collateral, setCollateral] = useState<readonly CollateralPosition[]>(() =>
    buildCollateralFromIntent(intent.weights, intent.totalCollateralUsd),
  )
  const [debts, setDebts] = useState<readonly DebtPosition[]>(() => buildDebtsFromIntent(intent.borrows))
  const [reflexiveMode, setReflexiveMode] = useState(false)
  const [handledIds, setHandledIds] = useState<ReadonlySet<string>>(new Set())
  const [editedWeights, setEditedWeights] = useState<Record<string, number>>({})
  const [appliedCount, setAppliedCount] = useState(0)
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => {
    const initialAssessment = assessPosition({
      collateral: buildCollateralFromIntent(intent.weights, intent.totalCollateralUsd),
      debts: buildDebtsFromIntent(intent.borrows),
      underlyings: HERO_UNDERLYINGS,
      targetWeights: intent.weights,
      market: MARKET,
      signals: HERO_SIGNALS,
      interventionHf: intent.interventionHf,
    })
    const firstId = initialAssessment.proposals[0]?.id
    return firstId ? new Set([firstId]) : new Set()
  })

  const effectiveCollateral = useMemo(
    () =>
      reflexiveMode
        ? collateral.map(p =>
            p.token.underlyingId === 'EQUITY:AAPL' ? { ...p, token: { ...p.token, issuer: 'Securitize' } } : p,
          )
        : collateral,
    [collateral, reflexiveMode],
  )

  const assessment = useMemo(
    () =>
      assessPosition({
        collateral: effectiveCollateral,
        debts,
        underlyings: HERO_UNDERLYINGS,
        targetWeights: intent.weights,
        market: MARKET,
        signals: HERO_SIGNALS,
        interventionHf: intent.interventionHf,
        stablecoinBackings: reflexiveMode ? REFLEXIVE_BACKINGS : undefined,
      }),
    [effectiveCollateral, debts, reflexiveMode, intent.weights, intent.interventionHf],
  )

  const visibleProposals = assessment.proposals.filter(p => !handledIds.has(p.id))
  const rawTotal = effectiveCollateral.reduce((acc, p) => acc + p.quantity * p.priceUsd, 0)

  const underlyingCount = new Set(effectiveCollateral.filter(p => p.quantity > 0).map(p => p.token.underlyingId)).size
  const providerCount = new Set(effectiveCollateral.filter(p => p.quantity > 0).map(p => p.token.issuer)).size

  const totalBorrowed = debts.reduce((acc, d) => acc + d.amount * d.priceUsd, 0)
  const blendedApr =
    totalBorrowed === 0 ? 0 : debts.reduce((acc, d) => acc + d.amount * d.priceUsd * HERO_BORROW_APR[d.stablecoin], 0) / totalBorrowed

  const capacity = useMemo(() => maxBorrowUsd(effectiveCollateral, HERO_UNDERLYINGS, MARKET), [effectiveCollateral])
  const capacityPct = capacity === 0 ? 0 : (totalBorrowed / capacity) * 100
  const capacityColor = capacityPct > 90 ? 'bad' : capacityPct > 70 ? 'warn' : 'good'

  const hfDisplay = Number.isFinite(assessment.healthFactor) ? assessment.healthFactor.toFixed(2) : '∞'
  const hfColorClass = hfColor(assessment.status)

  const markHandled = (id: string) =>
    setHandledIds(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })

  const toggleOpen = (id: string) =>
    setOpenIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /** Re-runs the domain HF on a hypothetical rotation for the given edited weight. */
  const previewWeightEdit = (proposal: Proposal, weight: number): HealthFactorResult | undefined => {
    if (proposal.underlyingId === undefined || proposal.params.intoUnderlyingId === undefined) return undefined
    const currentWeight = underlyingRawValueUsd(effectiveCollateral, proposal.underlyingId) / rawTotal
    const valueUsd = Math.max(0, (currentWeight - weight) * rawTotal)
    const mutated = rotateExposure(effectiveCollateral, proposal.underlyingId, proposal.params.intoUnderlyingId, valueUsd)
    return computeHealthFactor({ collateral: mutated, debts, underlyings: HERO_UNDERLYINGS, market: MARKET })
  }

  const approveProposal = (proposal: Proposal) => {
    if (proposal.kind === 'refinance_stablecoin') {
      if (proposal.params.fromStablecoin && proposal.params.toStablecoin) {
        setDebts(applyRefinance(debts, proposal.params.fromStablecoin, proposal.params.toStablecoin))
      }
    } else if (proposal.underlyingId !== undefined && proposal.params.intoUnderlyingId !== undefined) {
      const weight = editedWeights[proposal.id] ?? proposal.params.toWeight ?? 0
      const currentWeight = underlyingRawValueUsd(effectiveCollateral, proposal.underlyingId) / rawTotal
      const valueUsd = Math.max(0, (currentWeight - weight) * rawTotal)
      setCollateral(rotateExposure(collateral, proposal.underlyingId, proposal.params.intoUnderlyingId, valueUsd))
    }
    markHandled(proposal.id)
    const nextCount = appliedCount + 1
    setAppliedCount(nextCount)
    onAppliedChangesChange?.(nextCount)
  }

  const dismissProposal = (proposal: Proposal) => markHandled(proposal.id)

  const renderCard = (proposal: Proposal, nested: boolean, showProviderSymbol = false) => {
    const editedWeight = editedWeights[proposal.id] ?? proposal.params.toWeight ?? 0
    const preview = proposal.kind === 'reduce_weight' ? previewWeightEdit(proposal, editedWeight) : undefined
    const projectedHf = preview?.healthFactor ?? proposal.projectedHf
    return (
      <ProposalCard
        key={proposal.id}
        proposal={proposal}
        currentHf={assessment.healthFactor}
        open={openIds.has(proposal.id)}
        onToggle={() => toggleOpen(proposal.id)}
        editedWeight={editedWeight}
        onEditWeight={value => setEditedWeights(prev => ({ ...prev, [proposal.id]: value }))}
        projectedHf={projectedHf}
        onApprove={() => approveProposal(proposal)}
        onDismiss={() => dismissProposal(proposal)}
        nested={nested}
        showProviderSymbol={showProviderSymbol}
      />
    )
  }

  const renderProposals = (list: Proposal[]): ReactNode[] => {
    const nodes: ReactNode[] = []
    let i = 0
    while (i < list.length) {
      const proposal = list[i]
      if (proposal.kind === 'provider_diversify') {
        const group: Proposal[] = []
        while (i < list.length && list[i].kind === 'provider_diversify') {
          group.push(list[i])
          i++
        }
        const showProviderSymbol = group.length > 1
        nodes.push(
          <div key={`group-${group[0].id}`} className="advisor-proposal-group">
            <span className="advisor-overline">Provider concentration</span>
            {group.map(p => renderCard(p, true, showProviderSymbol))}
          </div>,
        )
      } else {
        nodes.push(renderCard(proposal, false))
        i++
      }
    }
    return nodes
  }

  const enabledPermissions = Object.entries(intent.permissions)
    .filter(([, enabled]) => enabled)
    .map(([key]) => PERMISSION_LABEL[key] ?? key)
    .slice(0, 5)

  return (
    <div className="advisor-dashboard">
      <header className="advisor-dash-header">
        <div className="advisor-brand-row">
          <span className="advisor-brand">0x.credit</span>
          <span className="advisor-brand-sub">Robo-Advisor</span>
        </div>
        <div className="advisor-dash-header-right">
          <span className="advisor-status-pill">
            <span className="advisor-status-dot" aria-hidden="true" />
            Agent active · {MODE_LABEL[intent.mode]}
          </span>
          <button type="button" className="advisor-btn advisor-btn--ghost" onClick={onReconfigure}>
            Reconfigure
          </button>
          <button
            type="button"
            className={`advisor-dash-toggle${reflexiveMode ? ' is-on' : ''}`}
            aria-pressed={reflexiveMode}
            onClick={() => setReflexiveMode(v => !v)}
          >
            Simulate Securitize↔USDe loop
          </button>
        </div>
      </header>

      {assessment.reflexiveWarnings.length > 0 && (
        <section className="advisor-reflexive-banner" data-testid="reflexive-panel">
          {assessment.reflexiveWarnings.map(w => (
            <p key={w.issuer} className="advisor-reflexive-line">
              <strong>{w.issuer}</strong>
              {w.reflexive
                ? ` issues ${formatUsd(w.collateralUsd)} of your collateral and backs ${formatUsd(w.stablecoinBackingUsd)} of your borrowed stablecoin — a single issuer event hits both sides.`
                : ` accounts for ${formatPct(w.footprintShare)} of your book — above the single-issuer cap.`}
            </p>
          ))}
        </section>
      )}

      <section className="advisor-metrics-row">
        <div className="advisor-stat-tile">
          <span className="advisor-overline">Portfolio value</span>
          <span className="advisor-stat-value">{formatUsd(rawTotal)}</span>
          <span className="advisor-stat-subline">
            {underlyingCount} underlyings across {providerCount} providers
          </span>
        </div>
        <div className="advisor-stat-tile">
          <span className="advisor-overline">Total borrowed</span>
          <span className="advisor-stat-value">{formatUsd(totalBorrowed)}</span>
          <span className="advisor-stat-subline">Blended {(blendedApr * 100).toFixed(1)}% APR</span>
        </div>
        <div className="advisor-stat-tile">
          <span className="advisor-overline">Borrow capacity</span>
          <span className="advisor-stat-value">{capacityPct.toFixed(0)}%</span>
          <span className="advisor-stat-subline">
            {formatUsd(totalBorrowed)} of {formatUsd(capacity)} origination limit
          </span>
          <span className="advisor-progress-strip">
            <span
              className={`advisor-progress-fill advisor-progress-fill--${capacityColor}`}
              style={{ width: `${Math.min(100, capacityPct)}%` }}
            />
          </span>
        </div>
        <div className="advisor-stat-tile" data-testid="hf-gauge">
          <span className="advisor-overline">Health factor</span>
          <span className={`advisor-stat-value advisor-stat-value--${hfColorClass}`} data-testid="hf-value">
            {hfDisplay}
          </span>
          <span className={`advisor-stat-subline advisor-stat-subline--${hfColorClass}`}>{assessment.status}</span>
          <MiniHfMeter hf={assessment.healthFactor} />
        </div>
      </section>

      <div className="advisor-main-grid">
        <section className="advisor-feed-panel" data-testid="proposals-panel">
          <div className="advisor-feed-head">
            <span className="advisor-overline">Agent proposals</span>
            <span className="advisor-count-pill">{visibleProposals.length}</span>
          </div>
          {visibleProposals.length === 0 ? (
            <p className="advisor-feed-empty">No pending proposals. Your agent checks continuously.</p>
          ) : (
            renderProposals(visibleProposals)
          )}
        </section>

        <aside className="advisor-rail">
          <section className="advisor-rail-panel" data-testid="basket-panel">
            <div className="advisor-rail-panel-head">
              <span className="advisor-overline">Basket</span>
              <span className="advisor-rail-panel-value">{formatUsd(rawTotal)}</span>
            </div>
            {UNDERLYING_ORDER.map(id => {
              const drift = assessment.drift.find(d => d.underlyingId === id)
              const current = drift?.current ?? 0
              const target = drift?.target ?? 0
              const driftPct = (drift?.drift ?? 0) * 100
              const breached = drift?.breached ?? false
              return (
                <div key={id} className="advisor-basket-row">
                  <span className="advisor-asset-dot" style={{ background: SERIES_COLOR[id] }} />
                  <span className="advisor-basket-symbol">{HERO_UNDERLYINGS[id].symbol}</span>
                  <span className="advisor-basket-bar">
                    <span
                      className="advisor-basket-bar-fill"
                      style={{ width: `${current * 100}%`, background: SERIES_COLOR[id] }}
                    />
                    <span className="advisor-basket-bar-tick" style={{ left: `${target * 100}%` }} />
                  </span>
                  <span className="advisor-basket-current">{(current * 100).toFixed(0)}%</span>
                  <span className={`advisor-basket-drift${breached ? ' is-breached' : ''}`}>
                    {driftPct >= 0 ? '+' : ''}
                    {driftPct.toFixed(1)}%
                  </span>
                </div>
              )
            })}
          </section>

          <section className="advisor-rail-panel" data-testid="borrow-panel">
            <span className="advisor-overline">Borrow</span>
            {debts
              .filter(d => d.amount > 0)
              .map(d => (
                <div key={d.stablecoin} className="advisor-borrow-row">
                  <span className="advisor-borrow-coin">{d.stablecoin}</span>
                  <span className="advisor-borrow-amount">{formatUsd(d.amount * d.priceUsd)}</span>
                  <span className={`advisor-tier-dot advisor-tier-dot--${STABLECOIN_CONFIG[d.stablecoin].riskTier}`} />
                  <span className="advisor-borrow-tier">Tier {STABLECOIN_CONFIG[d.stablecoin].riskTier}</span>
                  <span className="advisor-borrow-apr">{(HERO_BORROW_APR[d.stablecoin] * 100).toFixed(1)}% APR</span>
                  {d.stablecoin === 'USDe' && <span className="advisor-peg-badge">Peg ${HERO_USDE_PRICE.toFixed(3)}</span>}
                </div>
              ))}
          </section>

          <section className="advisor-rail-panel" data-testid="signals-panel">
            <span className="advisor-overline">Signals</span>
            {HERO_SIGNALS.map(s => (
              <div key={s.feedId} className="advisor-signal-row">
                <span className={`advisor-signal-dot advisor-signal-dot--${s.direction}`} />
                <div>
                  <p className="advisor-signal-label">{s.sourceLabel}</p>
                  <p className="advisor-signal-meta">
                    {HERO_UNDERLYINGS[s.asset]?.symbol ?? s.asset} · {s.signalType} · value {s.value.toFixed(2)} · confidence{' '}
                    {s.confidence.toFixed(2)}
                  </p>
                </div>
              </div>
            ))}
          </section>

          <section className="advisor-rail-panel">
            <span className="advisor-overline">Mandate</span>
            <p className="advisor-mandate-mode">{MODE_LABEL[intent.mode]}</p>
            <p className="advisor-mandate-threshold">Intervention below {intent.interventionHf.toFixed(2)}</p>
            <div className="advisor-mandate-pills">
              {enabledPermissions.map(label => (
                <span key={label} className="advisor-mandate-pill">
                  {label}
                </span>
              ))}
            </div>
            <button type="button" className="advisor-link-button" onClick={onReconfigure}>
              Reconfigure →
            </button>
          </section>
        </aside>
      </div>
    </div>
  )
}
