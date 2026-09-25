# Noridoc: poc/src/lib/gearbox

Path: @/poc/src/lib/gearbox

### Overview

- All Gearbox protocol integration for the 0x.credit frontend: on-chain strategy discovery, collateral APY input, RWA eligibility, execution planning, deposit controls, and transaction utilities. Built on `@gearbox-protocol/sdk` 17.x, Ethereum Mainnet only.
- `live.ts` is the data entry point: it attaches one mainnet `OnchainSDK`, reads each allowlisted strategy's credit managers from on-chain `StrategyOpportunity` data, and derives per-route APY, leverage, minimum deposit and borrowing cost.
- The only off-chain input is the collateral token APY from the Gearbox state-cache APY server (`apyFeed.ts`); everything else (rates, liquidation thresholds, debt limits, sunset/paused status, KYC gates) comes from chain.

### How it fits into the larger codebase

- `App.tsx` calls `loadMainnetOpportunities()` once and maps every returned opportunity × route to an `OpportunityView` for `TransactionCockpit.tsx`.
- `App.tsx` calls `checkStrategyEligibility` for RWA routes when a wallet is connected, and feeds the result through `rwaExecutionGate` (`eligibility.ts`) into the cockpit's execute button.
- `sdkAdapter.ts` builds the open-account transaction (`prepareOpenStrategyTx`) from the attached SDK held on `LoadedGearboxOpportunity.sdk`.
- `plan.ts` provides leverage/collateral math and APY formatting; `deposit.ts` provides deposit presets/steps for the cockpit; `transactions.ts` provides receipt/error helpers.
- The APY feed is fetched through the `/gearbox-apy` proxy (Vite dev proxy and `vercel.json` rewrite) to `state-cache.gearbox.foundation/apy-server`.

### Core Implementation

**Strategy discovery (`live.ts`)**

- Strategies are an explicit allowlist of target collateral tokens: Beefy ETH+/WETH (`strategyId` `wmooCurveETH+-WETH`) and the RWAs mF-ONE and mGLOBAL. On-chain strategies not on the allowlist are never shown, even if `rwa: true` — new RWA markets can need gating (e.g. Securitize signatures) that the open flow does not implement.
- Routes for each target are every on-chain strategy opportunity with that target collateral, excluding `sunset` or `paused` ones, so new credit managers appear without config changes.
- One `OnchainSDK` is attached per page load (attach is retried once; the public RPC occasionally reverts `getMarkets`), with `BotsPlugin` supplying the deleverage bot, selected by contract type `BOT::PARTIAL_LIQUIDATION`.
- `buildCreditManagerRoute(opportunity, collateralApyBps, kycRegistrationLink?)` is the pure route builder:

| Field | Source |
|---|---|
| `maxLeverage` | `calculateLeverageForTargetHealthFactor` at 1.04 HF + 0.0015 buffer, capped by the opportunity's on-chain max leverage |
| `apy` | SDK `calcNetStrategyApy(opportunity, collateralApy, leverage, 'aggressive')`; `undefined` when the feed has no collateral APY |
| `baseApy` | Collateral APY from the feed |
| `baseBorrowRate`, `baseQuotaRateWithFee` | On-chain `borrowApy` / `quotaRate`, already fee-inclusive |
| `totalBorrowRate` | `baseBorrowRate + baseQuotaRateWithFee` |
| `minDebt`, `maxDebt`, `availableToBorrow` | On-chain `minDebt`, `maxBorrowAmount`, `availableLiquidity` |
| `minimumDepositAmount` | `calculateMinimumCollateralForDebt(minDebt, leverage)` |
| `collateralToken/Symbol/Decimals` | The credit manager's underlying (WETH/wstETH for ETH+, frxUSD for both RWAs) |
| `rwa`, `kycRegistrationLink` | On-chain `rwa` flag; KYC link from `sdk.opportunities.getStrategy().kyc` |

**Collateral APY feed (`apyFeed.ts`)**

- `parseCollateralApys(json, chainId)` takes each token's first `rewards.apy` entry (percent) and returns Bps keyed by lowercased address. Tokens with no APY entry are absent; a failed chain status, bad JSON or network error yields an empty map rather than throwing.

**RWA execution gate (`eligibility.ts`)**

- `rwaExecutionGate` is pure: non-RWA routes and disconnected wallets pass through; for RWA routes only `eligible` allows execution, while `unknown`/`checking`, `ineligible` (with the Midas registration link when present) and `error` all block execution.

**Transaction builder (`sdkAdapter.ts`)**

- `prepareOpenStrategyTx` validates debt bounds, then in parallel resolves the approval target, the router open path to the target token, and (when a bot exists) `accounts.bots.setBot` calls; `accounts.openCA` then returns the raw transaction directly, with bot calls placed in `callsAfter`.

### Things to Know

- Units: SDK values are Bps (1% = 100) and float leverage; route fields use app units (1% = 10,000) and bigint leverage ×100. Conversion happens only inside `buildCreditManagerRoute`; `App.tsx` divides by 10,000 for display.
- The 1.04 target HF is deliberate: the mainnet partial-liquidation bot triggers below 1.03 HF, and 0.5% router slippage on a lower target can open a position that is immediately eligible for deleverage.
- `'aggressive'` quota mode matches the executed quota (`debt × 1.05` via `DEFAULT_QUOTA_RESERVE_BPS`), so the displayed APY reflects the quota actually purchased.
- RWA collateral APYs are currently absent from the feed, so RWA routes carry `apy: undefined` and the cockpit shows borrow cost with "APY n/a" instead of a projection. The feed's daily APY for yield tokens can move sharply; at ~7x leverage that change is multiplied in the displayed net APY.
- RWA strategies accept only their underlying (frxUSD) as deposit, even though the SDK lists other allowed deposit tokens. Exits are delayed Midas redemptions and are managed on the Gearbox dashboard; the cockpit has no exit flow.
- Midas greenlisting of the credit account is added automatically by `openCA` through the credit suite's opening calls; the wallet-level check is `sdk.opportunities.isEligibleForStrategy`.
- `prepareOpenStrategyTx` takes a structural SDK type built from the real SDK types, and `App.tsx` passes the attached `OnchainSDK` without a cast, so `tsc -b` (run by `npm test`) fails if SDK transaction shapes change.
- The opportunity cache is module-level and lives for the page; `resetGearboxOpportunityCache()` exists for tests.

Created and maintained by Nori.
