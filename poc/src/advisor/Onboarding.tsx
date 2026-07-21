import { useMemo, useState } from 'react'
import {
  buildCollateralFromDeposits,
  buildDebtsFromIntent,
  DEFAULT_INTENT,
  derivedTargetWeights,
  maxBorrowUsd,
  maxUsdcBorrowUsd,
  maxUsdeFaceUsd,
  maxUsdtFaceUsd,
  projectIntentHf,
  PROVIDER_SPLITS,
  RISK_PRESETS,
  totalDepositsUsd,
  usdcForTargetHf,
  validateIntent,
  type IntentBorrow,
  type IntentConfig,
  type IntentValidationError,
} from '../lib/advisor/onboarding/intent'
import { assessPosition, type Assessment } from '../lib/advisor/agent/engine'
import { hfStatus } from '../lib/advisor/domain/healthFactor'
import { ltvParamsFor } from '../lib/advisor/domain/ltv'
import {
  HERO_BORROW_APR,
  HERO_NOW,
  HERO_SIGNALS,
  HERO_USDE_PRICE,
} from '../lib/advisor/fixtures/heroScenario'
import { CATALOG_UNDERLYINGS } from '../lib/advisor/catalog/realTokens'
import type { ProviderRiskScore, Stablecoin, Underlying, UnderlyingId } from '../lib/advisor/types'

const MARKET = { equityMarketOpen: true, now: HERO_NOW }

const UNDERLYING_ORDER: UnderlyingId[] = ['EQUITY:NVDA', 'EQUITY:SPY', 'EQUITY:AAPL', 'EQUITY:SPACEX']

/** Tokenized-treasury catalog rows, rendered below the stock catalog on screen 1. */
const RWA_ORDER: UnderlyingId[] = ['RWA:MTBILL', 'RWA:BUIDL', 'RWA:MBASIS']

/** The full onboarding catalog — stocks first, then treasuries — used for state keyed by underlying. */
const CATALOG_ORDER: UnderlyingId[] = [...UNDERLYING_ORDER, ...RWA_ORDER]

const TIER_CHIP_LABEL: Record<Underlying['tier'], string> = {
  blue_chip: 'Blue chip',
  index_etf: 'Index / ETF',
  small_mid_cap: 'Small / mid cap',
  private_equity: 'Private · manual approval only',
  treasury: 'Treasury',
}

const STEP_LABELS = ['Position', 'Mandate', 'Review']

const DEPOSIT_PRESETS = [1_000_000, 2_500_000, 5_000_000]

const MODE_COPY: Record<IntentConfig['mode'], { title: string; description: string }> = {
  manual: { title: 'Manual', description: 'Agent advises. You approve every action.' },
  semi: { title: 'Semi-automatic', description: 'Agent proposes and pre-stages transactions. You edit and approve.' },
  auto: { title: 'Automatic', description: 'Agent executes within your caps. Private equity always requires approval.' },
}

const PERMISSION_ROWS: { key: string; label: string; description: string }[] = [
  {
    key: 'autoTopUp',
    label: 'Auto top-up from reserve',
    description: 'Adds reserve collateral automatically to defend your health factor.',
  },
  {
    key: 'partialRepay',
    label: 'Partial debt repayment',
    description: 'Lets the agent repay a portion of debt to restore health.',
  },
  {
    key: 'collateralSwap',
    label: 'Collateral swaps',
    description: 'Lets the agent rotate exposure between your held assets.',
  },
  {
    key: 'providerSwap',
    label: 'Provider swaps',
    description: 'Lets the agent move a position between token providers.',
  },
  {
    key: 'rebalance',
    label: 'Basket rebalancing',
    description: 'Lets the agent restore target weights when drift exceeds the band.',
  },
]

/** Formats a USD amount with commas and no decimals, e.g. `$12,500,000`. */
function formatUsd(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

/** Formats a round-million USD amount compactly for preset pills, e.g. `$2.5M`. */
function formatCompactUsd(value: number): string {
  const millions = value / 1_000_000
  const rounded = Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)
  return `$${rounded}M`
}

/** Strips non-digit characters from a raw input string and parses the remainder as a whole-dollar amount. */
function parseUsdInput(raw: string): number {
  const digits = raw.replace(/[^0-9]/g, '')
  return digits ? Number(digits) : 0
}

/** The highest provider risk score among an underlying's issued tokens, used for its catalog "Max LTV" figure. */
function bestProviderScore(id: UnderlyingId): ProviderRiskScore {
  const splits = PROVIDER_SPLITS[id] ?? []
  let best: ProviderRiskScore = 1
  for (const split of splits) {
    if (split.token.providerRiskScore > best) best = split.token.providerRiskScore
  }
  return best
}

interface StockMeta {
  maxLtvPct: number
  providerCount: number
}

const STOCK_META: Record<UnderlyingId, StockMeta> = Object.fromEntries(
  CATALOG_ORDER.map(id => {
    const underlying = CATALOG_UNDERLYINGS[id]
    const splits = PROVIDER_SPLITS[id] ?? []
    const { maxLtv } = ltvParamsFor(underlying.tier, bestProviderScore(id))
    return [id, { maxLtvPct: Math.round(maxLtv * 100), providerCount: splits.length }]
  }),
)

interface DepositRowState {
  selected: boolean
  amountUsd: number
  input: string
}

function initialDepositState(config?: IntentConfig): Record<UnderlyingId, DepositRowState> {
  const out = {} as Record<UnderlyingId, DepositRowState>
  for (const id of CATALOG_ORDER) {
    const amount = config?.deposits[id] ?? 0
    out[id] = { selected: amount > 0, amountUsd: amount, input: amount > 0 ? formatUsd(amount) : '' }
  }
  return out
}

function borrowAmount(config: IntentConfig | undefined, coin: Stablecoin): number {
  return config?.borrows.find(b => b.stablecoin === coin)?.amountUsd ?? 0
}

/** Execution-steps strip — numbered 1 → 2 → ✓ with connector lines, shown on all three screens. */
function ExecSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="advisor-exec-steps" aria-label="Execution steps">
      {STEP_LABELS.map((label, index) => {
        const stepNumber = index + 1
        const state: 'done' | 'active' | 'upcoming' =
          stepNumber < current ? 'done' : stepNumber === current ? 'active' : 'upcoming'
        return (
          <div className="advisor-exec-node-wrap" key={label}>
            {index > 0 && <span className={`advisor-exec-connector${stepNumber <= current ? ' is-done' : ''}`} aria-hidden="true" />}
            <div className={`advisor-exec-node advisor-exec-node--${state}`}>
              <span className="advisor-exec-node-circle">{state === 'done' ? '✓' : stepNumber}</span>
              <span className="advisor-exec-node-label">{label}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface StockRowProps {
  id: UnderlyingId
  state: DepositRowState
  onToggle: (selected: boolean) => void
  onAmountChange: (raw: string) => void
  onAmountBlur: () => void
  onPreset: (amount: number) => void
}

function StockRow({ id, state, onToggle, onAmountChange, onAmountBlur, onPreset }: StockRowProps) {
  const underlying = CATALOG_UNDERLYINGS[id]
  const meta = STOCK_META[id]
  return (
    <div className={`advisor-stock-row${state.selected ? ' is-selected' : ''}`}>
      <label className="advisor-stock-row-main">
        <input
          type="checkbox"
          className="advisor-visually-hidden"
          checked={state.selected}
          aria-label={`Select ${underlying.symbol}`}
          onChange={e => onToggle(e.target.checked)}
        />
        <span className="advisor-stock-check" aria-hidden="true" />
        <span className="advisor-stock-id">
          <strong>{underlying.symbol}</strong>
          <span className="advisor-stock-name">{underlying.name}</span>
        </span>
        <span className="advisor-tier-chip">{TIER_CHIP_LABEL[underlying.tier]}</span>
        <span className="advisor-stock-meta">Max LTV {meta.maxLtvPct}%</span>
        <span className="advisor-stock-meta">
          {meta.providerCount} provider{meta.providerCount === 1 ? '' : 's'}
        </span>
      </label>
      {state.selected && (
        <div className="advisor-deposit-block">
          <label className="advisor-deposit-field">
            <span className="advisor-deposit-label" aria-hidden="true">
              Deposit amount
            </span>
            <input
              className="advisor-deposit-input"
              inputMode="numeric"
              aria-label={`${underlying.symbol} deposit amount`}
              placeholder="$0"
              value={state.input}
              onChange={e => onAmountChange(e.target.value)}
              onBlur={onAmountBlur}
            />
          </label>
          <div className="advisor-deposit-presets">
            {DEPOSIT_PRESETS.map(amount => (
              <button key={amount} type="button" className="advisor-deposit-preset" onClick={() => onPreset(amount)}>
                {formatCompactUsd(amount)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface Screen1Props {
  deposits: Record<UnderlyingId, DepositRowState>
  onToggleStock: (id: UnderlyingId, selected: boolean) => void
  onDepositChange: (id: UnderlyingId, raw: string) => void
  onDepositBlur: (id: UnderlyingId) => void
  onDepositPreset: (id: UnderlyingId, amount: number) => void
  selectedIds: UnderlyingId[]
  totalDeposits: number
  usdcInput: string
  onUsdcChange: (raw: string) => void
  onUsdcBlur: () => void
  presetAmounts: { id: string; label: string; amount: number }[]
  onApplyUsdcPreset: (amount: number) => void
  usdtEnabled: boolean
  onToggleUsdt: (enabled: boolean) => void
  usdtInput: string
  onUsdtChange: (raw: string) => void
  onUsdtBlur: () => void
  usdtMax: number
  usdeEnabled: boolean
  onToggleUsde: (enabled: boolean) => void
  usdeInput: string
  onUsdeChange: (raw: string) => void
  onUsdeBlur: () => void
  usdeMax: number
  projectedHf: number
  capacity: number
  totalBorrowUsd: number
  errors: IntentValidationError[]
  canContinue: boolean
  reason?: string
  onContinue: () => void
  onSkipDemo: () => void
  appliedChangesNotice: number
}

function Screen1({
  deposits,
  onToggleStock,
  onDepositChange,
  onDepositBlur,
  onDepositPreset,
  selectedIds,
  totalDeposits,
  usdcInput,
  onUsdcChange,
  onUsdcBlur,
  presetAmounts,
  onApplyUsdcPreset,
  usdtEnabled,
  onToggleUsdt,
  usdtInput,
  onUsdtChange,
  onUsdtBlur,
  usdtMax,
  usdeEnabled,
  onToggleUsde,
  usdeInput,
  onUsdeChange,
  onUsdeBlur,
  usdeMax,
  projectedHf,
  capacity,
  totalBorrowUsd,
  errors,
  canContinue,
  reason,
  onContinue,
  onSkipDemo,
  appliedChangesNotice,
}: Screen1Props) {
  const status = hfStatus(Number.isFinite(projectedHf) ? projectedHf : Infinity)
  const zoneBad = status !== 'healthy'
  const zoneNote =
    status === 'healthy'
      ? "Healthy — above your agent's intervention threshold"
      : status === 'warning'
        ? 'Inside the intervention zone'
        : 'Below liquidation'

  return (
    <>
      <section className="advisor-pane-content">
        <h2>Build your position</h2>
        <p className="advisor-explainer">
          Agentic stock lending — deposit tokenized stocks, borrow stablecoins against them, and let your agent
          manage the risk.
        </p>

        {appliedChangesNotice > 0 && (
          <p className="advisor-notice" data-testid="reconfigure-notice">
            Your agent has applied {appliedChangesNotice} approved changes since activation; reconfiguring restarts
            from your last confirmed mandate.
          </p>
        )}

        <div className="advisor-catalog-section">
          <div className="advisor-catalog-section-head">
            <h3 className="advisor-overline">Tokenized stocks</h3>
            <span className="advisor-catalog-badge advisor-catalog-badge--illustrative">
              Illustrative — pending issuer integrations
            </span>
          </div>
          <div className="advisor-catalog">
            {UNDERLYING_ORDER.map(id => (
              <StockRow
                key={id}
                id={id}
                state={deposits[id]}
                onToggle={selected => onToggleStock(id, selected)}
                onAmountChange={raw => onDepositChange(id, raw)}
                onAmountBlur={() => onDepositBlur(id)}
                onPreset={amount => onDepositPreset(id, amount)}
              />
            ))}
          </div>
        </div>

        <div className="advisor-catalog-section">
          <div className="advisor-catalog-section-head">
            <h3 className="advisor-overline">Tokenized treasuries</h3>
            <span className="advisor-catalog-badge advisor-catalog-badge--live">Live on Gearbox · via SDK adapters</span>
          </div>
          <div className="advisor-catalog">
            {RWA_ORDER.map(id => (
              <StockRow
                key={id}
                id={id}
                state={deposits[id]}
                onToggle={selected => onToggleStock(id, selected)}
                onAmountChange={raw => onDepositChange(id, raw)}
                onAmountBlur={() => onDepositBlur(id)}
                onPreset={amount => onDepositPreset(id, amount)}
              />
            ))}
          </div>
        </div>

        <p className="advisor-route-strip">
          You deposit: {selectedIds.length > 0 ? selectedIds.map(id => CATALOG_UNDERLYINGS[id].symbol).join(', ') : '—'} ·
          Agent: 0x.credit routing · Protocol: Gearbox
        </p>

        <p className="advisor-skip-link">
          <button type="button" data-testid="skip-demo" className="advisor-link-button" onClick={onSkipDemo}>
            Skip — load demo portfolio →
          </button>
        </p>
      </section>

      <aside className="advisor-pane-rail">
        <h3 className="advisor-overline">Your position</h3>
        <dl className="advisor-position-summary">
          <div className="advisor-position-line advisor-position-line--total">
            <dt>Collateral</dt>
            <dd>{formatUsd(totalDeposits)}</dd>
          </div>
          {selectedIds.map(id => (
            <div className="advisor-position-line" key={id}>
              <dt>{CATALOG_UNDERLYINGS[id].symbol}</dt>
              <dd>{formatUsd(deposits[id].amountUsd)}</dd>
            </div>
          ))}
        </dl>

        <h3 className="advisor-overline">Borrow</h3>
        <div className="advisor-borrow-anchor">
          <label className="advisor-deposit-field">
            <span className="advisor-deposit-label" aria-hidden="true">
              Borrow amount
            </span>
            <input
              className="advisor-deposit-input"
              inputMode="numeric"
              aria-label="USDC borrow amount"
              placeholder="$0"
              value={usdcInput}
              onChange={e => onUsdcChange(e.target.value)}
              onBlur={onUsdcBlur}
            />
          </label>
          <div className="advisor-risk-presets">
            {presetAmounts.map(preset => (
              <button
                key={preset.id}
                type="button"
                className="advisor-preset-pill"
                disabled={preset.amount <= 0}
                onClick={() => onApplyUsdcPreset(preset.amount)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <label className="advisor-borrow-toggle-row">
          <input
            type="checkbox"
            className="advisor-visually-hidden"
            checked={usdtEnabled}
            onChange={e => onToggleUsdt(e.target.checked)}
          />
          <span className="advisor-borrow-toggle-mark" aria-hidden="true" />
          <span>+ USDT</span>
        </label>
        {usdtEnabled && (
          <div className="advisor-borrow-extra">
            <label className="advisor-deposit-field">
              <span className="advisor-deposit-label" aria-hidden="true">
                Borrow amount
              </span>
              <input
                className="advisor-deposit-input"
                inputMode="numeric"
                aria-label="USDT borrow amount"
                placeholder="$0"
                value={usdtInput}
                onChange={e => onUsdtChange(e.target.value)}
                onBlur={onUsdtBlur}
              />
            </label>
            <p className="advisor-max-hint">up to {formatUsd(Math.max(0, usdtMax))}</p>
          </div>
        )}

        <label className="advisor-borrow-toggle-row">
          <input
            type="checkbox"
            className="advisor-visually-hidden"
            checked={usdeEnabled}
            onChange={e => onToggleUsde(e.target.checked)}
          />
          <span className="advisor-borrow-toggle-mark" aria-hidden="true" />
          <span>+ USDe</span>
          <span className="advisor-peg-badge">Peg ${HERO_USDE_PRICE.toFixed(3)}</span>
        </label>
        {usdeEnabled && (
          <div className="advisor-borrow-extra">
            <label className="advisor-deposit-field">
              <span className="advisor-deposit-label" aria-hidden="true">
                Borrow amount
              </span>
              <input
                className="advisor-deposit-input"
                inputMode="numeric"
                aria-label="USDe borrow amount"
                placeholder="$0"
                value={usdeInput}
                onChange={e => onUsdeChange(e.target.value)}
                onBlur={onUsdeBlur}
              />
            </label>
            <p className="advisor-max-hint">up to {formatUsd(Math.max(0, usdeMax))}</p>
          </div>
        )}

        <div className="advisor-risk-readout">
          <span className="advisor-overline">Projected health factor</span>
          <div className="advisor-hf-readout-value" data-testid="screen1-hf-value">
            {Number.isFinite(projectedHf) ? projectedHf.toFixed(2) : '∞'}
          </div>
          <p className={`advisor-zone-note${zoneBad ? ' is-bad' : ''}`}>{zoneNote}</p>
          <p className="advisor-capacity-line">
            Borrowing {formatUsd(totalBorrowUsd)} of {formatUsd(capacity)} origination limit
          </p>
          {errors.length > 0 && (
            <ul className="advisor-error-list">
              {errors.map(error => (
                <li key={error.code}>{error.message}</li>
              ))}
            </ul>
          )}
        </div>

        <ExecSteps current={1} />

        <button type="button" className="advisor-cta" disabled={!canContinue} onClick={onContinue}>
          Continue to mandate
        </button>
        {!canContinue && reason && <p className="advisor-cta-reason">{reason}</p>}
      </aside>
    </>
  )
}

interface Screen2Props {
  mode: IntentConfig['mode']
  onModeChange: (mode: IntentConfig['mode']) => void
  permissions: Record<string, boolean>
  onPermissionChange: (key: string, value: boolean) => void
  interventionHf: number
  onInterventionChange: (value: number) => void
  totalDeposits: number
  totalBorrowUsd: number
  projectedHf: number
  onBack: () => void
  onContinue: () => void
}

function Screen2({
  mode,
  onModeChange,
  permissions,
  onPermissionChange,
  interventionHf,
  onInterventionChange,
  totalDeposits,
  totalBorrowUsd,
  projectedHf,
  onBack,
  onContinue,
}: Screen2Props) {
  return (
    <>
      <section className="advisor-pane-content">
        <h2>Grant your mandate</h2>
        <p className="advisor-explainer">
          Choose how much autonomy your agent has. You can change this anytime; changes take a 10-minute timelock.
        </p>

        <div className="advisor-mode-cards">
          {(['manual', 'semi', 'auto'] as const).map(m => (
            <label key={m} className={`advisor-mode-card${mode === m ? ' is-selected' : ''}`} data-testid={`mode-${m}`}>
              <input
                type="radio"
                className="advisor-visually-hidden"
                name="advisor-mandate-mode"
                checked={mode === m}
                onChange={() => onModeChange(m)}
              />
              <span className="advisor-mode-title">
                {MODE_COPY[m].title}
                {m === 'semi' && <span className="advisor-recommended-pill">Recommended</span>}
              </span>
              <span className="advisor-mode-desc">{MODE_COPY[m].description}</span>
            </label>
          ))}
        </div>

        <p className="advisor-overline">Permissions</p>
        <div className="advisor-permission-rows">
          {PERMISSION_ROWS.map(row => (
            <label key={row.key} className="advisor-permission-row">
              <input
                type="checkbox"
                className="advisor-visually-hidden"
                checked={Boolean(permissions[row.key])}
                onChange={e => onPermissionChange(row.key, e.target.checked)}
              />
              <span className="advisor-switch" aria-hidden="true" />
              <span>
                <span className="advisor-permission-label">{row.label}</span>
                <span className="advisor-permission-desc">{row.description}</span>
              </span>
            </label>
          ))}
        </div>

        <label className="advisor-field">
          <span className="advisor-overline">Intervention threshold</span>
          <input
            type="range"
            min={1.05}
            max={1.5}
            step={0.01}
            value={interventionHf}
            onChange={e => onInterventionChange(Number(e.target.value))}
          />
          <span className="advisor-intervention-value">{interventionHf.toFixed(2)}</span>
        </label>
        <p className="advisor-hint">Your agent begins acting when projected health drops below this.</p>
      </section>

      <aside className="advisor-pane-rail">
        <h3 className="advisor-overline">Your position</h3>
        <dl className="advisor-position-summary">
          <div className="advisor-position-line advisor-position-line--total">
            <dt>Collateral</dt>
            <dd>{formatUsd(totalDeposits)}</dd>
          </div>
          <div className="advisor-position-line">
            <dt>Borrow</dt>
            <dd>{formatUsd(totalBorrowUsd)}</dd>
          </div>
          <div className="advisor-position-line">
            <dt>Projected HF</dt>
            <dd>{Number.isFinite(projectedHf) ? projectedHf.toFixed(2) : '∞'}</dd>
          </div>
        </dl>

        <ExecSteps current={2} />

        <button type="button" className="advisor-btn advisor-btn--ghost advisor-back-btn" onClick={onBack}>
          Back
        </button>
        <button type="button" className="advisor-cta" onClick={onContinue}>
          Continue to review
        </button>
      </aside>
    </>
  )
}

interface Screen3Props {
  selectedIds: UnderlyingId[]
  deposits: Record<UnderlyingId, DepositRowState>
  borrows: IntentBorrow[]
  mode: IntentConfig['mode']
  permissions: Record<string, boolean>
  interventionHf: number
  projectedHf: number
  capacity: number
  totalBorrowUsd: number
  assessment: Assessment
  onBack: () => void
  onActivate: () => void
}

function Screen3({
  selectedIds,
  deposits,
  borrows,
  mode,
  permissions,
  interventionHf,
  projectedHf,
  capacity,
  totalBorrowUsd,
  assessment,
  onBack,
  onActivate,
}: Screen3Props) {
  const blendedApr =
    totalBorrowUsd === 0
      ? 0
      : borrows.reduce((acc, b) => acc + b.amountUsd * HERO_BORROW_APR[b.stablecoin], 0) / totalBorrowUsd
  const enabledPermissions = Object.values(permissions).filter(Boolean).length
  const headroom = Math.max(0, capacity - totalBorrowUsd)
  const topProposal = assessment.proposals[0]

  return (
    <>
      <section className="advisor-pane-content">
        <h2>Review &amp; activate</h2>

        <div className="advisor-review-list">
          <div className="advisor-review-group">
            <p className="advisor-overline">Deposits</p>
            {selectedIds.map(id => (
              <div className="advisor-review-row" key={id}>
                <dt>{CATALOG_UNDERLYINGS[id].symbol}</dt>
                <dd>{formatUsd(deposits[id].amountUsd)}</dd>
              </div>
            ))}
          </div>
          <div className="advisor-review-group">
            <p className="advisor-overline">Borrow</p>
            {borrows.map(b => (
              <div className="advisor-review-row" key={b.stablecoin}>
                <dt>{b.stablecoin}</dt>
                <dd>
                  {formatUsd(b.amountUsd)} · {(HERO_BORROW_APR[b.stablecoin] * 100).toFixed(1)}% APR
                </dd>
              </div>
            ))}
            <div className="advisor-review-row">
              <dt>Blended APR</dt>
              <dd>{totalBorrowUsd === 0 ? '—' : `${(blendedApr * 100).toFixed(1)}%`}</dd>
            </div>
          </div>
          <div className="advisor-review-group">
            <p className="advisor-overline">Risk</p>
            <div className="advisor-review-row">
              <dt>Projected HF</dt>
              <dd>{Number.isFinite(projectedHf) ? projectedHf.toFixed(2) : '∞'}</dd>
            </div>
            <div className="advisor-review-row">
              <dt>Headroom to origination limit</dt>
              <dd>{formatUsd(headroom)}</dd>
            </div>
          </div>
          <div className="advisor-review-group">
            <p className="advisor-overline">Mandate</p>
            <div className="advisor-review-row">
              <dt>Mode</dt>
              <dd>{MODE_COPY[mode].title}</dd>
            </div>
            <div className="advisor-review-row">
              <dt>Permissions</dt>
              <dd>{enabledPermissions} enabled</dd>
            </div>
            <div className="advisor-review-row">
              <dt>Threshold</dt>
              <dd>{interventionHf.toFixed(2)}</dd>
            </div>
          </div>
        </div>

        <div className="advisor-agent-preview" data-testid="agent-preview">
          <p className="advisor-overline">Your agent is already watching</p>
          {topProposal ? (
            <>
              <div className="advisor-preview-card">
                <span className="advisor-pulse-dot" aria-hidden="true" />
                <p className="advisor-preview-rationale">{topProposal.rationale}</p>
                {topProposal.contributingSignals.length > 0 && (
                  <p className="advisor-preview-signals">
                    {topProposal.contributingSignals
                      .map(id => HERO_SIGNALS.find(s => s.feedId === id)?.sourceLabel ?? id)
                      .join(', ')}
                  </p>
                )}
                {Number.isFinite(topProposal.projectedHfDelta) && (
                  <span className={`advisor-hf-delta-pill${topProposal.projectedHfDelta >= 0 ? ' is-up' : ' is-down'}`}>
                    {topProposal.projectedHfDelta >= 0 ? '+' : ''}
                    {topProposal.projectedHfDelta.toFixed(3)} HF
                  </span>
                )}
              </div>
              <p className="advisor-preview-caption">
                This proposal will be waiting for you after activation. Nothing executes without your approval.
              </p>
            </>
          ) : (
            <p className="advisor-preview-empty">No risks detected right now — your agent monitors continuously.</p>
          )}

          <p className="advisor-overline">What your agent watches</p>
          <ul className="advisor-watch-list">
            <li>External signals · {HERO_SIGNALS.map(s => s.sourceLabel).join(', ')}</li>
            <li>Health factor · intervenes below {interventionHf.toFixed(2)}</li>
            <li>Basket drift · rebalance beyond ±5%</li>
          </ul>
        </div>
      </section>

      <aside className="advisor-pane-rail">
        <ExecSteps current={3} />
        <button type="button" className="advisor-btn advisor-btn--ghost advisor-back-btn" onClick={onBack}>
          Back
        </button>
        <button type="button" className="advisor-cta" data-testid="activate-agent" onClick={onActivate}>
          Activate agent
        </button>
      </aside>
    </>
  )
}

export interface OnboardingProps {
  /** Prefills the wizard, e.g. from Reconfigure with the last confirmed intent. */
  initialConfig?: IntentConfig
  /** Count of approved agent actions since activation; renders the A8 restart notice when > 0. */
  appliedChangesNotice?: number
  onActivate: (config: IntentConfig) => void
  onSkipDemo: () => void
}

/**
 * The agent onboarding wizard: a three-screen flow (Build your position →
 * Mandate → Review & activate) that builds and validates an
 * {@link IntentConfig} live against the domain engine, in the 0x.credit
 * cockpit design language. Screen 1 merges stock selection, deposits, and
 * borrow into one screen with a live health-factor readout; screen 3 carries
 * the pre-activation agent preview as the second aha moment.
 */
export function Onboarding({ initialConfig, appliedChangesNotice = 0, onActivate, onSkipDemo }: OnboardingProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1)

  const [deposits, setDeposits] = useState<Record<UnderlyingId, DepositRowState>>(() =>
    initialDepositState(initialConfig),
  )

  const [usdcAmount, setUsdcAmount] = useState(() => borrowAmount(initialConfig, 'USDC'))
  const [usdcInput, setUsdcInput] = useState(() => {
    const amount = borrowAmount(initialConfig, 'USDC')
    return amount > 0 ? formatUsd(amount) : ''
  })

  const [usdtEnabled, setUsdtEnabled] = useState(() => borrowAmount(initialConfig, 'USDT') > 0)
  const [usdtAmount, setUsdtAmount] = useState(() => borrowAmount(initialConfig, 'USDT'))
  const [usdtInput, setUsdtInput] = useState(() => {
    const amount = borrowAmount(initialConfig, 'USDT')
    return amount > 0 ? formatUsd(amount) : ''
  })

  const [usdeEnabled, setUsdeEnabled] = useState(() => borrowAmount(initialConfig, 'USDe') > 0)
  const [usdeAmount, setUsdeAmount] = useState(() => borrowAmount(initialConfig, 'USDe'))
  const [usdeInput, setUsdeInput] = useState(() => {
    const amount = borrowAmount(initialConfig, 'USDe')
    return amount > 0 ? formatUsd(amount) : ''
  })

  const [mode, setMode] = useState<IntentConfig['mode']>(initialConfig?.mode ?? DEFAULT_INTENT.mode)
  const [permissions, setPermissions] = useState<Record<string, boolean>>(
    initialConfig?.permissions ?? DEFAULT_INTENT.permissions,
  )
  const [interventionHf, setInterventionHf] = useState(initialConfig?.interventionHf ?? DEFAULT_INTENT.interventionHf)

  const selectedIds = CATALOG_ORDER.filter(id => deposits[id].selected)

  const depositsRecord: Record<UnderlyingId, number> = useMemo(() => {
    const out = {} as Record<UnderlyingId, number>
    for (const id of CATALOG_ORDER) out[id] = deposits[id].selected ? deposits[id].amountUsd : 0
    return out
  }, [deposits])

  const totalDeposits = totalDepositsUsd(depositsRecord)

  const borrows: IntentBorrow[] = useMemo(() => {
    const list: IntentBorrow[] = [{ stablecoin: 'USDC', amountUsd: usdcAmount }]
    if (usdtEnabled) list.push({ stablecoin: 'USDT', amountUsd: usdtAmount })
    if (usdeEnabled) list.push({ stablecoin: 'USDe', amountUsd: usdeAmount })
    return list
  }, [usdcAmount, usdtEnabled, usdtAmount, usdeEnabled, usdeAmount])

  const otherBorrowsForUsdc = borrows.filter(b => b.stablecoin !== 'USDC')

  const config: IntentConfig = useMemo(
    () => ({ deposits: depositsRecord, borrows, mode, permissions, interventionHf }),
    [depositsRecord, borrows, mode, permissions, interventionHf],
  )

  const collateral = useMemo(() => buildCollateralFromDeposits(depositsRecord), [depositsRecord])
  const capacity = useMemo(() => maxBorrowUsd(collateral, CATALOG_UNDERLYINGS, MARKET), [collateral])
  const totalBorrowUsd = borrows.reduce((acc, b) => acc + b.amountUsd, 0)
  const projected = useMemo(() => projectIntentHf(depositsRecord, borrows), [depositsRecord, borrows])
  const validation = useMemo(() => validateIntent(config), [config])
  const targetWeights = useMemo(() => derivedTargetWeights(depositsRecord), [depositsRecord])

  const presetAmounts = useMemo(
    () =>
      RISK_PRESETS.map(preset => ({
        id: preset.id,
        label: preset.label,
        amount:
          preset.id === 'max'
            ? maxUsdcBorrowUsd(depositsRecord, otherBorrowsForUsdc)
            : usdcForTargetHf(depositsRecord, otherBorrowsForUsdc, preset.targetHf as number),
      })),
    [depositsRecord, otherBorrowsForUsdc],
  )

  const otherFaceForUsdt = usdcAmount + (usdeEnabled ? usdeAmount : 0)
  const otherFaceForUsde = usdcAmount + (usdtEnabled ? usdtAmount : 0)
  const usdtMax = maxUsdtFaceUsd(otherFaceForUsdt)
  const usdeMax = maxUsdeFaceUsd(otherFaceForUsde)

  const assessment: Assessment = useMemo(
    () =>
      assessPosition({
        collateral,
        debts: buildDebtsFromIntent(borrows),
        underlyings: CATALOG_UNDERLYINGS,
        targetWeights,
        market: MARKET,
        signals: HERO_SIGNALS,
        interventionHf,
      }),
    [collateral, borrows, targetWeights, interventionHf],
  )

  const toggleStock = (id: UnderlyingId, selected: boolean) =>
    setDeposits(prev => ({
      ...prev,
      [id]: selected ? { ...prev[id], selected } : { selected: false, amountUsd: 0, input: '' },
    }))

  const handleDepositChange = (id: UnderlyingId, raw: string) =>
    setDeposits(prev => ({ ...prev, [id]: { ...prev[id], input: raw, amountUsd: parseUsdInput(raw) } }))

  const handleDepositBlur = (id: UnderlyingId) =>
    setDeposits(prev => ({
      ...prev,
      [id]: { ...prev[id], input: prev[id].amountUsd > 0 ? formatUsd(prev[id].amountUsd) : '' },
    }))

  const applyDepositPreset = (id: UnderlyingId, amount: number) =>
    setDeposits(prev => ({ ...prev, [id]: { ...prev[id], amountUsd: amount, input: formatUsd(amount) } }))

  const handleUsdcChange = (raw: string) => {
    setUsdcInput(raw)
    setUsdcAmount(parseUsdInput(raw))
  }
  const handleUsdcBlur = () => setUsdcInput(usdcAmount > 0 ? formatUsd(usdcAmount) : '')
  const applyUsdcPreset = (amount: number) => {
    setUsdcAmount(amount)
    setUsdcInput(amount > 0 ? formatUsd(amount) : '')
  }

  const handleUsdtChange = (raw: string) => {
    setUsdtInput(raw)
    setUsdtAmount(parseUsdInput(raw))
  }
  const handleUsdtBlur = () => {
    const clamped = Math.max(0, Math.min(usdtAmount, usdtMax))
    setUsdtAmount(clamped)
    setUsdtInput(clamped > 0 ? formatUsd(clamped) : '')
  }

  const handleUsdeChange = (raw: string) => {
    setUsdeInput(raw)
    setUsdeAmount(parseUsdInput(raw))
  }
  const handleUsdeBlur = () => {
    const clamped = Math.max(0, Math.min(usdeAmount, usdeMax))
    setUsdeAmount(clamped)
    setUsdeInput(clamped > 0 ? formatUsd(clamped) : '')
  }

  const toggleUsdt = (enabled: boolean) => {
    setUsdtEnabled(enabled)
    if (!enabled) {
      setUsdtAmount(0)
      setUsdtInput('')
    }
  }
  const toggleUsde = (enabled: boolean) => {
    setUsdeEnabled(enabled)
    if (!enabled) {
      setUsdeAmount(0)
      setUsdeInput('')
    }
  }

  const setPermission = (key: string, value: boolean) => setPermissions(prev => ({ ...prev, [key]: value }))

  const canContinueStep1 = validation.ok
  const step1Reason = canContinueStep1 ? undefined : validation.errors[0]?.message

  const goBack = () => setStep(s => (s === 3 ? 2 : 1))
  const goToMandate = () => setStep(2)
  const goToReview = () => setStep(3)

  return (
    <div className="advisor-wizard">
      <div className="advisor-card">
        <header className="advisor-topbar">
          <span className="advisor-brand-mark" aria-hidden="true">
            0x
          </span>
          <span className="advisor-topbar-divider" aria-hidden="true" />
          <span className="advisor-topbar-label">Stock Credit</span>
        </header>

        <div className="advisor-body">
          {step === 1 && (
            <Screen1
              deposits={deposits}
              onToggleStock={toggleStock}
              onDepositChange={handleDepositChange}
              onDepositBlur={handleDepositBlur}
              onDepositPreset={applyDepositPreset}
              selectedIds={selectedIds}
              totalDeposits={totalDeposits}
              usdcInput={usdcInput}
              onUsdcChange={handleUsdcChange}
              onUsdcBlur={handleUsdcBlur}
              presetAmounts={presetAmounts}
              onApplyUsdcPreset={applyUsdcPreset}
              usdtEnabled={usdtEnabled}
              onToggleUsdt={toggleUsdt}
              usdtInput={usdtInput}
              onUsdtChange={handleUsdtChange}
              onUsdtBlur={handleUsdtBlur}
              usdtMax={usdtMax}
              usdeEnabled={usdeEnabled}
              onToggleUsde={toggleUsde}
              usdeInput={usdeInput}
              onUsdeChange={handleUsdeChange}
              onUsdeBlur={handleUsdeBlur}
              usdeMax={usdeMax}
              projectedHf={projected.healthFactor}
              capacity={capacity}
              totalBorrowUsd={totalBorrowUsd}
              errors={validation.errors}
              canContinue={canContinueStep1}
              reason={step1Reason}
              onContinue={goToMandate}
              onSkipDemo={onSkipDemo}
              appliedChangesNotice={appliedChangesNotice}
            />
          )}
          {step === 2 && (
            <Screen2
              mode={mode}
              onModeChange={setMode}
              permissions={permissions}
              onPermissionChange={setPermission}
              interventionHf={interventionHf}
              onInterventionChange={setInterventionHf}
              totalDeposits={totalDeposits}
              totalBorrowUsd={totalBorrowUsd}
              projectedHf={projected.healthFactor}
              onBack={goBack}
              onContinue={goToReview}
            />
          )}
          {step === 3 && (
            <Screen3
              selectedIds={selectedIds}
              deposits={deposits}
              borrows={borrows}
              mode={mode}
              permissions={permissions}
              interventionHf={interventionHf}
              projectedHf={projected.healthFactor}
              capacity={capacity}
              totalBorrowUsd={totalBorrowUsd}
              assessment={assessment}
              onBack={goBack}
              onActivate={() => onActivate(config)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
