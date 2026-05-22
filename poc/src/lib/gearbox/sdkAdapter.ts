import type { Address, Hex } from 'viem'
import { calculateLoopPlan } from './plan'

interface MultiCallLike {
  target: Address | string
  callData: Hex | string
}

interface RawTxLike {
  to: Address | string
  callData: Hex | string
  value: string
}

interface CreditManagerSuiteLike {
  underlying: Address | string
  creditManager: {
    address: Address | string
    creditFacade: Address | string
    collateralTokens: Array<Address | string>
  }
  creditFacade: {
    address: Address | string
    minDebt?: bigint
    maxDebt?: bigint
  }
}

interface MarketRegisterLike {
  findCreditManager(creditManager: Address | string): CreditManagerSuiteLike
}

interface RouterLike {
  findOpenStrategyPath(args: {
    creditManager: CreditManagerSuiteLike['creditManager']
    expectedBalances: Array<{ token: Address | string; balance: bigint }>
    leftoverBalances: Array<{ token: Address | string; balance: bigint }>
    slippage: number
    target: Address | string
  }): Promise<{
    amount: bigint
    minAmount: bigint
    calls: MultiCallLike[]
  }>
}

interface AccountsLike {
  getApprovalAddress(args: {
    creditManager: Address | string
    borrower: Address | string
  }): Promise<Address | string>
  setBot(args: {
    botAddress: Address | string
    permissions: null
    targetContract: {
      type: 'creditManager'
      creditManager: Address | string
      creditFacade: Address | string
    }
  }): Promise<{ calls: MultiCallLike[] }>
  openCA(args: {
    averageQuota: Array<{ token: Address | string; balance: bigint }>
    calls: MultiCallLike[]
    callsAfter: MultiCallLike[]
    collateral: Array<{ token: Address | string; balance: bigint }>
    creditManager: Address | string
    debt: bigint
    ethAmount: bigint
    minQuota: Array<{ token: Address | string; balance: bigint }>
    permits: Record<string, never>
    referralCode: bigint
    to: Address | string
  }): Promise<{ tx: RawTxLike }>
}

interface GearboxSdkLike {
  marketRegister: unknown
  routerFor: unknown
  accounts: unknown
}

interface GearboxSdkNarrowed {
  marketRegister: {
    findCreditManager: MarketRegisterLike['findCreditManager']
  }
  routerFor(params: unknown): RouterLike
  accounts: AccountsLike
}

export interface PrepareOpenStrategyInput {
  sdk: GearboxSdkLike
  borrower: Address | string
  creditManager: Address | string
  collateralToken: Address | string
  targetToken: Address | string
  collateralAmount: bigint
  leverage: bigint
  quotaReserveBps: bigint
  slippageBps: number
  botAddress?: Address | string
  referralCode: bigint
}

export interface PreparedOpenStrategyTx {
  approvalTarget: Address | string
  debt: bigint
  quota: bigint
  totalOnAccount: bigint
  rawTx: RawTxLike
  routerAmount: bigint
  routerMinAmount: bigint
}

export async function prepareOpenStrategyTx({
  sdk,
  borrower,
  creditManager,
  collateralToken,
  targetToken,
  collateralAmount,
  leverage,
  quotaReserveBps,
  slippageBps,
  botAddress,
  referralCode,
}: PrepareOpenStrategyInput): Promise<PreparedOpenStrategyTx> {
  const plan = calculateLoopPlan({ collateralAmount, leverage, quotaReserveBps })

  if (!sdk) {
    throw new Error('Gearbox SDK is not available.')
  }

  const narrowedSdk = sdk as GearboxSdkNarrowed
  const cmSuite = narrowedSdk.marketRegister.findCreditManager(creditManager)
  const cmAddress = cmSuite.creditManager.address
  const creditFacade = cmSuite.creditFacade.address
  const minDebt = cmSuite.creditFacade.minDebt ?? 0n
  const maxDebt = cmSuite.creditFacade.maxDebt ?? 0n

  if (minDebt > 0n && plan.debt < minDebt) {
    throw new Error('Borrow amount is below the minimum debt for this route.')
  }

  if (maxDebt > 0n && plan.debt > maxDebt) {
    throw new Error('Borrow amount is above the maximum debt for this route.')
  }

  const [approvalTarget, openPath, botResult] = await Promise.all([
    narrowedSdk.accounts.getApprovalAddress({
      creditManager: cmAddress,
      borrower,
    }),
    narrowedSdk.routerFor(cmSuite).findOpenStrategyPath({
      creditManager: cmSuite.creditManager,
      expectedBalances: [{ token: collateralToken, balance: plan.totalOnAccount }],
      leftoverBalances: [{ token: collateralToken, balance: 1n }],
      slippage: slippageBps,
      target: targetToken,
    }),
    botAddress
      ? narrowedSdk.accounts.setBot({
          botAddress,
          permissions: null,
          targetContract: {
            type: 'creditManager',
            creditManager: cmAddress,
            creditFacade,
          },
        })
      : Promise.resolve({ calls: [] as MultiCallLike[] }),
  ])

  const openResult = await narrowedSdk.accounts.openCA({
    averageQuota: [{ token: targetToken, balance: plan.quota }],
    calls: openPath.calls,
    callsAfter: botResult.calls,
    collateral: [{ token: collateralToken, balance: collateralAmount }],
    creditManager: cmAddress,
    debt: plan.debt,
    ethAmount: 0n,
    minQuota: [{ token: targetToken, balance: plan.quota }],
    permits: {},
    referralCode,
    to: borrower,
  })

  return {
    approvalTarget,
    debt: plan.debt,
    quota: plan.quota,
    totalOnAccount: plan.totalOnAccount,
    rawTx: openResult.tx,
    routerAmount: openPath.amount,
    routerMinAmount: openPath.minAmount,
  }
}
