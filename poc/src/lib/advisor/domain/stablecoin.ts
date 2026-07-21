import type { DebtPosition, Stablecoin } from '../types'

export interface StablecoinConfig {
  /** Protocol risk tier — 1 is lowest risk. */
  riskTier: 1 | 2 | 3
  /**
   * Maximum share of a position's total debt value this stablecoin may hold.
   * `1` means uncapped.
   */
  maxBorrowShare: number
  /**
   * Conservatism markup applied to this stablecoin's debt value in the HF
   * calculation, reflecting peg risk. USDe carries a 3% markup; fiat-backed
   * coins carry none.
   */
  debtHaircut: number
  /** On-chain price below which new borrowing in this stablecoin is paused. */
  pegFloor?: number
}

/** USDe borrowing pauses if its on-chain price drops below this floor. */
export const USDE_PEG_FLOOR = 0.97

export const STABLECOIN_CONFIG: Record<Stablecoin, StablecoinConfig> = {
  USDC: { riskTier: 1, maxBorrowShare: 1, debtHaircut: 0 },
  USDT: { riskTier: 2, maxBorrowShare: 0.6, debtHaircut: 0 },
  USDe: { riskTier: 3, maxBorrowShare: 0.4, debtHaircut: 0.03, pegFloor: USDE_PEG_FLOOR },
}

/**
 * USD value of a debt position for HF purposes.
 *
 * The PRD specifies a 3% "haircut" on USDe debt. A haircut that made the debt
 * *smaller* would improve HF and understate risk, so we apply it in the
 * conservative direction: USDe debt is marked **up** by 3%, treating the peg as
 * potentially impaired and making the health factor stricter.
 */
export function effectiveDebtValueUsd(debt: DebtPosition): number {
  const { debtHaircut } = STABLECOIN_CONFIG[debt.stablecoin]
  return debt.amount * debt.priceUsd * (1 + debtHaircut)
}

/** Whether new borrowing in the given stablecoin is currently paused. */
export function isBorrowPaused(stablecoin: Stablecoin, pegPriceUsd: number): boolean {
  const { pegFloor } = STABLECOIN_CONFIG[stablecoin]
  if (pegFloor === undefined) return false
  return pegPriceUsd < pegFloor
}

export interface BorrowShareViolation {
  stablecoin: Stablecoin
  share: number
  cap: number
}

export interface BorrowShareResult {
  ok: boolean
  violations: BorrowShareViolation[]
}

/**
 * Checks that no stablecoin exceeds its permitted share of a position's total
 * debt value. Shares are measured on face value (peg markup excluded) so the
 * caps reflect exposure, not the HF conservatism adjustment.
 */
export function validateBorrowShares(debts: readonly DebtPosition[]): BorrowShareResult {
  const totals = new Map<Stablecoin, number>()
  let grandTotal = 0
  for (const d of debts) {
    const value = d.amount * d.priceUsd
    totals.set(d.stablecoin, (totals.get(d.stablecoin) ?? 0) + value)
    grandTotal += value
  }

  if (grandTotal === 0) return { ok: true, violations: [] }

  const violations: BorrowShareViolation[] = []
  for (const [stablecoin, value] of totals) {
    const cap = STABLECOIN_CONFIG[stablecoin].maxBorrowShare
    const share = value / grandTotal
    // Tolerate floating-point noise at the cap boundary.
    if (share - cap > 1e-9) violations.push({ stablecoin, share, cap })
  }

  return { ok: violations.length === 0, violations }
}
