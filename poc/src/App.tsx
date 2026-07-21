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
import { AdvisorDashboard } from './AdvisorDashboard'
import { TransactionCockpit, type OpportunityView, type ActivePositionStats, type HeaderVariant, type TopbarVariant } from './TransactionCockpit'
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
  loadGearboxOpportunity,
  MONAD_CHAIN_ID,
  MAINNET_CHAIN_ID,
  MAINNET_RPC_URL,
  MAINNET_STRATEGY_ID,
  type LoadedGearboxOpportunity,
} from './lib/gearbox/live'
import { prepareOpenStrategyTx } from './lib/gearbox/sdkAdapter'
import { assertSuccessfulReceipt, formatTransactionError } from './lib/gearbox/transactions'
import { routeProvenanceForStrategy } from './lib/routeProvenance'

const queryClient = new QueryClient()
const GEARBOX_DASHBOARD_URL = 'https://app.gearbox.finance/dashboard'
const MAINNET_WETH_OPPORTUNITY_ID = 'mainnet-weth-wmoo-curve-eth-weth'
const HEADER_VARIANTS: HeaderVariant[] = ['desk', 'journey', 'ticket', 'editorial']
const TOPBAR_VARIANTS: TopbarVariant[] = ['identity', 'shelf', 'switchboard', 'portfolio']

const MAINNET_WETH_OPPORTUNITY: OpportunityView = {
  id: MAINNET_WETH_OPPORTUNITY_ID,
  strategyId: MAINNET_STRATEGY_ID,
  strategyName: 'WMoo Curve ETH+-WETH',
  tokenSymbol: 'WETH',
  chainName: 'Ethereum',
  apyLabel: 'APY loading',
  leverageLabel: 'sweet spot loading',
  protectionLabel: 'Mainnet strategy',
  isExecutable: true,
  routeSteps: routeProvenanceForStrategy(MAINNET_STRATEGY_ID, 'Ethereum'),
}

const MAINNET_WSTETH_STUB: OpportunityView = {
  id: 'mainnet-wsteth-loading',
  strategyId: MAINNET_STRATEGY_ID,
  strategyName: 'WMoo Curve ETH+-WETH',
  tokenSymbol: 'wstETH',
  chainName: 'Ethereum',
  apyLabel: 'APY loading',
  leverageLabel: 'sweet spot loading',
  protectionLabel: 'Mainnet strategy',
  isExecutable: true,
  routeSteps: routeProvenanceForStrategy(MAINNET_STRATEGY_ID, 'Ethereum'),
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


function GearboxApp() {
  const requestedHeaderVariant = new URLSearchParams(window.location.search).get('header')
  const headerVariant = HEADER_VARIANTS.includes(requestedHeaderVariant as HeaderVariant)
    ? requestedHeaderVariant as HeaderVariant
    : 'editorial'
  const requestedTopbarVariant = new URLSearchParams(window.location.search).get('topbar')
  const topbarVariant = TOPBAR_VARIANTS.includes(requestedTopbarVariant as TopbarVariant)
    ? requestedTopbarVariant as TopbarVariant
    : 'shelf'
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

  const [amount, setAmount] = useState('')
  const [monadOpportunity] = useState<LoadedGearboxOpportunity>()
  const [mainnetOpportunity, setMainnetOpportunity] = useState<LoadedGearboxOpportunity>()
  const [loadError] = useState<string>()
  const [executionError, setExecutionError] = useState<string>()
  const [isExecuting, setIsExecuting] = useState(false)
  const [steps, setSteps] = useState<ExecutionStep[]>([])
  const [approvalTarget, setApprovalTarget] = useState<Address>()
  const [hasOpenPosition, setHasOpenPosition] = useState(false)
  const [activeCreditAccount, setActiveCreditAccount] = useState<CreditAccountSnapshotLike>()
  const [hasStartedFlow, setHasStartedFlow] = useState(false)
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string>(MAINNET_WETH_OPPORTUNITY_ID)
  const [forceNewAccount, setForceNewAccount] = useState(false)
  const checkedOpenPositionKeys = useRef(new Set<string>())
  
  const selectedOpportunityIsExecutable = true
  const opportunity = selectedOpportunityId === MAINNET_WETH_OPPORTUNITY_ID || selectedOpportunityId.startsWith('mainnet-') ? mainnetOpportunity : monadOpportunity

  const opportunityViews = useMemo(() => {
    const views: OpportunityView[] = []
    
    function processOpportunity(
      opp: LoadedGearboxOpportunity | undefined,
      networkIdPrefix: string,
      chainName: string,
      defaultStrategyId: string
    ) {
      if (!opp) return false

      const uniqueRoutes = new Map<string, typeof opp.creditManagers[0]>()
      
      for (const route of opp.creditManagers) {
        if (route.maxDebt <= 0n) continue
        if (route.apy !== undefined && route.apy < 0) continue
        const existing = uniqueRoutes.get(route.collateralToken)
        if (!existing) {
          uniqueRoutes.set(route.collateralToken, route)
          continue
        }
        
        const apyCurrent = route.apy ?? 0
        const apyExisting = existing.apy ?? 0
        
        let shouldReplace = false
        if (Math.abs(apyCurrent - apyExisting) > 0.001) {
          shouldReplace = apyCurrent > apyExisting
        } else if (route.minDebt !== existing.minDebt) {
          shouldReplace = route.minDebt < existing.minDebt
        } else {
          shouldReplace = route.maxDebt > existing.maxDebt
        }
        
        if (shouldReplace) {
          uniqueRoutes.set(route.collateralToken, route)
        }
      }

      const sortedRoutes = Array.from(uniqueRoutes.values()).sort((a, b) => {
        if (a.maxDebt !== b.maxDebt) return a.maxDebt > b.maxDebt ? -1 : 1
        return 0
      })

      const seenSymbols = new Set<string>()

      sortedRoutes.forEach(route => {
        let displaySymbol = route.collateralSymbol
        if (displaySymbol === 'USDC' && seenSymbols.has('USDC')) {
          displaySymbol = 'USDT0'
        }
        seenSymbols.add(displaySymbol)

        views.push({
          id: `${networkIdPrefix}-${route.address}`,
          strategyId: defaultStrategyId,
          strategyName: opp.strategyName,
          tokenSymbol: displaySymbol,
          chainName,
          apyLabel: formatOpportunityApy(route.apy),
          leverageLabel: `${(Number(route.maxLeverage) / 100).toFixed(2)}x target`,
          protectionLabel: opp.botAddress ? (chainName === 'Ethereum' ? 'Mainnet strategy' : 'Deleverage bot included') : (chainName === 'Ethereum' ? 'Mainnet strategy' : 'Protection bot discovery pending'),
          minDepositLabel: `Min deposit: ${formatTokenAmount(route.minimumDepositAmount, route.collateralDecimals)} ${displaySymbol}`,
          isExecutable: true,
          apyPercent: route.apy !== undefined ? route.apy / 10_000 : undefined,
          baseApyPercent: route.baseApy !== undefined ? route.baseApy / 10_000 : undefined,
          borrowRatePercent: route.totalBorrowRate / 10_000,
          leverageMultiple: Number(route.maxLeverage) / 100,
          minimumDeposit: Number(route.minimumDepositAmount) / Math.pow(10, route.collateralDecimals),
          collateralDecimals: route.collateralDecimals,
          routeSteps: routeProvenanceForStrategy(defaultStrategyId, chainName),
        })
      })
      return true
    }

    // if (!processOpportunity(monadOpportunity, 'monad', 'Monad', STRATEGY_ID)) {
    //   views.push(baseOpportunityView(undefined, undefined))
    // }

    if (!processOpportunity(mainnetOpportunity, 'mainnet', 'Ethereum', MAINNET_STRATEGY_ID)) {
      views.push(MAINNET_WSTETH_STUB)
      views.push(MAINNET_WETH_OPPORTUNITY)
    }
    
    return views
  }, [mainnetOpportunity])

  useEffect(() => {
    // if (monadOpportunity && selectedOpportunityId === MONAD_USDC_OPPORTUNITY_ID) {
    //   const firstMonad = opportunityViews.find(v => v.id.startsWith('monad-'))
    //   if (firstMonad) setSelectedOpportunityId(firstMonad.id)
    // } else
    if (mainnetOpportunity && selectedOpportunityId === MAINNET_WETH_OPPORTUNITY_ID) {
      const firstMainnet = opportunityViews.find(v => v.id.startsWith('mainnet-'))
      if (firstMainnet) {
        setSelectedOpportunityId(firstMainnet.id)
      }
    }
  }, [monadOpportunity, mainnetOpportunity, opportunityViews, selectedOpportunityId])

  const displayedOpportunity = useMemo(() => {
    return opportunityViews.find(v => v.id === selectedOpportunityId) || opportunityViews[0]
  }, [opportunityViews, selectedOpportunityId])

  const selectedRoute = useMemo(() => {
    if (!opportunity || !selectedOpportunityId) return undefined
    if (selectedOpportunityId.startsWith('monad-')) {
      const routeAddress = selectedOpportunityId.replace('monad-', '')
      return monadOpportunity?.creditManagers.find(cm => cm.address === routeAddress)
    }
    if (selectedOpportunityId.startsWith('mainnet-')) {
      const routeAddress = selectedOpportunityId.replace('mainnet-', '')
      return mainnetOpportunity?.creditManagers.find(cm => cm.address === routeAddress)
    }
    return undefined
  }, [monadOpportunity, mainnetOpportunity, opportunity, selectedOpportunityId])

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
    if (!opportunity) return
    setHasOpenPosition(hasStoredOpenPosition(address, opportunity.strategyId))
  }, [address, opportunity])

  // Reset amount to minimum deposit whenever the selected opportunity changes
  useEffect(() => {
    if (!displayedOpportunity?.minimumDeposit) return
    const decimals = Math.min(4, displayedOpportunity.collateralDecimals ?? 4)
    setAmount(displayedOpportunity.minimumDeposit.toFixed(decimals))
  }, [displayedOpportunity?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false

    // loadGearboxOpportunity()
    //   .then(nextOpportunity => {
    //     if (cancelled) return
    //     setMonadOpportunity(nextOpportunity)
    //     setLoadError(undefined)
    //   })
    //   .catch((error: unknown) => {
    //     if (cancelled) return
    //     setLoadError(error instanceof Error ? error.message : 'Failed to load Monad opportunity.')
    //   })

    loadGearboxOpportunity({
      chainId: MAINNET_CHAIN_ID,
      chainName: 'Mainnet',
      rpcUrl: MAINNET_RPC_URL,
      strategyId: MAINNET_STRATEGY_ID,
    })
      .then(nextOpportunity => {
        if (cancelled) return
        setMainnetOpportunity(nextOpportunity)
      })
      .catch((error: unknown) => {
        console.warn('Failed to load Mainnet opportunity:', error)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    if (!address || !opportunity || !selectedRoute) {
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
    if (!selectedOpportunityIsExecutable || !address || !amountRaw) {
      alert('Please connect your wallet and enter a valid amount.')
      return
    }

    if (!opportunity || !selectedRoute) {
      alert('The strategy data is still loading or failed to load. Please wait or try refreshing.')
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

    const targetChainId = selectedOpportunityId === MAINNET_WETH_OPPORTUNITY_ID || selectedOpportunityId.startsWith('mainnet-')
      ? MAINNET_CHAIN_ID
      : MONAD_CHAIN_ID

    try {
      if (!publicClient) throw new Error('Wallet public client is not ready.')
      if (chainId !== targetChainId) {
        await switchChainAsync({ chainId: targetChainId })
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
          chainId: targetChainId,
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
    selectedOpportunityId,
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
      headerVariant={headerVariant}
      topbarVariant={topbarVariant}
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
  // Fixture-driven advisor demo — no wallet or chain required.
  if (new URLSearchParams(window.location.search).get('view') === 'advisor') {
    return <AdvisorDashboard />
  }

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <GearboxApp />
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export default App
