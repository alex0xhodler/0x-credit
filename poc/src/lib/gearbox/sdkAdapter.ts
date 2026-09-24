import type { MultiCall, OpenCAProps, RawTx, SetBotProps } from '@gearbox-protocol/sdk/onchain'
import type { Address } from 'viem'
import { calculateLoopPlan } from './plan'

interface CreditManagerSuiteLike {
  creditManager: {
    address: Address
    creditFacade: Address
    collateralTokens: Address[]
  }
  creditFacade: {
    address: Address
    minDebt?: bigint
    maxDebt?: bigint
  }
}

interface MarketRegisterLike {
  findCreditManager(creditManager: Address): CreditManagerSuiteLike
}

interface RouterLike {
  findOpenStrategyPath(args: {
    creditManager: CreditManagerSuiteLike['creditManager']
    expectedBalances: Array<{ token: Address; balance: bigint }>
    leftoverBalances: Array<{ token: Address; balance: bigint }>
    slippage: number
    target: Address
  }): Promise<{
    amount: bigint
    minAmount: bigint
    calls: MultiCall[]
  }>
}

interface AccountsLike {
  getApprovalAddress(args: {
    creditManager: Address
    borrower: Address
  }): Promise<Address>
  // Moved in SDK v17: bots are set via accounts.bots.setBot, not accounts.setBot.
  // Setting a bot on a credit manager (rather than an existing credit
  // account) yields calls only, no standalone transaction.
  bots: {
    setBot(args: SetBotProps): Promise<{ calls: MultiCall[] }>
  }
  // v17: openCA returns the RawTx directly (v14 returned `{ tx: RawTx }`).
  openCA(args: OpenCAProps): Promise<RawTx>
}

export interface PrepareOpenStrategySdk {
  marketRegister: MarketRegisterLike
  routerFor(params: unknown): RouterLike
  accounts: AccountsLike
}

export interface PrepareOpenStrategyInput {
  sdk: PrepareOpenStrategySdk
  borrower: Address
  creditManager: Address
  collateralToken: Address
  targetToken: Address
  collateralAmount: bigint
  leverage: bigint
  quotaReserveBps: bigint
  slippageBps: number
  botAddress?: Address
  referralCode: bigint
}

export interface PreparedOpenStrategyTx {
  approvalTarget: Address
  debt: bigint
  quota: bigint
  totalOnAccount: bigint
  rawTx: RawTx
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

  const cmSuite = sdk.marketRegister.findCreditManager(creditManager)
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
    sdk.accounts.getApprovalAddress({
      creditManager: cmAddress,
      borrower,
    }),
    sdk.routerFor(cmSuite).findOpenStrategyPath({
      creditManager: cmSuite.creditManager,
      expectedBalances: [{ token: collateralToken, balance: plan.totalOnAccount }],
      leftoverBalances: [{ token: collateralToken, balance: 1n }],
      slippage: slippageBps,
      target: targetToken,
    }),
    botAddress
      ? sdk.accounts.bots.setBot({
          botAddress,
          permissions: null,
          targetContract: {
            type: 'creditManager',
            creditManager: cmAddress,
            creditFacade,
          },
        })
      : Promise.resolve({ calls: [] as MultiCall[] }),
  ])

  const rawTx = await sdk.accounts.openCA({
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
    rawTx,
    routerAmount: openPath.amount,
    routerMinAmount: openPath.minAmount,
  }
}
