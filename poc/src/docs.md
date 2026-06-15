# Noridoc: poc/src

Path: @/poc/src

### Overview

- Root of the React frontend for 0x.credit. Contains the application shell (`App.tsx`), the single-screen cockpit UI (`TransactionCockpit.tsx`), and global styles (`App.css`).
- `App.tsx` owns all state and side-effects; `TransactionCockpit.tsx` is a pure-rendering component that receives everything via props.
- The entire user-facing flow — strategy selection, deposit configuration, wallet connection, transaction execution, and live position monitoring — is rendered in a single persistent screen called the cockpit.

### How it fits into the larger codebase

- `App.tsx` is the application root mounted by `@/poc/src/main.tsx`. It composes Wagmi, React Query, and Reown AppKit providers around `GearboxApp`.
- `GearboxApp` calls `loadGearboxOpportunity` from `@/poc/src/lib/gearbox/live.ts` to fetch on-chain strategy data for both Monad and Ethereum Mainnet chains.
- `opportunityViews` (the list passed to `TransactionCockpit`) is derived inside `App.tsx` by iterating `LoadedGearboxOpportunity.creditManagers` and mapping each `GearboxCreditManagerRoute` to an `OpportunityView` with numeric fields (`apyPercent`, `baseApyPercent`, `borrowRatePercent`, `leverageMultiple`, `minimumDeposit`).
- `TransactionCockpit.tsx` calls `buildProjection` from `@/poc/src/lib/projection.ts` for chart data and `getDepositControls` from `@/poc/src/lib/gearbox/deposit.ts` for preset/stepper values.
- Execution logic (approve + open credit account) lives entirely in `App.tsx`; `TransactionCockpit` surfaces progress via the `steps: ExecutionStep[]` prop, sourced from `@/poc/src/lib/gearbox/plan.ts`.
- CSS design tokens and all layout rules live in `App.css`; the cockpit layout classes (`.cockpit-wrap`, `.cockpit-body`, `.cockpit-chart-pane`, `.cockpit-builder`) are defined there.

### Core Implementation

**App.tsx — state and orchestration**

- Maintains two parallel opportunity loads (`monadOpportunity`, `mainnetOpportunity`) with a shared `selectedOpportunityId` that tracks which tab is active.
- `opportunityViews` memo deduplicates credit managers per collateral token (preferring higher APY, then lower `minDebt`, then higher `maxDebt`), filters negative APYs, and sorts by `maxDebt` descending.
- A `useEffect` keyed on `displayedOpportunity.id` sets `amount` to `2 × minimumDeposit` whenever the selected opportunity changes away from a stale default (`'1500'`, `'3'`, `'1.5'`, `''`).
- `routeWarning` validates the entered `amountRaw` against `minimumDepositAmount` and the selected route's debt bounds before execution is permitted.
- `handleExecute` supports two paths: atomic batch (EIP-5792 `sendCalls`) when the wallet advertises `atomicBatch` capability, or sequential approve-then-open otherwise.
- Position state (`hasOpenPosition`, `activeCreditAccount`) is persisted to `localStorage` keyed by `address + strategyId` and reconciled against on-chain `getBorrowerCreditAccounts` on connect.

**TransactionCockpit.tsx — rendering**

The component has two render branches:
- `is-invested` (position open): full-screen position live view with a simulated real-time value ticker (`useSimulatedPositionValue`).
- Cockpit (default): two-pane layout.

```
cockpit-wrap
├── cockpit-hero         (tagline)
├── cockpit (main card)
│   ├── cockpit-header   (brand + strategy-tabs + w3m-button)
│   └── cockpit-body
│       ├── cockpit-chart-pane
│       │   ├── ProjectionChart  (recharts ComposedChart)
│       │   ├── chart-legend
│       │   └── ApyBreakdown
│       └── cockpit-builder
│           ├── deposit input + preset chips + stepper
│           ├── position-preview card
│           ├── alerts / route warnings
│           ├── step-rail (execution steps)
│           └── primary-action button
└── cockpit-footer       (powered-by logos)
```

- `ProjectionChart` renders an amplified trajectory, an optional plain (unlevered) trajectory, and a ±30% scenario envelope as dashed lines. Y-axis domain is computed from the amplified + optimistic series only, not from the `band` stacking value.
- `ApyBreakdown` renders a proportional bar showing base APY vs. leverage gain, plus a borrow-cost annotation. It receives numeric props and performs no string parsing.
- Strategy selector is a persistent `role="tablist"` tab bar in the header. Switching tabs calls `onSelectOpportunity`, which in `App.tsx` resets execution error, sets `forceNewAccount`, and updates `amount` to a chain-appropriate default.

### Things to Know

- `OpportunityView` carries both human-readable label strings (for fallback rendering during load) and numeric fields (`apyPercent`, `baseApyPercent`, etc.) that the cockpit uses for all computation. The numeric fields are `undefined` while the opportunity is loading.
- The `depositForChart` fallback (`minimumDeposit || 1`) ensures the chart renders something meaningful even before the user enters an amount.
- `isCollapsedApproval` collapses the approve step visually once it is done, to reduce noise during the account-open step.
- `useSimulatedPositionValue` uses a 2-second polling interval and respects `prefers-reduced-motion` — the ticker freezes when reduced motion is set.
- `manageUrl` is only set when `hasStartedFlow && hasOpenPosition && !forceNewAccount`. `forceNewAccount` is set to `true` when the user switches strategy tabs or explicitly resets the flow, which brings the cockpit back into deposit mode even when a position exists.
- `shell.is-landing` and `shell.is-expanded` CSS states are legacy remnants from the previous 2-step flow. They remain in `App.css` but are no longer set by `TransactionCockpit.tsx`.

Created and maintained by Nori.
