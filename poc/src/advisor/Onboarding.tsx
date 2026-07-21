import { useMemo, useState } from 'react'
import {
  buildCollateralFromDeposits,
  buildDebtsFromIntent,
  DEFAULT_INTENT,
  derivedTargetWeights,
  maxBorrowUsd,
  projectIntentHf,
  totalDepositsUsd,
  validateIntent,
  type IntentBorrow,
  type IntentConfig,
  type IntentValidationError,
} from '../lib/advisor/onboarding/intent'
import { assessPosition, type Assessment } from '../lib/advisor/agent/engine'
import {
  HERO_BORROW_APR,
  HERO_NOW,
  HERO_SIGNALS,
  HERO_UNDERLYINGS,
  HERO_USDE_PRICE,
} from '../lib/advisor/fixtures/heroScenario'
import type { Stablecoin, Underlying, UnderlyingId } from '../lib/advisor/types'

const MARKET = { equityMarketOpen: true, now: HERO_NOW }

const UNDERLYING_ORDER: UnderlyingId[] = ['EQUITY:NVDA', 'EQUITY:SPY', 'EQUITY:AAPL', 'EQUITY:SPACEX']

const SERIES_COLOR: Record<UnderlyingId, string> = {
  'EQUITY:NVDA': '#7DA2FF',
  'EQUITY:SPY': '#34D399',
  'EQUITY:AAPL': '#FBBF24',
  'EQUITY:SPACEX': '#C084FC',
}

const TIER_LABEL: Record<Underlying['tier'], string> = {
  blue_chip: 'Blue chip',
  index_etf: 'Index',
  small_mid_cap: 'Small/mid cap',
  private_equity: 'Private',
}

const STABLECOIN_ORDER: Stablecoin[] = ['USDC', 'USDT', 'USDe']

const STABLECOIN_TIER_LABEL: Record<Stablecoin, string> = {
  USDC: 'Tier 1 · Fiat reserves',
  USDT: 'Tier 2 · Fiat reserves',
  USDe: 'Tier 3 · Synthetic',
}

const STABLECOIN_CAP_NOTE: Record<Stablecoin, string> = {
  USDC: 'No cap',
  USDT: 'Up to 60% of borrow',
  USDe: 'Up to 40% of borrow',
}

const STEP_LABELS = ['Portfolio', 'Borrow', 'Mandate', 'Review']

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

const HF_METER_MIN = 0.8
const HF_METER_MAX = 2.5

const HF_TICKS = [
  { value: 1.0, label: 'Liquidation 1.00' },
  { value: 1.2, label: 'Intervention 1.20' },
]

/** Maps an HF value to its percent position along the meter track. */
function hfTickPct(value: number): number {
  return ((value - HF_METER_MIN) / (HF_METER_MAX - HF_METER_MIN)) * 100
}

const FRESH_BORROW_DEFAULTS: Record<Stablecoin, number> = { USDC: 3_000_000, USDT: 1_200_000, USDe: 800_000 }

/** Formats a USD amount with commas and no decimals, e.g. `$12,500,000`. */
function formatUsd(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

/** Strips non-digit characters from a raw input string and parses the remainder as a whole-dollar amount. */
function parseUsdInput(raw: string): number {
  const digits = raw.replace(/[^0-9]/g, '')
  return digits ? Number(digits) : 0
}

/**
 * Recovers step-1's local percent-slider representation from a confirmed
 * intent's deposits (e.g. when Reconfigure prefills the wizard).
 */
function initialWeightPercents(config?: IntentConfig): Record<UnderlyingId, number> {
  const deposits = config?.deposits ?? DEFAULT_INTENT.deposits
  const total = totalDepositsUsd(deposits)
  const out: Record<UnderlyingId, number> = {}
  for (const id of UNDERLYING_ORDER) out[id] = total === 0 ? 0 : Math.round(((deposits[id] ?? 0) / total) * 100)
  return out
}

/** Converts step-1's local percent sliders into per-underlying deposit amounts against the entered collateral total. */
function depositsFromWeightPercents(
  weightPercents: Record<UnderlyingId, number>,
  totalUsd: number,
): Record<UnderlyingId, number> {
  const out: Record<UnderlyingId, number> = {}
  for (const id of UNDERLYING_ORDER) out[id] = ((weightPercents[id] ?? 0) / 100) * totalUsd
  return out
}

interface BorrowCardState {
  checked: boolean
  amountUsd: number
}

function initialBorrowState(config?: IntentConfig): Record<Stablecoin, BorrowCardState> {
  const borrows = config?.borrows ?? [{ stablecoin: 'USDC' as Stablecoin, amountUsd: 3_000_000 }]
  const byCoin = new Map(borrows.map(b => [b.stablecoin, b.amountUsd]))
  const out = {} as Record<Stablecoin, BorrowCardState>
  for (const coin of STABLECOIN_ORDER) {
    const amount = byCoin.get(coin)
    out[coin] = {
      checked: Boolean(amount && amount > 0),
      amountUsd: amount && amount > 0 ? amount : FRESH_BORROW_DEFAULTS[coin],
    }
  }
  return out
}

/**
 * Proportionally rescales weights to sum to 100, rounding each to an integer
 * and dumping any leftover rounding remainder onto the currently-largest weight.
 */
function normalizeWeights(weights: Record<UnderlyingId, number>): Record<UnderlyingId, number> {
  const total = UNDERLYING_ORDER.reduce((acc, id) => acc + (weights[id] ?? 0), 0)
  if (total === 0) return weights

  const rounded: Record<UnderlyingId, number> = {}
  for (const id of UNDERLYING_ORDER) rounded[id] = Math.round(((weights[id] ?? 0) / total) * 100)

  const sum = UNDERLYING_ORDER.reduce((acc, id) => acc + rounded[id], 0)
  const remainder = 100 - sum
  const largestId = UNDERLYING_ORDER.reduce((a, b) => (rounded[b] > rounded[a] ? b : a))
  rounded[largestId] += remainder
  return rounded
}

interface HfMeterProps {
  hf: number
  interventionHf: number
  compact?: boolean
}

function HfMeter({ hf, interventionHf, compact }: HfMeterProps) {
  const finite = Number.isFinite(hf)
  const clamped = finite ? Math.min(HF_METER_MAX, Math.max(HF_METER_MIN, hf)) : HF_METER_MAX
  const thumbPct = ((clamped - HF_METER_MIN) / (HF_METER_MAX - HF_METER_MIN)) * 100
  const colorClass = !finite || hf >= interventionHf ? 'is-good' : hf >= 1 ? 'is-warn' : 'is-bad'

  return (
    <div
      className={`advisor-hf-meter${compact ? ' is-compact' : ''}`}
      data-testid={compact ? 'hf-meter-reprise' : 'hf-meter'}
    >
      <div className={`advisor-hf-meter-value ${colorClass}`} data-testid="projected-hf-value">
        {finite ? hf.toFixed(2) : '∞'}
      </div>
      <div
        className="advisor-hf-meter-track"
        role="meter"
        aria-valuemin={HF_METER_MIN}
        aria-valuemax={HF_METER_MAX}
        aria-valuenow={finite ? hf : HF_METER_MAX}
        aria-label="Projected health factor"
      >
        <span className="advisor-hf-meter-thumb" style={{ left: `${thumbPct}%` }} />
        {!compact &&
          HF_TICKS.map(tick => (
            <span key={tick.value} className="advisor-hf-meter-tick" style={{ left: `${hfTickPct(tick.value)}%` }} />
          ))}
      </div>
      {!compact && (
        <div className="advisor-hf-meter-ticks">
          {HF_TICKS.map((tick, index) => (
            <span
              key={tick.value}
              className={`advisor-hf-meter-tick-label${index % 2 === 1 ? ' advisor-hf-meter-tick-label--row1' : ''}`}
              style={{ left: `${hfTickPct(tick.value)}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function StepRail({ current }: { current: number }) {
  return (
    <ol className="advisor-step-rail">
      {STEP_LABELS.map((label, index) => {
        const stepNumber = index + 1
        const state = stepNumber < current ? 'done' : stepNumber === current ? 'current' : 'future'
        return (
          <li key={label} className={`advisor-step-dot advisor-step-dot--${state}`}>
            <span className="advisor-step-dot-marker">{state === 'done' ? '✓' : stepNumber}</span>
            <span className="advisor-step-dot-label">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

interface WizardFooterProps {
  step: number
  canContinue: boolean
  reason?: string
  onBack: () => void
  onContinue: () => void
  continueLabel: string
  continueTestId?: string
}

function WizardFooter({ step, canContinue, reason, onBack, onContinue, continueLabel, continueTestId }: WizardFooterProps) {
  return (
    <div className="advisor-wizard-footer">
      {step > 1 ? (
        <button type="button" className="advisor-btn advisor-btn--ghost" onClick={onBack}>
          Back
        </button>
      ) : (
        <div className="advisor-wizard-footer-spacer" />
      )}
      <div className="advisor-wizard-footer-continue">
        {reason && <span className="advisor-wizard-reason">{reason}</span>}
        <button type="button" className="advisor-btn" disabled={!canContinue} data-testid={continueTestId} onClick={onContinue}>
          {continueLabel}
        </button>
      </div>
    </div>
  )
}

interface Step1Props {
  weightPercents: Record<UnderlyingId, number>
  weightTotal: number
  collateralInput: string
  onCollateralChange: (value: string) => void
  onCollateralBlur: () => void
  onWeightChange: (id: UnderlyingId, value: number) => void
  onNormalize: () => void
  onSkipDemo: () => void
  appliedChangesNotice: number
}

function Step1Portfolio({
  weightPercents,
  weightTotal,
  collateralInput,
  onCollateralChange,
  onCollateralBlur,
  onWeightChange,
  onNormalize,
  onSkipDemo,
  appliedChangesNotice,
}: Step1Props) {
  return (
    <>
      <h2>Define your portfolio</h2>
      <p className="advisor-explainer">Set target exposure by asset. Your agent selects providers and routes execution.</p>

      {appliedChangesNotice > 0 && (
        <p className="advisor-notice" data-testid="reconfigure-notice">
          Your agent has applied {appliedChangesNotice} approved changes since activation; reconfiguring restarts from
          your last confirmed mandate.
        </p>
      )}

      <label className="advisor-field">
        <span className="advisor-overline">Collateral to deposit</span>
        <input
          type="text"
          inputMode="numeric"
          value={collateralInput}
          onChange={e => onCollateralChange(e.target.value)}
          onBlur={onCollateralBlur}
        />
      </label>

      <div className="advisor-composition-bar">
        {UNDERLYING_ORDER.map(id => (
          <span
            key={id}
            className="advisor-composition-segment"
            style={{ width: `${weightPercents[id] ?? 0}%`, background: SERIES_COLOR[id] }}
          />
        ))}
      </div>

      <div className="advisor-asset-rows">
        {UNDERLYING_ORDER.map(id => {
          const underlying = HERO_UNDERLYINGS[id]
          return (
            <div className="advisor-asset-row" key={id}>
              <span className="advisor-asset-dot" style={{ background: SERIES_COLOR[id] }} />
              <span className="advisor-asset-name">
                <strong>{underlying.symbol}</strong> {underlying.name}
              </span>
              <span className="advisor-tier-chip">
                {TIER_LABEL[underlying.tier]}
                {underlying.tier === 'private_equity' && <span className="advisor-tier-badge">Manual approval only</span>}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={weightPercents[id] ?? 0}
                aria-label={`${underlying.symbol} weight slider`}
                onChange={e => onWeightChange(id, Number(e.target.value))}
              />
              <label className="advisor-weight-input">
                {underlying.symbol} target weight
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={weightPercents[id] ?? 0}
                  onChange={e => onWeightChange(id, Number(e.target.value))}
                />
              </label>
              <span>%</span>
            </div>
          )
        })}
      </div>

      <div className="advisor-total-row">
        <span className={weightTotal === 100 ? 'advisor-total-ok' : 'advisor-total-bad'}>Total: {weightTotal}%</span>
        {weightTotal !== 100 && (
          <button type="button" className="advisor-btn advisor-btn--ghost" onClick={onNormalize}>
            Normalize
          </button>
        )}
      </div>

      <p className="advisor-skip-link">
        <button type="button" data-testid="skip-demo" className="advisor-link-button" onClick={onSkipDemo}>
          Skip — load demo portfolio →
        </button>
      </p>
    </>
  )
}

interface Step2Props {
  hf: number
  interventionHf: number
  capacity: number
  totalBorrowUsd: number
  borrowState: Record<Stablecoin, BorrowCardState>
  amountInputs: Record<Stablecoin, string>
  onToggleCoin: (coin: Stablecoin, checked: boolean) => void
  onAmountChange: (coin: Stablecoin, raw: string) => void
  onAmountFocus: (coin: Stablecoin) => void
  onAmountBlur: (coin: Stablecoin) => void
  errors: IntentValidationError[]
}

function Step2Borrow({
  hf,
  interventionHf,
  capacity,
  totalBorrowUsd,
  borrowState,
  amountInputs,
  onToggleCoin,
  onAmountChange,
  onAmountFocus,
  onAmountBlur,
  errors,
}: Step2Props) {
  const capacityPct = capacity === 0 ? 0 : Math.min(100, (totalBorrowUsd / capacity) * 100)
  const capacityClass = capacityPct > 90 ? 'is-bad' : capacityPct > 70 ? 'is-warn' : 'is-brand'

  return (
    <>
      <h2>Set your borrow</h2>
      <p className="advisor-explainer">Borrow stablecoins against your basket. Risk updates as you type.</p>

      <HfMeter hf={hf} interventionHf={interventionHf} />

      <div className="advisor-capacity-row">
        <span>
          Borrowing {formatUsd(totalBorrowUsd)} of {formatUsd(capacity)} origination limit
        </span>
        <div className="advisor-capacity-track">
          <span className={`advisor-capacity-fill ${capacityClass}`} style={{ width: `${capacityPct}%` }} />
        </div>
        <p className="advisor-capacity-note">
          Borrowing to your full origination limit places you inside the agent&apos;s intervention zone.
        </p>
      </div>

      <div className="advisor-stable-cards">
        {STABLECOIN_ORDER.map(coin => {
          const card = borrowState[coin]
          return (
            <div className="advisor-stable-card-wrap" key={coin}>
              <label className="advisor-stable-card" data-testid={`stable-card-${coin}`}>
                <input
                  type="checkbox"
                  className="advisor-visually-hidden"
                  checked={card.checked}
                  onChange={e => onToggleCoin(coin, e.target.checked)}
                />
                <span className="advisor-stable-name">{coin}</span>
                <span className="advisor-tier-chip">{STABLECOIN_TIER_LABEL[coin]}</span>
                <span className="advisor-stable-apr">{(HERO_BORROW_APR[coin] * 100).toFixed(1)}% APR</span>
                <span className="advisor-stable-cap">{STABLECOIN_CAP_NOTE[coin]}</span>
                {coin === 'USDe' && <span className="advisor-peg-badge">Peg ${HERO_USDE_PRICE.toFixed(3)}</span>}
              </label>
              {card.checked && (
                <label className="advisor-amount-field">
                  {coin} amount
                  <input
                    type="text"
                    inputMode="numeric"
                    value={amountInputs[coin]}
                    onChange={e => onAmountChange(coin, e.target.value)}
                    onFocus={() => onAmountFocus(coin)}
                    onBlur={() => onAmountBlur(coin)}
                  />
                </label>
              )}
            </div>
          )
        })}
      </div>

      {errors.length > 0 && (
        <ul className="advisor-error-list">
          {errors.map(error => (
            <li key={error.code}>{error.message}</li>
          ))}
        </ul>
      )}
    </>
  )
}

interface Step3Props {
  mode: IntentConfig['mode']
  onModeChange: (mode: IntentConfig['mode']) => void
  permissions: Record<string, boolean>
  onPermissionChange: (key: string, value: boolean) => void
  interventionHf: number
  onInterventionChange: (value: number) => void
}

function Step3Mandate({ mode, onModeChange, permissions, onPermissionChange, interventionHf, onInterventionChange }: Step3Props) {
  return (
    <>
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
    </>
  )
}

interface Step4Props {
  weightPercents: Record<UnderlyingId, number>
  borrows: IntentBorrow[]
  mode: IntentConfig['mode']
  permissions: Record<string, boolean>
  interventionHf: number
  projectedHf: number
  capacity: number
  totalBorrowUsd: number
  assessment: Assessment
}

function Step4Review({
  weightPercents,
  borrows,
  mode,
  permissions,
  interventionHf,
  projectedHf,
  capacity,
  totalBorrowUsd,
  assessment,
}: Step4Props) {
  const blendedApr =
    totalBorrowUsd === 0 ? 0 : borrows.reduce((acc, b) => acc + b.amountUsd * HERO_BORROW_APR[b.stablecoin], 0) / totalBorrowUsd
  const enabledPermissions = Object.values(permissions).filter(Boolean).length
  const headroom = Math.max(0, capacity - totalBorrowUsd)
  const topProposal = assessment.proposals[0]

  return (
    <>
      <h2>Review &amp; activate</h2>

      <div className="advisor-review-grid">
        <div className="advisor-review-column">
          <p className="advisor-overline">Portfolio</p>
          {UNDERLYING_ORDER.map(id => (
            <div key={id} className="advisor-review-row">
              <span className="advisor-asset-dot" style={{ background: SERIES_COLOR[id] }} />
              <span>{HERO_UNDERLYINGS[id].symbol}</span>
              <span>{weightPercents[id] ?? 0}%</span>
            </div>
          ))}
        </div>
        <div className="advisor-review-column">
          <p className="advisor-overline">Borrow</p>
          {borrows.map(b => (
            <div key={b.stablecoin} className="advisor-review-row">
              <span>{b.stablecoin}</span>
              <span>{formatUsd(b.amountUsd)}</span>
            </div>
          ))}
          <div className="advisor-review-row">
            <span>Blended APR</span>
            <span>{totalBorrowUsd === 0 ? '—' : `${(blendedApr * 100).toFixed(1)}%`}</span>
          </div>
        </div>
        <div className="advisor-review-column">
          <p className="advisor-overline">Mandate</p>
          <p>{MODE_COPY[mode].title}</p>
          <p>{enabledPermissions} permissions enabled</p>
          <p>Threshold {interventionHf.toFixed(2)}</p>
        </div>
        <div className="advisor-review-column">
          <p className="advisor-overline">Risk</p>
          <HfMeter hf={projectedHf} interventionHf={interventionHf} compact />
          <p>Headroom to origination limit {formatUsd(headroom)}</p>
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
 * The agent onboarding wizard: a four-step flow (Portfolio → Borrow →
 * Mandate → Review) that builds and validates an {@link IntentConfig} live
 * against the domain engine, with a health-factor meter on the borrow step
 * and a pre-activation agent preview on the review step as the two moments
 * that show the product working before the user commits.
 */
export function Onboarding({ initialConfig, appliedChangesNotice = 0, onActivate, onSkipDemo }: OnboardingProps) {
  const [step, setStep] = useState(1)
  const [weightPercents, setWeightPercents] = useState<Record<UnderlyingId, number>>(() =>
    initialWeightPercents(initialConfig),
  )
  const [collateralUsd, setCollateralUsd] = useState(() =>
    totalDepositsUsd(initialConfig?.deposits ?? DEFAULT_INTENT.deposits),
  )
  const [collateralInput, setCollateralInput] = useState(() =>
    formatUsd(totalDepositsUsd(initialConfig?.deposits ?? DEFAULT_INTENT.deposits)),
  )
  const [borrowState, setBorrowState] = useState<Record<Stablecoin, BorrowCardState>>(() =>
    initialBorrowState(initialConfig),
  )
  const [amountInputs, setAmountInputs] = useState<Record<Stablecoin, string>>(() => {
    const initial = initialBorrowState(initialConfig)
    const out = {} as Record<Stablecoin, string>
    for (const coin of STABLECOIN_ORDER) out[coin] = formatUsd(initial[coin].amountUsd)
    return out
  })
  const [mode, setMode] = useState<IntentConfig['mode']>(initialConfig?.mode ?? DEFAULT_INTENT.mode)
  const [permissions, setPermissions] = useState<Record<string, boolean>>(
    initialConfig?.permissions ?? DEFAULT_INTENT.permissions,
  )
  const [interventionHf, setInterventionHf] = useState(initialConfig?.interventionHf ?? DEFAULT_INTENT.interventionHf)

  const weightTotal = UNDERLYING_ORDER.reduce((acc, id) => acc + (weightPercents[id] ?? 0), 0)

  // Step 1 keeps its existing percent-slider UI; deposits are derived from it
  // locally rather than the wizard operating on the deposits API directly
  // (Pass C2 rebuilds this screen around deposits — this pass is compile-only).
  const deposits = useMemo(
    () => depositsFromWeightPercents(weightPercents, collateralUsd),
    [weightPercents, collateralUsd],
  )
  const targetWeights = useMemo(() => derivedTargetWeights(deposits), [deposits])

  const borrows: IntentBorrow[] = useMemo(
    () =>
      STABLECOIN_ORDER.filter(coin => borrowState[coin].checked).map(coin => ({
        stablecoin: coin,
        amountUsd: borrowState[coin].amountUsd,
      })),
    [borrowState],
  )

  const config: IntentConfig = useMemo(
    () => ({
      deposits,
      borrows,
      mode,
      permissions,
      interventionHf,
    }),
    [deposits, borrows, mode, permissions, interventionHf],
  )

  const collateral = useMemo(() => buildCollateralFromDeposits(deposits), [deposits])
  const capacity = useMemo(() => maxBorrowUsd(collateral, HERO_UNDERLYINGS, MARKET), [collateral])
  const totalBorrowUsd = borrows.reduce((acc, b) => acc + b.amountUsd, 0)
  const projected = useMemo(() => projectIntentHf(deposits, borrows), [deposits, borrows])
  const validation = useMemo(() => validateIntent(config), [config])

  const assessment = useMemo(
    () =>
      assessPosition({
        collateral,
        debts: buildDebtsFromIntent(borrows),
        underlyings: HERO_UNDERLYINGS,
        targetWeights,
        market: MARKET,
        signals: HERO_SIGNALS,
        interventionHf,
      }),
    [collateral, borrows, targetWeights, interventionHf],
  )

  const setWeight = (id: UnderlyingId, value: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(value)))
    setWeightPercents(prev => ({ ...prev, [id]: clamped }))
  }

  const handleNormalize = () => setWeightPercents(prev => normalizeWeights(prev))

  const toggleCoin = (coin: Stablecoin, checked: boolean) =>
    setBorrowState(prev => ({ ...prev, [coin]: { ...prev[coin], checked } }))

  const setCoinAmount = (coin: Stablecoin, amountUsd: number) =>
    setBorrowState(prev => ({ ...prev, [coin]: { ...prev[coin], amountUsd: Math.max(0, amountUsd) } }))

  const handleAmountChange = (coin: Stablecoin, raw: string) => {
    setAmountInputs(prev => ({ ...prev, [coin]: raw }))
    setCoinAmount(coin, parseUsdInput(raw))
  }

  const handleAmountFocus = (coin: Stablecoin) =>
    setAmountInputs(prev => ({ ...prev, [coin]: String(borrowState[coin].amountUsd) }))

  const handleAmountBlur = (coin: Stablecoin) =>
    setAmountInputs(prev => ({ ...prev, [coin]: formatUsd(borrowState[coin].amountUsd) }))

  const setPermission = (key: string, value: boolean) => setPermissions(prev => ({ ...prev, [key]: value }))

  const commitCollateral = () => {
    const value = Math.max(1_000_000, parseUsdInput(collateralInput))
    setCollateralUsd(value)
    setCollateralInput(formatUsd(value))
  }

  const canContinueStep1 = weightTotal === 100
  const canContinueStep2 = validation.ok
  const canContinue = step === 1 ? canContinueStep1 : step === 2 ? canContinueStep2 : true
  const blockingReason =
    step === 1 && !canContinueStep1
      ? `Target weights total ${weightTotal}% — they must add up to 100% before you continue.`
      : step === 2 && !canContinueStep2
        ? validation.errors[0]?.message
        : undefined

  const goBack = () => setStep(s => Math.max(1, s - 1))
  const goNext = () => setStep(s => Math.min(4, s + 1))

  return (
    <div className="advisor-wizard">
      <div className="advisor-brand-row">
        <span className="advisor-brand">0x.credit</span>
        <span className="advisor-brand-sub">Robo-Advisor</span>
      </div>

      <StepRail current={step} />

      <section className="advisor-step-panel">
        {step === 1 && (
          <Step1Portfolio
            weightPercents={weightPercents}
            weightTotal={weightTotal}
            collateralInput={collateralInput}
            onCollateralChange={setCollateralInput}
            onCollateralBlur={commitCollateral}
            onWeightChange={setWeight}
            onNormalize={handleNormalize}
            onSkipDemo={onSkipDemo}
            appliedChangesNotice={appliedChangesNotice}
          />
        )}
        {step === 2 && (
          <Step2Borrow
            hf={projected.healthFactor}
            interventionHf={interventionHf}
            capacity={capacity}
            totalBorrowUsd={totalBorrowUsd}
            borrowState={borrowState}
            amountInputs={amountInputs}
            onToggleCoin={toggleCoin}
            onAmountChange={handleAmountChange}
            onAmountFocus={handleAmountFocus}
            onAmountBlur={handleAmountBlur}
            errors={validation.errors}
          />
        )}
        {step === 3 && (
          <Step3Mandate
            mode={mode}
            onModeChange={setMode}
            permissions={permissions}
            onPermissionChange={setPermission}
            interventionHf={interventionHf}
            onInterventionChange={setInterventionHf}
          />
        )}
        {step === 4 && (
          <Step4Review
            weightPercents={weightPercents}
            borrows={borrows}
            mode={mode}
            permissions={permissions}
            interventionHf={interventionHf}
            projectedHf={projected.healthFactor}
            capacity={capacity}
            totalBorrowUsd={totalBorrowUsd}
            assessment={assessment}
          />
        )}

        <WizardFooter
          step={step}
          canContinue={step === 4 ? true : canContinue}
          reason={blockingReason}
          onBack={goBack}
          onContinue={step === 4 ? () => onActivate(config) : goNext}
          continueLabel={step === 4 ? 'Activate agent' : 'Continue'}
          continueTestId={step === 4 ? 'activate-agent' : undefined}
        />
      </section>
    </div>
  )
}
