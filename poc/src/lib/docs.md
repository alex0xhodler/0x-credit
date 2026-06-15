# Noridoc: poc/src/lib

Path: @/poc/src/lib

### Overview

- Pure utility and domain-logic layer for the 0x.credit frontend. No React dependencies.
- Contains `projection.ts` for earnings simulation and the `gearbox/` subdirectory for all Gearbox protocol integration.
- All functions here are imported by `@/poc/src/App.tsx` or `@/poc/src/TransactionCockpit.tsx`; nothing in this layer imports from the React layer.

### How it fits into the larger codebase

- `projection.ts` is consumed by `TransactionCockpit.tsx` (`ProjectionChart` component) to generate chart data points from numeric APY and deposit values.
- `@/poc/src/lib/gearbox/` contains all Gearbox SDK integration — strategy loading, execution planning, deposit controls, and transaction utilities.
- `App.tsx` imports from `gearbox/live.ts`, `gearbox/plan.ts`, `gearbox/sdkAdapter.ts`, and `gearbox/transactions.ts` for orchestration.
- `TransactionCockpit.tsx` imports from `gearbox/deposit.ts` and `gearbox/plan.ts` for UI-level data.

### Core Implementation

**projection.ts**

`buildProjection({ deposit, apyPercent, baseApyPercent?, years })` returns a `ProjectionPoint[]` array with one entry per month from `0` to `years * 12`. Each point contains:

| Field | Description |
|---|---|
| `amplified` | Deposit compounded at `apyPercent` (the leveraged strategy APY) |
| `plain` | Deposit compounded at `baseApyPercent` (collateral token APY, unlevered); `undefined` when `baseApyPercent` is not provided |
| `pessimistic` | Deposit compounded at 70% of `apyPercent` |
| `optimistic` | Deposit compounded at 130% of `apyPercent` |
| `band` | `optimistic - pessimistic` (envelope width, not used for Y-axis domain in the chart) |

All growth uses continuous compound formula `deposit * (1 + rate)^t` where `t` is fractional years.

### Things to Know

- The `band` field is pre-computed but the `ProjectionChart` component draws `pessimistic` and `optimistic` as individual envelope lines rather than using `band` as a stacked area, so it does not distort the Y-axis domain.
- `baseApyPercent` is sourced from `GearboxCreditManagerRoute.baseApy` in `live.ts`, which is populated from `targetTokenApy` (the collateral token's APY before leverage is applied). When the APY plugin has not loaded, this field is `undefined` and the plain trajectory is omitted from the chart.

Created and maintained by Nori.
