import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createAppKit, useAppKit } from '@reown/appkit/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  erc20Abi,
  encodeFunctionData,
  maxUint256,
  type Address,
  type Hex,
} from 'viem'
import {
  useAccount,
  useCapabilities,
  useChainId,
  usePublicClient,
  useReadContract,
  useSendCalls,
  useSendTransaction,
  useSwitchChain,
  useWriteContract,
  WagmiProvider,
} from 'wagmi'
import './App.css'
import { TransactionCockpit, type OpportunityView } from './TransactionCockpit'
import {
  config,
  isReownProjectConfigured,
  metadata,
  networks,
  projectId,
  wagmiAdapter,
} from './config'
import { formatTokenAmount, parseTokenAmount } from './lib/gearbox/amounts'
import {
  createExecutionSteps,
  formatOpportunityApy,
  markStepActive,
  markStepDone,
  markStepError,
  type ExecutionStep,
} from './lib/gearbox/plan'
import {
  DEFAULT_QUOTA_RESERVE_BPS,
  DEFAULT_SLIPPAGE_BPS,
  type GearboxCreditManagerRoute,
  loadGearboxOpportunity,
  MONAD_CHAIN_ID,
  selectBestCreditManagerForAmount,
  STRATEGY_ID,
  type LoadedGearboxOpportunity,
} from './lib/gearbox/live'
import { prepareOpenStrategyTx } from './lib/gearbox/sdkAdapter'
import { assertSuccessfulReceipt, formatTransactionError } from './lib/gearbox/transactions'

const queryClient = new QueryClient()
const GEARBOX_DASHBOARD_URL = 'https://app.gearbox.finance/dashboard'
const MONAD_USDC_OPPORTUNITY_ID = 'monad-usdc-ausdct0'
const MAINNET_WETH_OPPORTUNITY_ID = 'mainnet-weth-wmoo-curve-eth-weth'

const MAINNET_WETH_OPPORTUNITY: OpportunityView = {
  id: MAINNET_WETH_OPPORTUNITY_ID,
  strategyId: 'wmooCurveETH+-WETH',
  strategyName: 'WMoo Curve ETH+-WETH',
  tokenSymbol: 'WETH',
  chainName: 'Ethereum',
  apyLabel: 'Current APY 14.08%',
  leverageLabel: '7.60x target',
  protectionLabel: 'Mainnet strategy',
  minDepositLabel: 'Min deposit: 1.5 WETH',
  isExecutable: false,
  disabledReason: 'Ethereum execution is not wired in this PoC yet.',
}

interface StoredOpenPosition {
  address: Address
  creditManager: Address
  strategyId: string
  txHash?: Hex
}

interface CreditAccountSnapshotLike {
  creditManager: Address
  debt: bigint
  totalValue?: bigint
  tokens?: readonly { balance: bigint }[]
}

function openPositionStorageKey(address: Address, strategyId: string): string {
  return `gearbox-open-position:${address.toLowerCase()}:${strategyId}`
}

function hasStoredOpenPosition(address: Address | undefined, strategyId: string): boolean {
  if (!address || typeof localStorage === 'undefined') return false
  return localStorage.getItem(openPositionStorageKey(address, strategyId)) !== null
}

function storeOpenPosition(position: StoredOpenPosition) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(openPositionStorageKey(position.address, position.strategyId), JSON.stringify(position))
}

function clearStoredOpenPosition(address: Address, strategyId: string) {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(openPositionStorageKey(address, strategyId))
}

function creditAccountHasFunds(account: CreditAccountSnapshotLike, creditManager: Address): boolean {
  if (account.creditManager.toLowerCase() !== creditManager.toLowerCase()) return false
  if (account.debt > 0n) return true
  if ((account.totalValue ?? 0n) > 0n) return true
  return account.tokens?.some(token => token.balance > 0n) ?? false
}

createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks,
  metadata,
  enableReconnect: false,
  themeMode: 'light',
  themeVariables: {
    '--w3m-accent': '#ff6b35',
  },
  features: {
    analytics: false,
  },
})

function supportsAtomicBatch(capabilities: unknown): boolean {
  if (!capabilities || typeof capabilities !== 'object') return false
  const record = capabilities as Record<string, unknown>
  const chainCapabilities = record[MONAD_CHAIN_ID] ?? record[String(MONAD_CHAIN_ID)]
  if (!chainCapabilities || typeof chainCapabilities !== 'object') return false
  const chainRecord = chainCapabilities as Record<string, unknown>
  const atomic = chainRecord.atomicBatch ?? chainRecord.atomic
  if (atomic === true) return true
  if (!atomic || typeof atomic !== 'object') return false
  const atomicRecord = atomic as Record<string, unknown>
  return atomicRecord.supported === true || atomicRecord.status === 'supported'
}

function baseOpportunityView(
  opportunity: LoadedGearboxOpportunity | undefined,
  selectedRoute: GearboxCreditManagerRoute | undefined,
): OpportunityView {
  const apyLabel = selectedRoute
    ? formatOpportunityApy(selectedRoute.apy)
    : opportunity?.apyLabel || 'APY loading'
  const leverageLabel = selectedRoute
    ? `${(Number(selectedRoute.maxLeverage) / 100).toFixed(2)}x target`
    : opportunity?.leverageLabel || 'sweet spot loading'

  return {
    id: MONAD_USDC_OPPORTUNITY_ID,
    strategyId: STRATEGY_ID,
    strategyName: opportunity?.strategyName || 'Curve AUSD/USDC/USDT0',
    tokenSymbol: opportunity?.collateralSymbol || 'USDC',
    chainName: 'Monad',
    apyLabel,
    leverageLabel,
    protectionLabel: opportunity?.botAddress ? 'Deleverage bot included' : 'Protection bot discovery pending',
  }
}

function minimumDepositMessage(
  opportunity: LoadedGearboxOpportunity,
  minimumDepositAmount: bigint,
): string {
  return `Enter at least ${formatTokenAmount(
    minimumDepositAmount,
    opportunity.collateralDecimals,
  )} ${opportunity.collateralSymbol} to keep this strategy above 1.03 HF and the strategy minimum debt.`
}

function GearboxApp() {
  const { open } = useAppKit()
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const publicClient = usePublicClient()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const { sendTransactionAsync } = useSendTransaction()
  const { sendCallsAsync } = useSendCalls()
  const capabilities = useCapabilities({
    query: {
      enabled: isConnected,
    },
  })

  const [amount, setAmount] = useState('1000')
  const [opportunity, setOpportunity] = useState<LoadedGearboxOpportunity>()
  const [loadError, setLoadError] = useState<string>()
  const [executionError, setExecutionError] = useState<string>()
  const [isExecuting, setIsExecuting] = useState(false)
  const [steps, setSteps] = useState<ExecutionStep[]>([])
  const [approvalTarget, setApprovalTarget] = useState<Address>()
  const [hasOpenPosition, setHasOpenPosition] = useState(false)
  const [hasStartedFlow, setHasStartedFlow] = useState(false)
  const [pendingStartAfterConnect, setPendingStartAfterConnect] = useState(false)
  const [selectedOpportunityId, setSelectedOpportunityId] = useState(MONAD_USDC_OPPORTUNITY_ID)
  const checkedOpenPositionKeys = useRef(new Set<string>())
  const selectedOpportunityIsExecutable = selectedOpportunityId === MONAD_USDC_OPPORTUNITY_ID

  const amountRaw = useMemo(
    () => parseTokenAmount(amount, opportunity?.collateralDecimals || 6),
    [amount, opportunity?.collateralDecimals],
  )
  const selectedRoute = useMemo(
    () => opportunity
      ? selectBestCreditManagerForAmount(opportunity.creditManagers, amountRaw)
      : undefined,
    [amountRaw, opportunity],
  )
  const canBatch = supportsAtomicBatch(capabilities.data)
  const routeWarning = useMemo(() => {
    if (!opportunity || !amountRaw || selectedRoute) return undefined

    const lowestMinimumDeposit = opportunity.creditManagers.reduce<bigint | undefined>(
      (lowest, route) => lowest === undefined || route.minimumDepositAmount < lowest
        ? route.minimumDepositAmount
        : lowest,
      undefined,
    )
    if (lowestMinimumDeposit !== undefined && amountRaw < lowestMinimumDeposit) {
      return minimumDepositMessage(opportunity, lowestMinimumDeposit)
    }
    return 'This amount is outside the current debt limits for this strategy.'
  }, [amountRaw, opportunity, selectedRoute])

  useEffect(() => {
    setHasOpenPosition(hasStoredOpenPosition(address, STRATEGY_ID))
  }, [address])

  useEffect(() => {
    let cancelled = false

    loadGearboxOpportunity()
      .then(nextOpportunity => {
        if (cancelled) return
        setOpportunity(nextOpportunity)
        setLoadError(undefined)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(error instanceof Error ? error.message : 'Failed to load this opportunity.')
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    if (!opportunity || !address || !selectedRoute) {
      setApprovalTarget(undefined)
      return
    }

    opportunity.sdk.accounts
      .getApprovalAddress({
        creditManager: selectedRoute.address,
        borrower: address,
      })
      .then(target => {
        if (!cancelled) setApprovalTarget(target as Address)
      })
      .catch(() => {
        if (!cancelled) setApprovalTarget(undefined)
      })

    return () => {
      cancelled = true
    }
  }, [address, opportunity, selectedRoute])

  useEffect(() => {
    let cancelled = false

    if (!address || !opportunity || !selectedRoute) return

    const key = `${openPositionStorageKey(address, opportunity.strategyId)}:${selectedRoute.address.toLowerCase()}`
    if (checkedOpenPositionKeys.current.has(key)) return
    checkedOpenPositionKeys.current.add(key)

    opportunity.sdk.accounts
      .getBorrowerCreditAccounts(address, {
        creditManager: selectedRoute.address,
        includeZeroDebt: false,
      })
      .then(accounts => {
        if (cancelled) return
        const stillOpen = (accounts as CreditAccountSnapshotLike[]).some(account =>
          creditAccountHasFunds(account, selectedRoute.address),
        )
        setHasOpenPosition(stillOpen)
        if (stillOpen) {
          storeOpenPosition({
            address,
            creditManager: selectedRoute.address,
            strategyId: opportunity.strategyId,
          })
        } else {
          clearStoredOpenPosition(address, opportunity.strategyId)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [address, opportunity, selectedRoute])

  const allowance = useReadContract({
    address: opportunity?.collateralToken,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && approvalTarget ? [address, approvalTarget] : undefined,
    query: {
      enabled: Boolean(address && approvalTarget && opportunity?.collateralToken),
    },
  })

  useEffect(() => {
    if (isExecuting) return
    if (!amountRaw || !opportunity) {
      setSteps([])
      return
    }

    setSteps(
      createExecutionSteps({
        allowance: allowance.data ?? 0n,
        amount: amountRaw,
        canBatch,
        symbol: opportunity.collateralSymbol,
      }),
    )
  }, [allowance.data, amountRaw, canBatch, isExecuting, opportunity])

  const runSequentialApproval = useCallback(
    async (currentSteps: ExecutionStep[], token: Address, target: Address, depositAmount: bigint) => {
      let nextSteps = markStepActive(currentSteps, 'approve')
      setSteps(nextSteps)
      const approvalHash = await writeContractAsync({
        address: token,
        abi: erc20Abi,
        functionName: 'approve',
        args: [target, depositAmount],
      })
      const approvalReceipt = await publicClient?.waitForTransactionReceipt({ hash: approvalHash })
      assertSuccessfulReceipt(approvalReceipt, 'USDC approval failed on-chain.')
      nextSteps = markStepDone(nextSteps, 'approve', approvalHash)
      setSteps(nextSteps)
      await allowance.refetch()
      return nextSteps
    },
    [allowance, publicClient, writeContractAsync],
  )

  const handleExecute = useCallback(async () => {
    if (!selectedOpportunityIsExecutable || !opportunity || !address || !amountRaw || !selectedRoute) return
    setHasStartedFlow(true)
    setPendingStartAfterConnect(false)
    if (routeWarning) {
      setExecutionError(routeWarning)
      return
    }

    setIsExecuting(true)
    setExecutionError(undefined)

    let nextSteps = createExecutionSteps({
      allowance: allowance.data ?? 0n,
      amount: amountRaw,
      canBatch,
      symbol: opportunity.collateralSymbol,
    })
    setSteps(nextSteps)

    try {
      if (!publicClient) throw new Error('Wallet public client is not ready.')
      if (chainId !== MONAD_CHAIN_ID) {
        await switchChainAsync({ chainId: MONAD_CHAIN_ID })
      }

      const prepared = await prepareOpenStrategyTx({
        sdk: opportunity.sdk,
        borrower: address,
        creditManager: selectedRoute.address,
        collateralToken: opportunity.collateralToken,
        targetToken: opportunity.targetToken,
        collateralAmount: amountRaw,
        leverage: selectedRoute.maxLeverage,
        quotaReserveBps: DEFAULT_QUOTA_RESERVE_BPS,
        slippageBps: DEFAULT_SLIPPAGE_BPS,
        botAddress: opportunity.botAddress,
        referralCode: 0n,
      })

      const needsApproval = (allowance.data ?? 0n) < amountRaw
      const approveData = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [prepared.approvalTarget as Address, maxUint256],
      })

      if (needsApproval && canBatch) {
        nextSteps = markStepActive(markStepActive(nextSteps, 'approve'), 'account')
        setSteps(nextSteps)
        const batch = await sendCallsAsync({
          chainId: MONAD_CHAIN_ID,
          calls: [
            {
              to: opportunity.collateralToken,
              data: approveData,
            },
            {
              to: prepared.rawTx.to as Address,
              data: prepared.rawTx.callData as Hex,
              value: BigInt(prepared.rawTx.value),
            },
          ],
        })
        const batchId = batch.id ? `batch:${batch.id}` : undefined
        nextSteps = markStepDone(markStepDone(nextSteps, 'approve', batchId), 'account', batchId)
        setSteps(nextSteps)
        return
      }

      if (needsApproval) {
        nextSteps = await runSequentialApproval(
          nextSteps,
          opportunity.collateralToken,
          prepared.approvalTarget as Address,
          amountRaw,
        )
      }

      nextSteps = markStepActive(nextSteps, 'account')
      setSteps(nextSteps)
      const openHash = await sendTransactionAsync({
        to: prepared.rawTx.to as Address,
        data: prepared.rawTx.callData as Hex,
        value: BigInt(prepared.rawTx.value),
      })
      const openReceipt = await publicClient.waitForTransactionReceipt({ hash: openHash })
      assertSuccessfulReceipt(openReceipt, 'Opening position failed on-chain.')
      nextSteps = markStepDone(nextSteps, 'account', openHash)
      setSteps(nextSteps)
      storeOpenPosition({
        address,
        creditManager: selectedRoute.address,
        strategyId: opportunity.strategyId,
        txHash: openHash,
      })
      setHasOpenPosition(true)
    } catch (error: unknown) {
      const message = formatTransactionError(error)
      const failedStep = nextSteps.find(step => step.status === 'active')?.id || 'account'
      setSteps(markStepError(nextSteps, failedStep, message))
      setExecutionError(message)
    } finally {
      setIsExecuting(false)
    }
  }, [
    address,
    allowance.data,
    amountRaw,
    canBatch,
    chainId,
    opportunity,
    publicClient,
    runSequentialApproval,
    routeWarning,
    selectedOpportunityIsExecutable,
    selectedRoute,
    sendCallsAsync,
    sendTransactionAsync,
    switchChainAsync,
  ])

  useEffect(() => {
    if (!pendingStartAfterConnect || !isConnected || isExecuting || !selectedOpportunityIsExecutable) return
    if (!opportunity || !selectedRoute || !amountRaw || routeWarning) return
    void handleExecute()
  }, [
    amountRaw,
    handleExecute,
    isConnected,
    isExecuting,
    opportunity,
    pendingStartAfterConnect,
    routeWarning,
    selectedRoute,
    selectedOpportunityIsExecutable,
  ])

  const monadOpportunityView = baseOpportunityView(opportunity, selectedRoute)
  const displayedOpportunity = selectedOpportunityId === MAINNET_WETH_OPPORTUNITY_ID
    ? MAINNET_WETH_OPPORTUNITY
    : monadOpportunityView
  const opportunityViews = [monadOpportunityView, MAINNET_WETH_OPPORTUNITY]
  const displayedRouteWarning = displayedOpportunity.isExecutable === false
    ? displayedOpportunity.disabledReason
    : routeWarning

  return (
    <TransactionCockpit
      amount={amount}
      accountStatus={isConnected ? 'connected' : 'disconnected'}
      error={executionError || loadError}
      hasStartedFlow={hasStartedFlow}
      isBusy={isExecuting}
      isProjectReady={isReownProjectConfigured}
      opportunity={displayedOpportunity}
      opportunities={opportunityViews}
      manageUrl={hasOpenPosition && selectedOpportunityIsExecutable ? GEARBOX_DASHBOARD_URL : undefined}
      routeWarning={displayedRouteWarning}
      steps={selectedOpportunityIsExecutable ? steps : []}
      onAmountChange={setAmount}
      onConnect={() => {
        setHasStartedFlow(true)
        if (displayedRouteWarning) {
          setExecutionError(displayedRouteWarning)
          return
        }
        setPendingStartAfterConnect(true)
        if (isReownProjectConfigured) void open()
      }}
      onExecute={handleExecute}
      onSelectOpportunity={nextOpportunity => {
        setExecutionError(undefined)
        setSelectedOpportunityId(nextOpportunity.id)
        setHasStartedFlow(true)
        if (nextOpportunity.id === MAINNET_WETH_OPPORTUNITY_ID) setAmount('1.5')
        if (nextOpportunity.id === MONAD_USDC_OPPORTUNITY_ID && !amount) setAmount('1000')
      }}
      onResetFlow={() => setHasStartedFlow(false)}
    />
  )
}

export function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <GearboxApp />
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export default App
