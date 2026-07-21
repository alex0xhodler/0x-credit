/**
 * Agentic on-chain robo-advisor engine.
 *
 * Off-chain, deterministic-core risk + routing engine that operates on the
 * PRD's underlying/token two-layer model. v1 has no on-chain execution — it
 * computes health, proposals, and routing decisions over synthetic fixtures.
 */

export * from './types'

// Domain (pure risk math)
export * from './domain/ltv'
export * from './domain/stablecoin'
export * from './domain/collateralValue'
export * from './domain/healthFactor'
export * from './domain/basket'

// Agent (assessment + editable proposals)
export * from './agent/signals'
export * from './agent/rebalance'
export * from './agent/engine'

// Routing (cost-driven venue selection)
export * from './routing/costEngine'
