# Noridoc: poc/src/lib

Path: @/poc/src/lib

### Overview

- Pure utility and domain-logic layer for the 0x.credit frontend. No React dependencies.
- Contains chart-domain utilities (`comparisonTimeline.ts`, `defillamaYields.ts`, and `chartTooltip.ts`), retained forward-projection helpers in `projection.ts`, and the `gearbox/` subdirectory for all Gearbox protocol integration.
- All functions here are imported by `@/poc/src/App.tsx` or `@/poc/src/TransactionCockpit.tsx`; nothing in this layer imports from the React layer.

### How it fits into the larger codebase

- `TransactionCockpit.tsx` uses `gearbox/strategyBacktest.ts` for the selected route's own leveraged history, `defillamaYields.ts` to load the single ETH-only LST benchmark, `comparisonTimeline.ts` to turn both into a continuous balance timeline, and `chartTooltip.ts` to keep comparison-tooltip ordering and labels deterministic.
- `@/poc/src/lib/gearbox/` contains all Gearbox SDK integration — strategy loading, execution planning, deposit controls, and transaction utilities.
- `App.tsx` imports from `gearbox/live.ts`, `gearbox/plan.ts`, `gearbox/sdkAdapter.ts`, and `gearbox/transactions.ts` for orchestration.
- `TransactionCockpit.tsx` imports `gearbox/transactions.ts` for user-facing transaction-error formatting and `gearbox/strategyBacktest.ts`/`gearbox/amounts.ts` for chart history and minimum-deposit formatting; the rest of its chart data comes from the chart-domain utilities above.

### Core Implementation

**comparisonTimeline.ts and defillamaYields.ts**

`loadEthereumYieldBenchmarks(signal?)` fetches DefiLlama's pool index and APY chart for one pinned Ethereum pool — Lido stETH (`747c1d2a-c668-4682-b9f9-296708a3dd90`), the liquid-staking benchmark. It only renders next to an ETH-like deposit (see `TransactionCockpit.tsx`'s `isEthLikeSymbol`); a stable/RWA deposit (frxUSD) shows a flat "Hold {symbol}" baseline instead of an ETH comparison. Before accepting the pool, the loader validates its pool id, Ethereum chain, project, symbol, exposure, finite non-negative APY, and non-outlier status.

`buildBalanceTimeline({ startingBalance, horizon, strategyApyPercent, strategyHistory?, benchmarks })` rebases available historical series at the entered balance, compounds historical APY daily until `Now`, and projects the same balances into the future. `strategyHistory` is the selected route's own leveraged net-APY back-test (`gearbox/strategyBacktest.ts`), not a DefiLlama series — its absence (no chart history yet, or a fetch failure) draws a projection-only strategy line with no past segment, never a flat or misleading one; the future leg always starts from wherever the back-test compounding ended, with no gap or jump at `Now`. Lido uses its current DefiLlama APY for the future leg; the "hold" baseline remains flat. A single numeric `time` axis spans past, `Now` (zero), and future.

**chartTooltip.ts**

`orderedComparisonTooltipRows` produces the stable selected-strategy, LST, then WETH order and calculates each available series’ ETH-equivalent delta from the flat WETH baseline. It contains display metadata only and does not fetch or calculate yields.

**projection.ts (retained forward-projection helpers)**

`buildProjection({ deposit, apyPercent, baseApyPercent?, years })` returns a `ProjectionPoint[]` array with one entry per month from `0` to `years * 12`. Each point contains:

| Field | Description |
|---|---|
| `amplified` | Deposit compounded at `apyPercent` (the leveraged strategy APY) |
| `plain` | Deposit compounded at `baseApyPercent` (collateral token APY, unlevered); `undefined` when `baseApyPercent` is not provided |
| `pessimistic` | Deposit compounded at 70% of `apyPercent` |
| `optimistic` | Deposit compounded at 130% of `apyPercent` |
| `band` | `optimistic - pessimistic` (envelope width, not used for Y-axis domain in the chart) |

All growth uses compound formula `deposit * (1 + rate)^t` where `t` is fractional years. These legacy forward-only helpers remain tested utilities; the cockpit comparison chart uses `buildBalanceTimeline` instead.

### Things to Know

- Historical benchmark rates are sparse APY snapshots, not token prices. `buildBalanceTimeline` carries the most recent known APY forward between observations and only renders a series when that benchmark was loaded.
- The React cockpit debounces the entered-balance baseline for 300 ms and defaults the comparison horizon to 6M. Those UI policies live in `TransactionCockpit.tsx`; the library accepts the resolved balance and horizon as inputs.
- `baseApyPercent` is still sourced from `GearboxCreditManagerRoute.baseApy` in `live.ts`, but the new comparison chart does not render the former plain-trajectory or scenario-envelope series.

Created and maintained by Nori.
