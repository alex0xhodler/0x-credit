# Noridoc: poc/src/lib/gearbox

Path: @/poc/src/lib/gearbox

### Overview

- All Gearbox protocol integration for the 0x.credit frontend: on-chain data loading, execution planning, deposit controls, and transaction utilities.
- `live.ts` is the primary data-fetching entry point — it initialises the Gearbox SDK and derives per-credit-manager route data including APY, leverage, minimum deposit, and the full effective borrowing cost.
- `deposit.ts` provides UI-level deposit amount helpers (presets and step increments) scaled to the token's minimum deposit.

### How it fits into the larger codebase

- `live.ts` is called once per chain from `App.tsx` via `loadGearboxOpportunity`. Results are cached in a module-level `Map` keyed by `chainId-strategyId` to avoid redundant SDK initialisation.
- `deposit.ts` is imported by `TransactionCockpit.tsx` to populate the preset chips and stepper buttons in the deposit builder pane.
- `plan.ts` provides execution step creation and APY formatting utilities; both `App.tsx` and `TransactionCockpit.tsx` import from it.
- `sdkAdapter.ts` wraps the Gearbox SDK's `prepareOpenStrategyTx` call with local parameter derivation.
- `transactions.ts` provides `assertSuccessfulReceipt` and `formatTransactionError` used in `App.tsx` and `TransactionCockpit.tsx`.

### Core Implementation

**live.ts — strategy and route loading**

`loadGearboxOpportunity(options?)` returns a cached `Promise<LoadedGearboxOpportunity>`. When called without options, it defaults to the Monad chain and the `AUSDCT0` strategy.

Inside `createGearboxOpportunity`, the SDK is initialised with three plugins: `RemoteConfigsPlugin` (strategy definitions), `ApyPlugin` (APY snapshot), and `BotsPlugin` (deleverage bot address). For each credit manager in the strategy, a `GearboxCreditManagerRoute` is computed with:

| Field | Source |
|---|---|
| `apy` | `calculateApyForLeverage(collateralApy, leverage, baseRateWithFee, quotaRateWithFee, bonusApy?)` or `info.maxAPY` if APY plugin unavailable |
| `baseApy` | `targetTokenApy` — the collateral token's raw APY from the APY plugin snapshot, before any leverage |
| `maxLeverage` | `calculateLeverageForTargetHealthFactor` targeting 1.03 HF with a 0.0015 execution buffer |
| `minimumDepositAmount` | `calculateMinimumCollateralForDebt(minDebt, leverage)` |
| `baseBorrowRate` | Direct from on-chain credit manager |
| `baseQuotaRateWithFee` | Active quota rate for the strategy target token, including `feeInterest`; zero if no active quota exists |
| `totalBorrowRate` | `floor(baseBorrowRate × (10,000 + feeInterest) / 10,000) + baseQuotaRateWithFee` |

The `baseApy` field is the collateral token's APY (identified by `resolvedStrategy.tokenOutAddress`), retrieved from `apy.state.apySnapshot.apy.apyList`. This value flows through to `OpportunityView.baseApyPercent` in `App.tsx` after dividing by 10,000. `totalBorrowRate` similarly flows to `OpportunityView.borrowRatePercent`, so the cockpit’s selected-strategy future line uses the APY that already accounts for base borrowing rate, `feeInterest`, and any active quota.

**deposit.ts — deposit controls**

`getDepositControls(minDeposit)` returns:
- `reset`: the minimum deposit value (used by the Reset stepper button)
- `presets`: Min, 2×, and 5× multiples of `minDeposit`
- `steps`: a tuple of three additive step sizes, scaled to the magnitude of `minDeposit`

| minDeposit range | step sizes |
|---|---|
| ≥ 500 | 100, 500, 1000 |
| ≥ 50 | 10, 50, 100 |
| ≥ 5 | 1, 5, 10 |
| < 5 | 0.1, 1, 5 |

**Route selection in App.tsx**

`opportunityViews` in `App.tsx` deduplicates credit managers per collateral token before building the tab list. For each `(networkPrefix, LoadedGearboxOpportunity)` pair, it iterates `creditManagers`, keeps only routes with `maxDebt > 0` and non-negative APY, and when two routes share the same collateral token prefers the one with higher APY, then lower `minDebt`, then higher `maxDebt`.

### Things to Know

- `baseApy` in `GearboxCreditManagerRoute` is stored in basis points (same as `apy`). `App.tsx` divides both by 10,000 when populating `OpportunityView.baseApyPercent` and `OpportunityView.apyPercent`.
- `baseBorrowRate`, `baseQuotaRateWithFee`, and `totalBorrowRate` are basis-point values. The fee applies to both the base borrowing rate and an active quota rate before they are summed; do not display or use `baseBorrowRate` alone as the route’s borrowing cost.
- The APY plugin may not load on Mainnet (only Monad is the primary target). When `apy.loaded` is false, `baseApy` and computed `apy` fields are `undefined`, and the cockpit keeps the comparison chart in its loading state rather than producing a selected-strategy projection from incomplete route data.
- `selectBestCreditManagerForAmount` is used internally during `createGearboxOpportunity` to pick the top-level representative credit manager for `LoadedGearboxOpportunity` fields; the full `creditManagers` array is always returned for `App.tsx` to build the per-tab views.
- The opportunity cache (`cachedOpportunities`) is a module-level `Map` and persists for the lifetime of the page. `resetGearboxOpportunityCache()` is exported for test use.
- `FALLBACK_STRATEGY` hardcodes four known credit manager addresses for the Monad AUSDCT0 strategy, used when `RemoteConfigsPlugin` fails to load.

Created and maintained by Nori.
