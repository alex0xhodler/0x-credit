# Agentic on-chain robo-advisor — engine

Off-chain, deterministic-core engine for the agentic robo-advisor. It computes
collateral health, generates editable de-risk proposals, and picks best-execution
routes — all at the **underlying** level, hiding token/provider/routing detail.

## Resolved v1 decisions

| Area | Decision |
| --- | --- |
| Lending / liquidation | **Gearbox curator markets** — borrow + liquidation are Gearbox's, parameterized by us. No bespoke lending contracts. |
| Token execution | **Cost-driven** across DEX quotes + issuer mint/redeem RFQ (a quote/simulation engine in v1). |
| Deliverable | **UI + agentic engine, happy-path, no on-chain.** |
| Access | **Token-restriction-only** — protocol does no gating (v2 allowlist is a known gap). |
| Agent brain | **Hybrid** — deterministic risk math (here) + an LLM rationale layer (deferred). |
| Data | **Fully synthetic fixtures.** |

## Two-layer model

- **Token layer** — the ERC-20 a provider issues (bNVDA, ONVDA); its own LTV
  params and provider risk score.
- **Underlying layer** — the economic exposure (NVDA). The agent, basket, and UI
  operate here; routing translates silently.

## Module map

- `domain/` — pure risk math: `ltv`, `stablecoin`, `collateralValue`,
  `healthFactor`, `basket`. No I/O.
- `agent/` — `signals` (Signal Registry inputs), `rebalance` (position mutators),
  `engine` (`assessPosition` → editable proposals with **exact** HF projections).
- `routing/` — `costEngine` (`compareRoutes`), with the rejected-route audit trail.
- `fixtures/` — `heroScenario`: the canonical "hold 40% NVDA, borrow $5M USDC →
  earnings risk → rotate" demo, wired end-to-end in its test.

## Notable modeling choices

- USDe debt is marked **up** 3% in HF (conservative reading of the PRD "haircut").
- HF projections re-run the domain HF on mutated positions — no estimated deltas.
- Multi-provider tokens for one underlying are aggregated for concentration; a
  single provider >60% of an underlying raises a diversification proposal.

## Deferred (next commits)

LLM rationale layer · on-chain `RoutingExecutor` · live oracles (Chainlink/Pyth/
NAV) · Mandate & Signal registries as on-chain ops · protocol-level allowlist ·
the institutional UI (dashboard, basket manager, proposal diff, audit log).
