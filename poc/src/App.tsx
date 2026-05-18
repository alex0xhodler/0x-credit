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
import { TransactionCockpit, type OpportunityView, type ActivePositionStats } from './TransactionCockpit'
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
  creditAccount: Address
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

function creditAccountHasFunds(account: CreditAccountSnapshotLike, validCreditManagers: Address[]): boolean {
  const isMatch = validCreditManagers.some(cm => cm.toLowerCase() === account.creditManager.toLowerCase())
  if (!isMatch) return false
  if (account.debt > 0n) return true
  if ((account.totalValue ?? 0n) > 0n) return true
  return account.tokens?.some(token => token.balance > 0n) ?? false
}

createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks,
  metadata,
  enableReconnect: true,
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
  const [activeCreditAccount, setActiveCreditAccount] = useState<CreditAccountSnapshotLike>()
  const [hasStartedFlow, setHasStartedFlow] = useState(false)
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string>(MONAD_USDC_OPPORTUNITY_ID)
  const [forceNewAccount, setForceNewAccount] = useState(false)
  const checkedOpenPositionKeys = useRef(new Set<string>())
  
  const selectedOpportunityIsExecutable = selectedOpportunityId !== MAINNET_WETH_OPPORTUNITY_ID

  const opportunityViews = useMemo(() => {
    const views: OpportunityView[] = []
    if (opportunity) {
      const sortedRoutes = [...opportunity.creditManagers]
        .filter(route => route.maxDebt > 0n)
        .sort((a, b) => {
          if (a.maxDebt !== b.maxDebt) return a.maxDebt > b.maxDebt ? -1 : 1
          return 0
        })

      sortedRoutes.forEach(route => {
        views.push({
          id: `monad-${route.address}`,
          strategyId: STRATEGY_ID,
          strategyName: opportunity.strategyName,
          tokenSymbol: route.collateralSymbol,
          chainName: 'Monad',
          apyLabel: formatOpportunityApy(route.apy),
          leverageLabel: `${(Number(route.maxLeverage) / 100).toFixed(2)}x target`,
          protectionLabel: opportunity.botAddress ? 'Deleverage bot included' : 'Protection bot discovery pending',
          minDepositLabel: `Min deposit: ${formatTokenAmount(route.minimumDepositAmount, route.collateralDecimals)} ${route.collateralSymbol}`,
        })
      })
    } else {
      views.push(baseOpportunityView(undefined, undefined))
    }
    views.push(MAINNET_WETH_OPPORTUNITY)
    return views
  }, [opportunity])

  useEffect(() => {
    if (opportunity && selectedOpportunityId === MONAD_USDC_OPPORTUNITY_ID) {
      const firstMonad = opportunityViews.find(v => v.id.startsWith('monad-'))
      if (firstMonad) {
        setSelectedOpportunityId(firstMonad.id)
      }
    }
  }, [opportunity, opportunityViews, selectedOpportunityId])

  const displayedOpportunity = useMemo(() => {
    return opportunityViews.find(v => v.id === selectedOpportunityId) || opportunityViews[0]
  }, [opportunityViews, selectedOpportunityId])

  const selectedRoute = useMemo(() => {
    if (!opportunity || !selectedOpportunityId || !selectedOpportunityId.startsWith('monad-')) return undefined
    const routeAddress = selectedOpportunityId.replace('monad-', '')
    return opportunity.creditManagers.find(cm => cm.address === routeAddress)
  }, [opportunity, selectedOpportunityId])

  const amountRaw = useMemo(
    () => parseTokenAmount(amount, selectedRoute?.collateralDecimals || opportunity?.collateralDecimals || 6),
    [amount, selectedRoute?.collateralDecimals, opportunity?.collateralDecimals],
  )
  const canBatch = supportsAtomicBatch(capabilities.data)
  
  const routeWarning = useMemo(() => {
    if (!opportunity || !amountRaw || !selectedRoute) return undefined

    if (amountRaw < selectedRoute.minimumDepositAmount) {
      return `Enter at least ${formatTokenAmount(selectedRoute.minimumDepositAmount, selectedRoute.collateralDecimals)} ${selectedRoute.collateralSymbol} to keep this strategy above 1.03 HF and the strategy minimum debt.`
    }
    const debt = (amountRaw * (selectedRoute.maxLeverage - 100n)) / 100n
    if (debt < selectedRoute.minDebt || debt > selectedRoute.maxDebt || debt > selectedRoute.availableToBorrow) {
      return 'This amount is outside the current debt limits for this strategy.'
    }
    return undefined
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

    if (!address || !opportunity) {
      return
    }

    const key = `${openPositionStorageKey(address, opportunity.strategyId)}:all`
    if (checkedOpenPositionKeys.current.has(key)) {
      return
    }
    
    checkedOpenPositionKeys.current.add(key)

    const validCreditManagers = opportunity.creditManagers.map(cm => cm.address)
    const fetches = validCreditManagers.map(cm => 
      opportunity.sdk.accounts.getBorrowerCreditAccounts(address, {
        creditManager: cm,
        includeZeroDebt: false,
      }).catch(error => {
        console.warn(`Failed to fetch accounts for CM ${cm}:`, error)
        return []
      })
    )

    Promise.all(fetches)
      .then(results => {
        if (cancelled) return
        const allAccounts = results.flat() as CreditAccountSnapshotLike[]
        const activeAccount = allAccounts.find(account =>
          creditAccountHasFunds(account, validCreditManagers),
        )
        const stillOpen = Boolean(activeAccount)
        setHasOpenPosition(stillOpen)
        setActiveCreditAccount(activeAccount)
        if (stillOpen && activeAccount) {
          storeOpenPosition({
            address,
            creditManager: activeAccount.creditManager,
            strategyId: opportunity.strategyId,
          })
        } else {
          clearStoredOpenPosition(address, opportunity.strategyId)
        }
      })
      .catch((error) => {
        console.error('Unexpected error fetching borrower credit accounts:', error)
      })

    return () => {
      cancelled = true
    }
  }, [address, opportunity])

  const allowance = useReadContract({
    address: selectedRoute?.collateralToken,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && approvalTarget ? [address, approvalTarget] : undefined,
    query: {
      enabled: Boolean(address && approvalTarget && selectedRoute?.collateralToken),
    },
  })

  useEffect(() => {
    if (isExecuting) return
    if (!amountRaw || !selectedRoute) {
      setSteps([])
      return
    }

    setSteps(current => {
      if (current.some(s => s.status === 'active' || s.status === 'error')) return current
      return createExecutionSteps({
        allowance: allowance.data ?? 0n,
        amount: amountRaw,
        canBatch,
        symbol: selectedRoute.collateralSymbol,
      })
    })
  }, [allowance.data, amountRaw, canBatch, isExecuting, selectedRoute])

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
      assertSuccessfulReceipt(approvalReceipt, 'Token approval failed on-chain.')
      nextSteps = markStepDone(nextSteps, 'approve', approvalHash)
      setSteps(nextSteps)
      await allowance.refetch()
      return nextSteps
    },
    [allowance, publicClient, writeContractAsync],
  )

  const handleExecute = useCallback(async () => {
    if (!selectedOpportunityIsExecutable || !opportunity || !address || !amountRaw || !selectedRoute) {
      alert(`Debug early return:\nExecutable: ${selectedOpportunityIsExecutable}\nOpp: ${!!opportunity}\nAddress: ${address}\nAmount: ${amountRaw}\nRoute: ${!!selectedRoute}`)
      return
    }
    setHasStartedFlow(true)
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
      symbol: selectedRoute.collateralSymbol,
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
        collateralToken: selectedRoute.collateralToken,
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
              to: selectedRoute.collateralToken,
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
          selectedRoute.collateralToken,
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
      console.error('Execution failed:', error)
      const message = formatTransactionError(error)
      const failedStep = nextSteps.find(step => step.status === 'active')?.id || 'account'
      setSteps(markStepError(nextSteps, failedStep, message))
      setExecutionError(message)
      if (!message || message.length === 0) {
        alert('An unknown error occurred during execution.')
      }
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

  const activePositionStats = useMemo<ActivePositionStats | undefined>(() => {
    if (!activeCreditAccount || !selectedRoute) return undefined
    
    const divisor = 10 ** (selectedRoute.collateralDecimals || 6)
    const totalValue = Number(activeCreditAccount.totalValue ?? 0n) / divisor
    const debt = Number(activeCreditAccount.debt ?? 0n) / divisor
    const netValue = totalValue - debt

    return { totalValue, debt, netValue }
  }, [activeCreditAccount, selectedRoute])

  const displayedRouteWarning = displayedOpportunity.isExecutable === false
    ? displayedOpportunity.disabledReason
    : routeWarning

  const manageUrl = hasStartedFlow && hasOpenPosition && !forceNewAccount && selectedOpportunityIsExecutable
    ? activeCreditAccount?.creditAccount
      ? `https://app.gearbox.finance/accounts/${MONAD_CHAIN_ID}/${activeCreditAccount.creditAccount}/dashboard`
      : GEARBOX_DASHBOARD_URL
    : undefined

  return (
    <TransactionCockpit
      amount={amount}
      accountStatus={isConnected ? 'connected' : 'disconnected'}
      activePositionStats={selectedOpportunityIsExecutable ? activePositionStats : undefined}
      error={executionError || loadError}
      hasStartedFlow={hasStartedFlow}
      isBusy={isExecuting}
      isProjectReady={isReownProjectConfigured}
      opportunity={displayedOpportunity}
      opportunities={opportunityViews}
      manageUrl={manageUrl}
      hasStoredPosition={hasOpenPosition}
      onViewPosition={() => {
        setForceNewAccount(false)
        setHasStartedFlow(true)
      }}
      routeWarning={displayedRouteWarning}
      steps={selectedOpportunityIsExecutable ? steps : []}
      onAmountChange={setAmount}
      onConnect={() => {
        setHasStartedFlow(true)
        if (displayedRouteWarning) {
          setExecutionError(displayedRouteWarning)
          return
        }
        if (isReownProjectConfigured) void open()
      }}
      onExecute={handleExecute}
      onSelectOpportunity={nextOpportunity => {
        setExecutionError(undefined)
        setSelectedOpportunityId(nextOpportunity.id)
        setHasStartedFlow(true)
        setForceNewAccount(true)
        if (nextOpportunity.id === MAINNET_WETH_OPPORTUNITY_ID) setAmount('1.5')
        if (nextOpportunity.id.startsWith('monad-') && !amount) setAmount('1000')
      }}
      onResetFlow={() => {
        setHasStartedFlow(false)
        setForceNewAccount(true)
        setExecutionError(undefined)
      }}
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
