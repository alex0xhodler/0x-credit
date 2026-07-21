import { useMemo, useState } from 'react'
import './AdvisorDashboard.css'
import {
  HERO_COLLATERAL,
  HERO_DEBTS,
  HERO_NOW,
  HERO_SIGNALS,
  HERO_TARGET_WEIGHTS,
  HERO_UNDERLYINGS,
} from './lib/advisor/fixtures/heroScenario'
import { assessPosition, type Proposal } from './lib/advisor/agent/engine'
import { applyRefinance, rotateExposure, underlyingRawValueUsd } from './lib/advisor/agent/rebalance'
import { computeHealthFactor } from './lib/advisor/domain/healthFactor'
import { STABLECOIN_CONFIG } from './lib/advisor/domain/stablecoin'
import type { StablecoinIssuerBacking } from './lib/advisor/domain/correlation'
import type { CollateralPosition, DebtPosition } from './lib/advisor/types'

const MARKET = { equityMarketOpen: true, now: HERO_NOW }

const REFLEXIVE_BACKINGS: StablecoinIssuerBacking[] = [
  { stablecoin: 'USDe', issuer: 'Securitize', reserveShare: 0.2 },
]

const usd = (value: number) =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const pct = (value: number) => `${(value * 100).toFixed(1)}%`

/**
 * Fixture-driven advisor screen: renders the hero scenario through the real
 * engine and makes the semi-automatic propose → edit → approve flow clickable.
 * No wallet or chain interaction — state lives in memory.
 */
export function AdvisorDashboard() {
  const [collateral, setCollateral] = useState<readonly CollateralPosition[]>(HERO_COLLATERAL)
  const [debts, setDebts] = useState<readonly DebtPosition[]>(HERO_DEBTS)
  const [reflexiveMode, setReflexiveMode] = useState(false)
  const [handledIds, setHandledIds] = useState<ReadonlySet<string>>(new Set())
  const [editedWeights, setEditedWeights] = useState<Record<string, number>>({})

  // Reflexive demo: AAPL exposure re-issued by Securitize while USDe reserves
  // hold Securitize credit — the closed-loop structure the engine must flag.
  const effectiveCollateral = useMemo(
    () =>
      reflexiveMode
        ? collateral.map(p =>
            p.token.underlyingId === 'EQUITY:AAPL'
              ? { ...p, token: { ...p.token, issuer: 'Securitize' } }
              : p,
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
        targetWeights: HERO_TARGET_WEIGHTS,
        market: MARKET,
        signals: HERO_SIGNALS,
        stablecoinBackings: reflexiveMode ? REFLEXIVE_BACKINGS : undefined,
      }),
    [effectiveCollateral, debts, reflexiveMode],
  )

  const visibleProposals = assessment.proposals.filter(p => !handledIds.has(p.id))
  const rawTotal = effectiveCollateral.reduce((acc, p) => acc + p.quantity * p.priceUsd, 0)

  const markHandled = (id: string) => setHandledIds(prev => new Set(prev).add(id))

  const previewWeightEdit = (proposal: Proposal, weight: number) => {
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
  }

  const hfDisplay = Number.isFinite(assessment.healthFactor) ? assessment.healthFactor.toFixed(2) : '∞'

  return (
    <div className="advisor">
      <header className="advisor-header">
        <div>
          <span className="advisor-brand">0x.credit</span>
          <span className="advisor-title">Robo-Advisor</span>
        </div>
        <div className="advisor-header-right">
          <span className="advisor-mode-chip">Semi-Automatic</span>
          <button
            className={`advisor-toggle${reflexiveMode ? ' is-on' : ''}`}
            onClick={() => setReflexiveMode(v => !v)}
          >
            Simulate Securitize↔USDe loop
          </button>
        </div>
      </header>

      <main className="advisor-grid">
        <section className="advisor-panel" data-testid="hf-gauge">
          <h2 className="advisor-panel-title">Health Factor</h2>
          <div className={`advisor-hf advisor-hf--${assessment.status}`}>
            <span className="advisor-hf-value" data-testid="hf-value">{hfDisplay}</span>
            <span className="advisor-hf-status">{assessment.status}</span>
          </div>
          <dl className="advisor-kv">
            <div>
              <dt>Intervention threshold</dt>
              <dd>{assessment.effectiveInterventionHf.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Liquidation</dt>
              <dd>1.00</dd>
            </div>
          </dl>
        </section>

        <section className="advisor-panel" data-testid="basket-panel">
          <h2 className="advisor-panel-title">Basket · {usd(rawTotal)}</h2>
          <table className="advisor-table">
            <thead>
              <tr>
                <th>Underlying</th>
                <th>Weight</th>
                <th>Target</th>
                <th>Drift</th>
              </tr>
            </thead>
            <tbody>
              {assessment.drift.map(row => (
                <tr key={row.underlyingId}>
                  <td>{HERO_UNDERLYINGS[row.underlyingId]?.symbol ?? row.underlyingId}</td>
                  <td>{pct(row.current)}</td>
                  <td>{pct(row.target)}</td>
                  <td className={row.breached ? 'is-breached' : ''}>
                    {row.drift >= 0 ? '+' : ''}
                    {pct(row.drift)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="advisor-panel" data-testid="borrow-panel">
          <h2 className="advisor-panel-title">Borrow</h2>
          <table className="advisor-table">
            <thead>
              <tr>
                <th>Stablecoin</th>
                <th>Outstanding</th>
                <th>Risk tier</th>
              </tr>
            </thead>
            <tbody>
              {debts
                .filter(d => d.amount > 0)
                .map(d => (
                  <tr key={d.stablecoin}>
                    <td>{d.stablecoin}</td>
                    <td>{usd(d.amount * d.priceUsd)}</td>
                    <td>Tier {STABLECOIN_CONFIG[d.stablecoin].riskTier}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>

        <section className="advisor-panel" data-testid="signals-panel">
          <h2 className="advisor-panel-title">Active Signals</h2>
          {HERO_SIGNALS.map(s => (
            <div key={s.feedId} className="advisor-signal">
              <span className={`advisor-signal-dot advisor-signal-dot--${s.direction}`} />
              <div>
                <p className="advisor-signal-label">{s.sourceLabel}</p>
                <p className="advisor-signal-meta">
                  {HERO_UNDERLYINGS[s.asset]?.symbol ?? s.asset} · {s.signalType} · value {s.value.toFixed(2)} ·
                  confidence {s.confidence.toFixed(2)}
                </p>
              </div>
            </div>
          ))}
        </section>

        {assessment.reflexiveWarnings.length > 0 && (
          <section className="advisor-panel advisor-panel--alert" data-testid="reflexive-panel">
            <h2 className="advisor-panel-title">Wrong-Way Risk</h2>
            {assessment.reflexiveWarnings.map(w => (
              <p key={w.issuer} className="advisor-warning-text">
                <strong>{w.issuer}</strong>
                {w.reflexive
                  ? ` issues ${usd(w.collateralUsd)} of your collateral and backs ${usd(w.stablecoinBackingUsd)} of your borrowed stablecoin — a single issuer event hits both sides.`
                  : ` accounts for ${pct(w.footprintShare)} of your book — above the single-issuer cap.`}
              </p>
            ))}
          </section>
        )}

        <section className="advisor-panel advisor-panel--wide" data-testid="proposals-panel">
          <h2 className="advisor-panel-title">Agent Proposals</h2>
          {visibleProposals.length === 0 && <p className="advisor-empty">No pending proposals.</p>}
          {visibleProposals.map(proposal => {
            const isWeightEdit = proposal.kind === 'reduce_weight'
            const symbol = proposal.underlyingId
              ? HERO_UNDERLYINGS[proposal.underlyingId]?.symbol ?? proposal.underlyingId
              : proposal.params.fromStablecoin ?? ''
            const editedWeight = editedWeights[proposal.id] ?? proposal.params.toWeight ?? 0
            const preview = isWeightEdit ? previewWeightEdit(proposal, editedWeight) : undefined
            const projectedHf = preview?.healthFactor ?? proposal.projectedHf

            return (
              <article key={proposal.id} className="advisor-proposal" data-testid={`proposal-${proposal.id}`}>
                <div className="advisor-proposal-head">
                  <span className={`advisor-urgency advisor-urgency--${proposal.urgency}`}>{proposal.urgency}</span>
                  <span className="advisor-proposal-kind">{proposal.kind.replace(/_/g, ' ')}</span>
                </div>
                <p className="advisor-proposal-rationale">{proposal.rationale}</p>
                {proposal.contributingSignals.length > 0 && (
                  <p className="advisor-proposal-signals">
                    Signals:{' '}
                    {proposal.contributingSignals
                      .map(id => HERO_SIGNALS.find(s => s.feedId === id)?.sourceLabel ?? id)
                      .join(', ')}
                  </p>
                )}
                {isWeightEdit && (
                  <label className="advisor-edit">
                    Target {symbol} weight
                    <div className="advisor-edit-row">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(editedWeight * 100)}
                        onChange={e =>
                          setEditedWeights(prev => ({
                            ...prev,
                            [proposal.id]: Number(e.target.value) / 100,
                          }))
                        }
                      />
                      <span>%</span>
                    </div>
                  </label>
                )}
                <div className="advisor-proposal-foot">
                  <span className="advisor-projection">
                    Projected HF{' '}
                    <strong data-testid="projected-hf">{projectedHf.toFixed(3)}</strong>{' '}
                    <span
                      className={
                        projectedHf >= assessment.healthFactor ? 'advisor-delta-up' : 'advisor-delta-down'
                      }
                    >
                      ({projectedHf >= assessment.healthFactor ? '+' : ''}
                      {(projectedHf - assessment.healthFactor).toFixed(3)})
                    </span>
                  </span>
                  <div className="advisor-proposal-actions">
                    <button className="advisor-btn advisor-btn--ghost" onClick={() => markHandled(proposal.id)}>
                      Dismiss
                    </button>
                    <button className="advisor-btn" onClick={() => approveProposal(proposal)}>
                      Approve
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      </main>
    </div>
  )
}
