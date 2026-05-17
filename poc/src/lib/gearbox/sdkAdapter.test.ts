import { describe, expect, it, vi } from 'vitest'
import { prepareOpenStrategyTx } from './sdkAdapter'

const BORROWER = '0x000000000000000000000000000000000000b0b0'
const USDC = '0x00000000000000000000000000000000000000c1'
const TARGET = '0x00000000000000000000000000000000000000a1'
const CM = '0x0000000000000000000000000000000000000cda'
const FACADE = '0x0000000000000000000000000000000000000fac'
const BOT = '0x0000000000000000000000000000000000000b07'
const APPROVAL = '0x0000000000000000000000000000000000000a99'

describe('Gearbox SDK adapter', () => {
  it('builds the approve target, router path, open multicall, and bot call from SDK primitives', async () => {
    const routerCalls = [{ target: '0x0000000000000000000000000000000000000111', callData: '0x1234' }]
    const botCalls = [{ target: FACADE, callData: '0xbeef' }]
    const rawTx = { to: FACADE, callData: '0xcafe', value: '0' }

    const findCreditManager = vi.fn(() => ({
      underlying: USDC,
      creditManager: {
        address: CM,
        creditFacade: FACADE,
        collateralTokens: [USDC, TARGET],
      },
      creditFacade: { address: FACADE, minDebt: 1_000_000_000n, maxDebt: 10_000_000_000n },
    }))
    const findOpenStrategyPath = vi.fn(async () => ({
      amount: 3_500_000_000n,
      minAmount: 3_482_500_000n,
      calls: routerCalls,
      balances: { [TARGET]: 3_500_000_000n },
      minBalances: { [TARGET]: 3_482_500_000n },
    }))
    const getApprovalAddress = vi.fn(async () => APPROVAL)
    const setBot = vi.fn(async () => ({ calls: botCalls }))
    const openCA = vi.fn(async () => ({ tx: rawTx, calls: [...routerCalls, ...botCalls], creditFacade: FACADE }))

    const sdk = {
      marketRegister: { findCreditManager },
      routerFor: vi.fn(() => ({ findOpenStrategyPath })),
      accounts: { getApprovalAddress, setBot, openCA },
    }

    const result = await prepareOpenStrategyTx({
      sdk,
      borrower: BORROWER,
      creditManager: CM,
      collateralToken: USDC,
      targetToken: TARGET,
      collateralAmount: 1_000_000_000n,
      leverage: 350n,
      quotaReserveBps: 500n,
      slippageBps: 50,
      botAddress: BOT,
      referralCode: 0n,
    })

    expect(result).toEqual({
      approvalTarget: APPROVAL,
      debt: 2_500_000_000n,
      quota: 2_625_000_000n,
      totalOnAccount: 3_500_000_000n,
      rawTx,
      routerAmount: 3_500_000_000n,
      routerMinAmount: 3_482_500_000n,
    })

    expect(getApprovalAddress).toHaveBeenCalledWith({
      creditManager: CM,
      borrower: BORROWER,
    })
    expect(findOpenStrategyPath).toHaveBeenCalledWith({
      creditManager: {
        address: CM,
        creditFacade: FACADE,
        collateralTokens: [USDC, TARGET],
      },
      expectedBalances: [{ token: USDC, balance: 3_500_000_000n }],
      leftoverBalances: [{ token: USDC, balance: 1n }],
      slippage: 50,
      target: TARGET,
    })
    expect(setBot).toHaveBeenCalledWith({
      botAddress: BOT,
      permissions: null,
      targetContract: {
        type: 'creditManager',
        creditManager: CM,
        creditFacade: FACADE,
      },
    })
    expect(openCA).toHaveBeenCalledWith({
      averageQuota: [{ token: TARGET, balance: 2_625_000_000n }],
      calls: routerCalls,
      callsAfter: botCalls,
      collateral: [{ token: USDC, balance: 1_000_000_000n }],
      creditManager: CM,
      debt: 2_500_000_000n,
      ethAmount: 0n,
      minQuota: [{ token: TARGET, balance: 2_625_000_000n }],
      permits: {},
      referralCode: 0n,
      to: BORROWER,
    })
  })

  it('rejects routes that would borrow below the credit facade min debt before opening a wallet prompt', async () => {
    const findCreditManager = vi.fn(() => ({
      underlying: USDC,
      creditManager: {
        address: CM,
        creditFacade: FACADE,
        collateralTokens: [USDC, TARGET],
      },
      creditFacade: { address: FACADE, minDebt: 10_000_000_000n, maxDebt: 100_000_000_000n },
    }))
    const sdk = {
      marketRegister: { findCreditManager },
      routerFor: vi.fn(() => ({ findOpenStrategyPath: vi.fn() })),
      accounts: {
        getApprovalAddress: vi.fn(),
        setBot: vi.fn(),
        openCA: vi.fn(),
      },
    }

    await expect(prepareOpenStrategyTx({
      sdk,
      borrower: BORROWER,
      creditManager: CM,
      collateralToken: USDC,
      targetToken: TARGET,
      collateralAmount: 1_100_000_000n,
      leverage: 925n,
      quotaReserveBps: 500n,
      slippageBps: 50,
      referralCode: 0n,
    })).rejects.toThrow('Borrow amount is below the minimum debt for this route.')

    expect(sdk.accounts.getApprovalAddress).not.toHaveBeenCalled()
    expect(sdk.accounts.openCA).not.toHaveBeenCalled()
  })
})
