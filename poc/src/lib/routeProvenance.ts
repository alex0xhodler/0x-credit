import { MAINNET_STRATEGY_ID } from './gearbox/live'
import type { RouteStep } from '../TransactionCockpit'

export function routeProvenanceForStrategy(strategyId: string, chainName: string, curator: string): readonly RouteStep[] | undefined {
  return strategyId === MAINNET_STRATEGY_ID && chainName === 'Ethereum'
    ? [
        { role: 'Manager', provider: curator },
        { role: 'Protocol', provider: 'Gearbox' },
        { role: 'Pool', provider: 'Beefy on Curve' },
      ]
    : undefined
}
