# Noridoc: poc/src

Path: @/poc/src

### Overview

- Root of the React frontend for Institutional Credit, served from the `0x.credit` origin. Contains the application shell ([`@/poc/src/App.tsx`](App.tsx)), the single-screen cockpit UI ([`@/poc/src/TransactionCockpit.tsx`](TransactionCockpit.tsx)), and global styles ([`@/poc/src/App.css`](App.css)).
- [`@/poc/src/App.tsx`](App.tsx) owns all application state and side-effects. [`@/poc/src/TransactionCockpit.tsx`](TransactionCockpit.tsx) receives route and execution state through props while owning static, display-only collateral context for the builder.
- The entire user-facing flow — strategy selection, deposit configuration, wallet connection, transaction execution, and live position monitoring — is rendered in a single persistent screen called the cockpit.

### How it fits into the larger codebase

- `App.tsx` is the application root mounted by `@/poc/src/main.tsx`. It composes Wagmi, React Query, and Reown AppKit providers around `GearboxApp`.
- Institutional Credit is the shared display identity: [`@/poc/index.html`](../index.html) supplies the browser title, [`@/poc/src/config/index.tsx`](config/index.tsx) supplies the Reown metadata name consumed by [`@/poc/src/App.tsx`](App.tsx), and [`@/poc/src/TransactionCockpit.tsx`](TransactionCockpit.tsx) exposes it in visible and accessible cockpit labels. The metadata URL remains the `0x.credit` origin (or the active browser origin), separating product display identity from the connection URL.
- `GearboxApp` calls `loadGearboxOpportunity` from `@/poc/src/lib/gearbox/live.ts` to fetch on-chain strategy data for both Monad and Ethereum Mainnet chains.
- `opportunityViews` (the list passed to `TransactionCockpit`) is derived inside `App.tsx` by iterating `LoadedGearboxOpportunity.creditManagers` and mapping each `GearboxCreditManagerRoute` to an `OpportunityView` with numeric fields (`apyPercent`, `baseApyPercent`, `borrowRatePercent`, `leverageMultiple`, `minimumDeposit`). Each view may also carry structured, selected-route-specific `routeSteps` provenance.
- `TransactionCockpit.tsx` loads the pinned Ethereum yield benchmarks through `@/poc/src/lib/defillamaYields.ts` and passes them, together with the selected route’s net APY, to `buildBalanceTimeline` in `@/poc/src/lib/comparisonTimeline.ts`.
- Execution logic (approve + open credit account) lives entirely in `App.tsx`; `TransactionCockpit` surfaces progress via the `steps: ExecutionStep[]` prop, sourced from `@/poc/src/lib/gearbox/plan.ts`.
- The builder's eligible-collateral list is module-local presentation data in [`@/poc/src/TransactionCockpit.tsx`](TransactionCockpit.tsx), styled by [`@/poc/src/App.css`](App.css); it is separate from the Gearbox routes that [`@/poc/src/App.tsx`](App.tsx) loads and maps into `OpportunityView` props.
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
├── h1.sr-only           (Automated yield strategies)
├── cockpit (main card)
│   ├── cockpit-header   (brand + strategy-tabs)
│   └── cockpit-body
│       ├── cockpit-chart-pane
│       │   ├── route-summary (selected-route provenance, when supplied)
│       │   ├── YieldComparisonChart  (Recharts continuous history + projection)
│       │   ├── chart-legend
│       └── cockpit-builder
│           ├── deposit input + preset chips + stepper
│           ├── position-preview card
│           ├── alerts / route warnings
│           ├── step-rail (execution steps)
│           └── primary-action button
```

- `YieldComparisonChart` renders one continuous ETH-equivalent balance timeline: historical APY compounds up to `Now`, and the same series then project forward from their current rates. It compares the selected route’s net APY, Lido stETH, and holding WETH at 0%.
- The comparison period control is a `role="radiogroup"` with 1M, 6M, and 1Y choices; the default is 6M. The chart baseline follows the entered deposit (or the minimum deposit fallback) after a 300 ms debounce, preventing a redraw for every keystroke.
- Benchmark fetching is best-effort and abortable. When it is unavailable, the chart still renders the selected route and the flat WETH comparison; unavailable benchmark series are omitted.
- Strategy selector is a persistent `role="tablist"` tab bar in the header. Switching tabs calls `onSelectOpportunity`, which in `App.tsx` resets execution error, sets `forceNewAccount`, and updates `amount` to a chain-appropriate default.
- When present, `OpportunityView.routeSteps` is rendered as a compact route summary beside the projection rather than as global partner branding; every displayed provider is paired with its operational role.
- The right-hand builder presents tokenized-asset lending copy and maps its static eligible-collateral records to ticker, name/category, and pre-formatted 24-hour volume rows. The list has no callbacks or controls; changing the `Collateral amount` input still calls the `onAmountChange` prop and therefore updates only the amount state held by [`@/poc/src/App.tsx`](App.tsx).

### Things to Know

- `OpportunityView` carries both human-readable label strings (for fallback rendering during load) and numeric fields (`apyPercent`, `baseApyPercent`, etc.) that the cockpit uses for all computation. It can also carry optional `routeSteps: readonly { role, provider }[]`; absent steps intentionally produce no provenance UI. The numeric fields are `undefined` while the opportunity is loading.
- The chart uses `minimumDeposit || 1` before there is a valid entered amount. All series are rebased to that common ETH-equivalent balance, so the visual compares yield paths rather than token-denominated prices.
- The displayed selected-strategy APY is the route’s net APY after its complete effective borrowing cost; this is calculated in `lib/gearbox/live.ts`, not recomputed in the chart.
- `isCollapsedApproval` collapses the approve step visually once it is done, to reduce noise during the account-open step.
- `useSimulatedPositionValue` uses a 2-second polling interval and respects `prefers-reduced-motion` — the ticker freezes when reduced motion is set.
- `manageUrl` is only set when `hasStartedFlow && hasOpenPosition && !forceNewAccount`. `forceNewAccount` is set to `true` when the user switches strategy tabs or explicitly resets the flow, which brings the cockpit back into deposit mode even when a position exists.
- The eligible-collateral records do not select an `OpportunityView`, alter the selected Gearbox route, participate in amount validation, or introduce collateral contracts, route loading, or transaction paths. Planning and execution continue to use the selected route from [`@/poc/src/App.tsx`](App.tsx) and [`@/poc/src/lib/gearbox/`](lib/gearbox/docs.md).
- `shell.is-landing` and `shell.is-expanded` CSS states are legacy remnants from the previous 2-step flow. They remain in `App.css` but are no longer set by `TransactionCockpit.tsx`.

Created and maintained by Nori.
