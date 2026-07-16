import { MAINNET_STRATEGY_ID } from './gearbox/live'
import type { RouteStep } from '../TransactionCockpit'

const MAINNET_CURVE_ROUTE: readonly RouteStep[] = [
  { role: 'Manager', provider: 'KPK' },
  { role: 'Protocol', provider: 'Gearbox' },
  { role: 'Pool', provider: 'Beefy on Curve' },
]

export function routeProvenanceForStrategy(strategyId: string, chainName: string): readonly RouteStep[] | undefined {
  return strategyId === MAINNET_STRATEGY_ID && chainName === 'Ethereum'
    ? MAINNET_CURVE_ROUTE
    : undefined
}
