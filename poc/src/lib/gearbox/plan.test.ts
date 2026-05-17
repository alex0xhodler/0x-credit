import { describe, expect, it } from 'vitest'
import {
  calculateApyForLeverage,
  calculateLeverageForTargetHealthFactor,
  calculateLoopPlan,
  calculateMinimumCollateralForDebt,
  createExecutionSteps,
  formatOpportunityApy,
  markStepActive,
  markStepDone,
} from './plan'

describe('Gearbox planning helpers', () => {
  it('solves leverage from liquidation threshold and target health factor', () => {
    expect(calculateLeverageForTargetHealthFactor({
      liquidationThresholdBps: 9200n,
      maxLeverage: 1186n,
      targetHealthFactorBps: 10_300n,
    })).toBe(936n)
    expect(calculateLeverageForTargetHealthFactor({
      liquidationThresholdBps: 9200n,
      maxLeverage: 1186n,
      targetHealthFactorBps: 10_315n,
    })).toBe(925n)
    expect(calculateLeverageForTargetHealthFactor({
      liquidationThresholdBps: 9200n,
      maxLeverage: 900n,
      targetHealthFactorBps: 10_300n,
    })).toBe(900n)
    expect(calculateLeverageForTargetHealthFactor({
      liquidationThresholdBps: 9200n,
      maxLeverage: 100n,
      targetHealthFactorBps: 10_300n,
    })).toBe(100n)
  })

  it('formats live APY as an opportunity headline', () => {
    expect(formatOpportunityApy(425_670)).toBe('up to 42.57% APY')
    expect(formatOpportunityApy(undefined)).toBe('APY loading')
  })

  it('calculates displayed APY from the same leverage used for execution', () => {
    expect(calculateApyForLeverage({
      collateralApy: 64_974,
      leverage: 925n,
      baseRateWithFee: 52_322,
      quotaRateWithFee: 120,
    })).toBe(168_243)
  })

  it('calculates debt and quota from a max-leverage sweet spot', () => {
    const result = calculateLoopPlan({
      collateralAmount: 1_000_000_000n,
      leverage: 350n,
      quotaReserveBps: 500n,
    })

    expect(result).toEqual({
      collateralAmount: 1_000_000_000n,
      debt: 2_500_000_000n,
      totalOnAccount: 3_500_000_000n,
      quota: 2_625_000_000n,
      leverageMultiple: 3.5,
    })
  })

  it('calculates the minimum collateral needed to satisfy min debt at the selected leverage', () => {
    expect(calculateMinimumCollateralForDebt({
      minDebt: 10_000_000_000n,
      leverage: 925n,
    })).toBe(1_212_121_213n)
  })

  it('shows approval as an explicit same-page wallet step when allowance is missing', () => {
    const steps = createExecutionSteps({
      allowance: 10n,
      amount: 50n,
      canBatch: false,
      symbol: 'USDC',
    })

    expect(steps.map(step => step.label)).toEqual([
      'Approve USDC',
      'Open credit account',
    ])
    expect(steps[0].walletPrompt).toBe('Confirm the token approval without leaving this page.')
    expect(steps[1].walletPrompt).toBe('Confirm the account opening in your wallet.')
  })

  it('skips approval when allowance already covers the deposit amount', () => {
    const steps = createExecutionSteps({
      allowance: 50n,
      amount: 50n,
      canBatch: false,
      symbol: 'USDC',
    })

    expect(steps.map(step => step.id)).toEqual(['account'])
  })

  it('keeps approve and open visible even when wallet batching is available', () => {
    const steps = createExecutionSteps({
      allowance: 0n,
      amount: 50n,
      canBatch: true,
      symbol: 'USDC',
    })

    expect(steps[0].mode).toBe('batchable')
    expect(steps[1].label).toBe('Open credit account')
  })

  it('updates step state without mutating the original list', () => {
    const steps = createExecutionSteps({
      allowance: 0n,
      amount: 50n,
      canBatch: false,
      symbol: 'USDC',
    })

    const active = markStepActive(steps, 'approve')
    const done = markStepDone(active, 'approve', '0xabc')

    expect(steps[0].status).toBe('idle')
    expect(active[0].status).toBe('active')
    expect(done[0]).toMatchObject({ status: 'done', txHash: '0xabc' })
  })
})
