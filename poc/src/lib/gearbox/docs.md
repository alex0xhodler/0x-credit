# Noridoc: poc/src/lib/gearbox

Path: @/poc/src/lib/gearbox

### Overview

- All Gearbox protocol integration for the 0x.credit frontend: on-chain strategy discovery, collateral APY input, RWA eligibility, execution planning, deposit controls, and transaction utilities. Built on `@gearbox-protocol/sdk` 17.x, Ethereum Mainnet only.
- `live.ts` is the data entry point: it attaches one mainnet `OnchainSDK`, reads each allowlisted strategy's credit managers from on-chain `StrategyOpportunity` data, and derives per-route APY, leverage, minimum deposit and borrowing cost.
- The off-chain inputs are the collateral token APY and the strategy back-test chart, both read from the Gearbox backend (`GearboxAPI`, `@gearbox-protocol/sdk/offchain`); everything else (rates, liquidation thresholds, debt limits, sunset/paused status, KYC gates, curator, opportunity name) comes from chain.

### How it fits into the larger codebase

- `App.tsx` calls `loadMainnetOpportunities()` once and maps every returned opportunity × route to an `OpportunityView` for `TransactionCockpit.tsx`.
- `App.tsx` calls `checkStrategyEligibility` for RWA routes when a wallet is connected, and feeds the result through `rwaExecutionGate` (`eligibility.ts`) into the cockpit's execute button.
- `sdkAdapter.ts` builds the open-account transaction (`prepareOpenStrategyTx`) from the attached SDK held on `LoadedGearboxOpportunity.sdk`.
- `plan.ts` provides leverage/collateral math and APY formatting; `deposit.ts` provides deposit presets/steps for the cockpit; `transactions.ts` provides receipt/error helpers; `amounts.ts` provides token amount parsing/formatting, including `formatMinimumDeposit`'s ceiling rounding.
- `strategyBacktest.ts` builds the leveraged history line `TransactionCockpit.tsx` draws before "Now" on the projection chart, fetched lazily per selected route from the same `gearboxApi` client `live.ts` exports.
- `live.ts` exports one shared `gearboxApi` (`GearboxAPI` instance, `chainIds: [1]`, `baseUrl` from `VITE_GEARBOX_API_URL` or `https://api.gearbox.foundation`) used for both collateral APY and chart history — no proxy involved, the SDK client talks to the backend directly.

### Core Implementation

**Strategy discovery (`live.ts`)**

- Strategies are an explicit allowlist of target collateral tokens: Beefy ETH+/WETH (`strategyId` `wmooCurveETH+-WETH`) and the RWAs mF-ONE and mGLOBAL. On-chain strategies not on the allowlist are never shown, even if `rwa: true` — new RWA markets can need gating (e.g. Securitize signatures) that the open flow does not implement.
- Routes for each target are every on-chain strategy opportunity with that target collateral, excluding `sunset` or `paused` ones, so new credit managers appear without config changes.
- One `OnchainSDK` is attached per page load (attach is retried once; the public RPC occasionally reverts `getMarkets`), with `BotsPlugin` supplying the deleverage bot, selected by contract type `BOT::PARTIAL_LIQUIDATION`.
- `buildCreditManagerRoute(opportunity, collateralApyBps, { kycRegistrationLink? })` is the pure route builder:

| Field | Source |
|---|---|
| `maxLeverage` | `calculateLeverageForTargetHealthFactor` at 1.04 HF + 0.0015 buffer, capped by the opportunity's on-chain max leverage |
| `apy` | SDK `calcNetStrategyApy(opportunity, collateralApy, leverage, 'aggressive')`; `undefined` when the backend has no collateral APY for this credit manager |
| `baseApy` | Collateral APY from the backend |
| `baseBorrowRate`, `baseQuotaRateWithFee` | On-chain `borrowApy` / `quotaRate`, already fee-inclusive |
| `totalBorrowRate` | `baseBorrowRate + baseQuotaRateWithFee` |
| `minDebt`, `maxDebt`, `availableToBorrow` | On-chain `minDebt`, `maxBorrowAmount`, `availableLiquidity` |
| `minimumDepositAmount` | `calculateMinimumCollateralForDebt(minDebt, leverage)` |
| `collateralToken/Symbol/Decimals` | The credit manager's underlying (WETH/wstETH for ETH+, frxUSD for both RWAs) |
| `strategyName`, `targetSymbol`, `curator`, `liquidationThresholdBps` | On-chain opportunity `name`, `targetCollateral.symbol`, `curator.name` (falls back to `"Gearbox"` when unknown), `liquidationThreshold` — one per credit manager, never assumed from the group's first opportunity |
| `rwa`, `kycRegistrationLink` | On-chain `rwa` flag; KYC link from `sdk.opportunities.getStrategy().kyc` |

**Collateral APY (`fetchCollateralApysByCreditManager` in `live.ts`)**

- Reads `gearboxApi.opportunities.list({ kind: 'strategy' })` and keys each `collateralApy?.totalApy` (Bps) by **lowercased credit manager**, not target token — two routes to the same target (e.g. ETH+'s WETH and wstETH credit managers) price their collateral differently, so a single per-target value would misstate one of them. A backend failure yields an empty map; collateral APY simply renders as "n/a" rather than throwing.

**Strategy back-test (`strategyBacktest.ts`)**

- `fetchStrategyBacktest(creditManager, liquidationThresholdBps, leverage)` reads `gearboxApi.opportunities.getCharts({kind:'strategy', chainId:1, creditManager}, ['collateralApy','borrowApy','quotaRate'], '1y')` and turns each day into a leveraged net-APY point via `calcNetStrategyApy(..., 'aggressive')`; a day where any of the three series is null (or unavailable series) nulls out that day rather than guessing. Cached per credit manager; any failure resolves to `undefined` rather than throwing.
- `TransactionCockpit.tsx` fetches this lazily per selected route (`useStrategyBacktest`) and feeds it into `buildBalanceTimeline`'s `strategyHistory` param, so the chart's past segment is the same leveraged strategy the future projection extrapolates — not the unleveraged pool APY. Routes without history (fetch failure, or a route with no chart history yet) fall back to a projection-only line: no gap or discontinuity, the projection still starts exactly at "Now".

**RWA execution gate (`eligibility.ts`)**

- `rwaExecutionGate` is pure: non-RWA routes and disconnected wallets pass through; for RWA routes only `eligible` allows execution, while `unknown`/`checking`, `ineligible` (with the Midas registration link when present) and `error` all block execution.

**Transaction builder (`sdkAdapter.ts`)**

- `prepareOpenStrategyTx` validates debt bounds, then in parallel resolves the approval target, the router open path to the target token, and (when a bot exists) `accounts.bots.setBot` calls; `accounts.openCA` then returns the raw transaction directly, with bot calls placed in `callsAfter`.

### Things to Know

- Units: SDK values are Bps (1% = 100) and float leverage; route fields use app units (1% = 10,000) and bigint leverage ×100. Conversion happens only inside `buildCreditManagerRoute`; `App.tsx` divides by 10,000 for display.
- The 1.04 target HF is deliberate: the mainnet partial-liquidation bot triggers below 1.03 HF, and 0.5% router slippage on a lower target can open a position that is immediately eligible for deleverage.
- `'aggressive'` quota mode matches the executed quota (`debt × 1.05` via `DEFAULT_QUOTA_RESERVE_BPS`), so the displayed APY reflects the quota actually purchased.
- Any credit manager can have `apy: undefined` when the backend has no collateral APY for it yet (independent of RWA status); the cockpit then shows borrow cost with "APY n/a" instead of a projection. Collateral APY can move sharply day to day; at ~5-7x leverage that change is multiplied in the displayed net APY.
- RWA strategies accept only their underlying (frxUSD) as deposit, even though the SDK lists other allowed deposit tokens. Exits are delayed Midas redemptions and are managed on the Gearbox dashboard; the cockpit has no exit flow.
- The cockpit's headline symbol (tab, chart title, "Selected strategy" heading) is the route's `targetSymbol` for RWA routes (mF-ONE, mGLOBAL) and the deposit token for everything else; deposit amounts, "You deposit"/"Earn .../year" text and the borrowed-amount estimate always use the actual deposit token (`tokenSymbol`, e.g. frxUSD), never the headline.
- ETH-denominated DefiLlama benchmarks (Lido stETH, "Hold WETH") only render next to an ETH-like deposit (`/eth/i` on the deposit symbol); a stable/RWA deposit gets a flat "Hold {symbol} 0%" baseline instead — comparing an RWA position to ETH staking yield would be apples-to-oranges.
- `formatMinimumDeposit` (`amounts.ts`) always rounds a raw bigint minimum UP at the display precision, entirely in bigint arithmetic — never nearest/floor. A minimum's floating-point representation (e.g. 1.572327... WETH) would otherwise display below the true minimum at 4dp and reject the very amount it suggested; used for the default deposit amount, the "Min" preset, the below-minimum warning text and `minDepositLabel`.
- Midas greenlisting of the credit account is added automatically by `openCA` through the credit suite's opening calls; the wallet-level check is `sdk.opportunities.isEligibleForStrategy`.
- `prepareOpenStrategyTx` takes a structural SDK type built from the real SDK types, and `App.tsx` passes the attached `OnchainSDK` without a cast, so `tsc -b` (run by `npm test`) fails if SDK transaction shapes change.
- The opportunity cache is module-level and lives for the page; a failed load is not cached, and `App.tsx` shows a load error instead of leaving the cockpit in its loading state. `resetGearboxOpportunityCache()` exists for tests.

Created and maintained by Nori.
