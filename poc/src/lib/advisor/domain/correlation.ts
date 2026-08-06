import type { CollateralPosition, DebtPosition, MarketContext, Stablecoin } from '../types'
import { collateralValueUsd } from './collateralValue'
import { effectiveDebtValueUsd } from './stablecoin'

/**
 * Maximum share of the book (gross collateral + gross debt) that may touch a
 * single issuer across both sides before a concentration warning is raised.
 */
export const SAME_ISSUER_CAP = 0.35

/**
 * Declares that a stablecoin's reserves are partly backed by a named issuer —
 * e.g. USDe holding Securitize credit. Enables detection of the reflexive loop
 * where the same issuer both issues a borrower's collateral and backs the
 * stablecoin they borrow, so a single issuer failure hits both sides at once.
 */
export interface StablecoinIssuerBacking {
  stablecoin: Stablecoin
  issuer: string
  /** Fraction of the stablecoin's reserves attributable to this issuer, 0–1. */
  reserveShare: number
}

export interface ReflexiveExposureInput {
  collateral: readonly CollateralPosition[]
  debts: readonly DebtPosition[]
  backings: readonly StablecoinIssuerBacking[]
  market: MarketContext
}

export interface IssuerReflexiveWarning {
  issuer: string
  /** Haircut-adjusted collateral value issued by this entity. */
  collateralUsd: number
  /** Effective debt value backed (by reserve share) by this entity. */
  stablecoinBackingUsd: number
  /** (collateralUsd + stablecoinBackingUsd) / book size. */
  footprintShare: number
  /** True when the issuer appears on both the collateral and stablecoin sides. */
  reflexive: boolean
  /** True when the footprint share exceeds the single-issuer cap. */
  breached: boolean
}

/**
 * Detects wrong-way / reflexive concentration risk. For every issuer that
 * appears in the book — as a collateral issuer, a stablecoin backer, or both —
 * it measures the combined USD footprint against the book size and flags:
 *  - reflexive loops (same issuer on both sides), and
 *  - single-issuer footprints beyond {@link SAME_ISSUER_CAP}.
 *
 * Only flagged issuers are returned, largest footprint first. This is the
 * control that keeps a "prevent liquidations" agent from silently endorsing a
 * structure whose collateral and borrowed liability fail together.
 */
export function computeReflexiveExposure(input: ReflexiveExposureInput): IssuerReflexiveWarning[] {
  const collateralByIssuer = new Map<string, number>()
  let grossCollateral = 0
  for (const p of input.collateral) {
    const { valueUsd } = collateralValueUsd(p, input.market)
    grossCollateral += valueUsd
    collateralByIssuer.set(p.token.issuer, (collateralByIssuer.get(p.token.issuer) ?? 0) + valueUsd)
  }

  const debtByStablecoin = new Map<Stablecoin, number>()
  let grossDebt = 0
  for (const d of input.debts) {
    const value = effectiveDebtValueUsd(d)
    grossDebt += value
    debtByStablecoin.set(d.stablecoin, (debtByStablecoin.get(d.stablecoin) ?? 0) + value)
  }

  const backingByIssuer = new Map<string, number>()
  for (const b of input.backings) {
    const stablecoinDebt = debtByStablecoin.get(b.stablecoin) ?? 0
    if (stablecoinDebt === 0) continue
    backingByIssuer.set(b.issuer, (backingByIssuer.get(b.issuer) ?? 0) + stablecoinDebt * b.reserveShare)
  }

  const bookSize = grossCollateral + grossDebt
  if (bookSize === 0) return []

  const issuers = new Set<string>([...collateralByIssuer.keys(), ...backingByIssuer.keys()])
  const warnings: IssuerReflexiveWarning[] = []
  for (const issuer of issuers) {
    const collateralUsd = collateralByIssuer.get(issuer) ?? 0
    const stablecoinBackingUsd = backingByIssuer.get(issuer) ?? 0
    const footprintShare = (collateralUsd + stablecoinBackingUsd) / bookSize
    const reflexive = collateralUsd > 0 && stablecoinBackingUsd > 0
    const breached = footprintShare > SAME_ISSUER_CAP
    if (reflexive || breached) {
      warnings.push({ issuer, collateralUsd, stablecoinBackingUsd, footprintShare, reflexive, breached })
    }
  }

  warnings.sort((a, b) => b.footprintShare - a.footprintShare)
  return warnings
}
