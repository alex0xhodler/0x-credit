export type ExecutionStepId = 'approve' | 'account'
export type ExecutionStepStatus = 'idle' | 'active' | 'done' | 'error'
export type ExecutionStepMode = 'separate' | 'batchable' | 'background' | 'multicall'

export interface ExecutionStep {
  id: ExecutionStepId
  label: string
  detail: string
  mode: ExecutionStepMode
  status: ExecutionStepStatus
  walletPrompt?: string
  txHash?: string
  error?: string
}

export interface LoopPlanInput {
  collateralAmount: bigint
  leverage: bigint
  quotaReserveBps: bigint
}

export interface LoopPlan {
  collateralAmount: bigint
  debt: bigint
  totalOnAccount: bigint
  quota: bigint
  leverageMultiple: number
}

export interface CalculateApyForLeverageInput {
  collateralApy: number
  leverage: bigint
  baseRateWithFee: number
  quotaRateWithFee: number
  bonusApy?: number
}

export function calculateLeverageForTargetHealthFactor({
  liquidationThresholdBps,
  maxLeverage,
  targetHealthFactorBps,
}: {
  liquidationThresholdBps: bigint
  maxLeverage: bigint
  targetHealthFactorBps: bigint
}): bigint {
  const leverageBase = 100n
  if (maxLeverage <= leverageBase) return maxLeverage
  if (targetHealthFactorBps <= liquidationThresholdBps) return maxLeverage

  const targetLeverage = (targetHealthFactorBps * leverageBase) / (targetHealthFactorBps - liquidationThresholdBps)
  const clamped = targetLeverage > maxLeverage ? maxLeverage : targetLeverage

  return clamped < leverageBase ? leverageBase : clamped
}

export function calculateApyForLeverage({
  collateralApy,
  leverage,
  baseRateWithFee,
  quotaRateWithFee,
  bonusApy = 0,
}: CalculateApyForLeverageInput): number {
  const leverageBase = 100n
  const leverageFactor = leverage > leverageBase ? leverage - leverageBase : 0n
  const collateralTerm = collateralApy - quotaRateWithFee
  const debtTerm = Math.floor(
    ((collateralApy - baseRateWithFee - quotaRateWithFee) * Number(leverageFactor)) /
      Number(leverageBase),
  )
  const bonusTerm = Math.floor((bonusApy * Number(leverage)) / Number(leverageBase))

  return collateralTerm + debtTerm + bonusTerm
}

export function formatOpportunityApy(maxApy: number | undefined): string {
  if (maxApy === undefined || Number.isNaN(maxApy)) return 'APY loading'
  return `Current APY ${(maxApy / 10_000).toFixed(2)}%`
}

export function calculateLoopPlan({
  collateralAmount,
  leverage,
  quotaReserveBps,
}: LoopPlanInput): LoopPlan {
  const leverageBase = 100n
  const leverageDelta = leverage > leverageBase ? leverage - leverageBase : 0n
  const debt = (collateralAmount * leverageDelta) / leverageBase
  const totalOnAccount = collateralAmount + debt
  const quota = (debt * (10_000n + quotaReserveBps)) / 10_000n

  return {
    collateralAmount,
    debt,
    totalOnAccount,
    quota,
    leverageMultiple: Number(leverage) / Number(leverageBase),
  }
}

export function calculateMinimumCollateralForDebt({
  minDebt,
  leverage,
}: {
  minDebt: bigint
  leverage: bigint
}): bigint {
  const leverageBase = 100n
  const leverageDelta = leverage > leverageBase ? leverage - leverageBase : 0n
  if (minDebt <= 0n) return 0n
  if (leverageDelta === 0n) return minDebt

  return (minDebt * leverageBase + leverageDelta - 1n) / leverageDelta
}

export interface CreateExecutionStepsInput {
  allowance: bigint
  amount: bigint
  canBatch: boolean
  symbol: string
}

export function createExecutionSteps({
  allowance,
  amount,
  canBatch,
  symbol,
}: CreateExecutionStepsInput): ExecutionStep[] {
  const needsApproval = amount > 0n && allowance < amount
  const steps: ExecutionStep[] = []

  if (needsApproval) {
    steps.push({
      id: 'approve',
      label: `Approve ${symbol}`,
      detail: canBatch
        ? 'Your wallet may bundle this approval with the deposit.'
        : 'Required once before the deposit can move.',
      walletPrompt: 'Confirm the token approval without leaving this page.',
      mode: canBatch ? 'batchable' : 'separate',
      status: 'idle',
    })
  }

  steps.push(
    {
      id: 'account',
      label: 'Open credit account',
      detail: `Opening with the approved ${symbol}. Your deposit is supplied inside this wallet action.`,
      walletPrompt: 'Confirm the account opening in your wallet.',
      mode: 'multicall',
      status: 'idle',
    },
  )

  return steps
}

export function markStepActive(steps: ExecutionStep[], id: ExecutionStepId): ExecutionStep[] {
  return steps.map(step => (step.id === id ? { ...step, status: 'active' } : step))
}

export function markStepDone(
  steps: ExecutionStep[],
  id: ExecutionStepId,
  txHash?: string,
): ExecutionStep[] {
  return steps.map(step => (step.id === id ? { ...step, status: 'done', txHash } : step))
}

export function markStepError(
  steps: ExecutionStep[],
  id: ExecutionStepId,
  error: string,
): ExecutionStep[] {
  return steps.map(step => (step.id === id ? { ...step, status: 'error', error } : step))
}
