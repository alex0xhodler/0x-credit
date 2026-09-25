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
// Institutional Credit / advisor entry point is disabled for now.
// import { AdvisorApp } from './advisor/AdvisorApp'
import { GEARBOX_DASHBOARD_URL, TransactionCockpit, type OpportunityView, type ActivePositionStats, type HeaderVariant, type RwaExecutionGateView, type TopbarVariant } from './TransactionCockpit'
import {
  config,
  isReownProjectConfigured,
  metadata,
  networks,
  projectId,
  wagmiAdapter,
} from './config'
import { formatMinimumDeposit, parseTokenAmount } from './lib/gearbox/amounts'
import {
  createExecutionSteps,
  formatOpportunityApy,
  markStepActive,
  markStepDone,
  markStepError,
  type ExecutionStep,
} from './lib/gearbox/plan'
import {
  checkStrategyEligibility,
  DEFAULT_QUOTA_RESERVE_BPS,
  DEFAULT_SLIPPAGE_BPS,
  loadMainnetOpportunities,
  MAINNET_CHAIN_ID,
  MAINNET_STRATEGY_ID,
  type GearboxCreditManagerRoute,
  type LoadedGearboxOpportunity,
} from './lib/gearbox/live'
import { rwaExecutionGate, type RwaEligibilityStatus } from './lib/gearbox/eligibility'
import { prepareOpenStrategyTx } from './lib/gearbox/sdkAdapter'
import { assertSuccessfulReceipt, formatTransactionError } from './lib/gearbox/transactions'
import { routeProvenanceForStrategy } from './lib/routeProvenance'

const queryClient = new QueryClient()
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
  routeSteps: routeProvenanceForStrategy(MAINNET_STRATEGY_ID, 'Ethereum', 'KPK'),
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
  routeSteps: routeProvenanceForStrategy(MAINNET_STRATEGY_ID, 'Ethereum', 'KPK'),
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
  const chainCapabilities = record[MAINNET_CHAIN_ID] ?? record[String(MAINNET_CHAIN_ID)]
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
  const [mainnetOpportunities, setMainnetOpportunities] = useState<LoadedGearboxOpportunity[]>([])
  const [loadError, setLoadError] = useState<string>()
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
  const opportunity = useMemo(() => {
    if (!selectedOpportunityId.startsWith('mainnet-')) return undefined
    const routeAddress = selectedOpportunityId.replace('mainnet-', '').toLowerCase()
    return mainnetOpportunities.find(opp =>
      opp.creditManagers.some(cm => cm.address.toLowerCase() === routeAddress),
    )
  }, [mainnetOpportunities, selectedOpportunityId])

  const opportunityViews = useMemo(() => {
    const views: OpportunityView[] = []

    function processOpportunity(opp: LoadedGearboxOpportunity) {
      const uniqueRoutes = new Map<string, GearboxCreditManagerRoute>()

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
        const minDepositDisplayDecimals = Math.min(4, route.collateralDecimals)

        views.push({
          id: `mainnet-${route.address}`,
          strategyId: opp.strategyId,
          strategyName: route.strategyName,
          tokenSymbol: displaySymbol,
          // RWA strategies are headlined by the target they hold (mF-ONE,
          // mGLOBAL); the deposit token (frxUSD) stays on amount-related text.
          headlineSymbol: route.rwa ? route.targetSymbol : displaySymbol,
          chainName: 'Ethereum',
          apyLabel: formatOpportunityApy(route.apy),
          leverageLabel: `${(Number(route.maxLeverage) / 100).toFixed(2)}x target`,
          protectionLabel: 'Mainnet strategy',
          minDepositLabel: `Min deposit: ${formatMinimumDeposit(route.minimumDepositAmount, route.collateralDecimals, minDepositDisplayDecimals)} ${displaySymbol}`,
          isExecutable: true,
          apyPercent: route.apy !== undefined ? route.apy / 10_000 : undefined,
          baseApyPercent: route.baseApy !== undefined ? route.baseApy / 10_000 : undefined,
          borrowRatePercent: route.totalBorrowRate / 10_000,
          leverageMultiple: Number(route.maxLeverage) / 100,
          minimumDeposit: Number(route.minimumDepositAmount) / Math.pow(10, route.collateralDecimals),
          minimumDepositRaw: route.minimumDepositAmount,
          collateralDecimals: route.collateralDecimals,
          routeSteps: routeProvenanceForStrategy(opp.strategyId, 'Ethereum', route.curator),
          rwa: route.rwa,
          kycRegistrationLink: route.kycRegistrationLink,
          creditManager: route.address,
          targetToken: opp.targetToken,
          curator: route.curator,
          liquidationThresholdBps: route.liquidationThresholdBps,
          collateralApySource: route.collateralApySource,
          // Back to SDK Bps (1% = 100) from the route's app units (1% = 10_000) —
          // the back-test's fallback rate for a day the Gearbox chart doesn't cover.
          currentBorrowApyBps: route.baseBorrowRate / 100,
          currentQuotaRateBps: Number(route.baseQuotaRateWithFee) / 100,
        })
      })
    }

    if (mainnetOpportunities.length === 0) {
      views.push(MAINNET_WSTETH_STUB)
      views.push(MAINNET_WETH_OPPORTUNITY)
    } else {
      mainnetOpportunities.forEach(processOpportunity)
    }

    return views
  }, [mainnetOpportunities])

  useEffect(() => {
    if (mainnetOpportunities.length > 0 && selectedOpportunityId === MAINNET_WETH_OPPORTUNITY_ID) {
      const firstMainnet = opportunityViews.find(v => v.id.startsWith('mainnet-'))
      if (firstMainnet) {
        setSelectedOpportunityId(firstMainnet.id)
      }
    }
  }, [mainnetOpportunities, opportunityViews, selectedOpportunityId])

  const displayedOpportunity = useMemo(() => {
    return opportunityViews.find(v => v.id === selectedOpportunityId) || opportunityViews[0]
  }, [opportunityViews, selectedOpportunityId])

  const selectedRoute = useMemo(() => {
    if (!opportunity || !selectedOpportunityId.startsWith('mainnet-')) return undefined
    const routeAddress = selectedOpportunityId.replace('mainnet-', '').toLowerCase()
    return opportunity.creditManagers.find(cm => cm.address.toLowerCase() === routeAddress)
  }, [opportunity, selectedOpportunityId])

  const amountRaw = useMemo(
    () => parseTokenAmount(amount, selectedRoute?.collateralDecimals || opportunity?.collateralDecimals || 6),
    [amount, selectedRoute?.collateralDecimals, opportunity?.collateralDecimals],
  )
  const canBatch = supportsAtomicBatch(capabilities.data)
  
  const routeWarning = useMemo(() => {
    if (!opportunity || !amountRaw || !selectedRoute) return undefined

    if (amountRaw < selectedRoute.minimumDepositAmount) {
      const displayDecimals = Math.min(4, selectedRoute.collateralDecimals)
      return `Enter at least ${formatMinimumDeposit(selectedRoute.minimumDepositAmount, selectedRoute.collateralDecimals, displayDecimals)} ${selectedRoute.collateralSymbol} to keep this strategy above 1.04 HF and the strategy minimum debt.`
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
    if (!displayedOpportunity?.minimumDepositRaw) return
    const decimals = Math.min(4, displayedOpportunity.collateralDecimals ?? 4)
    setAmount(formatMinimumDeposit(displayedOpportunity.minimumDepositRaw, displayedOpportunity.collateralDecimals ?? 18, decimals))
  }, [displayedOpportunity?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false

    loadMainnetOpportunities()
      .then(opportunities => {
        if (cancelled) return
        setMainnetOpportunities(opportunities)
      })
      .catch((error: unknown) => {
        console.warn('Failed to load Mainnet opportunities:', error)
        if (!cancelled) setLoadError("Couldn't load strategies from Ethereum. Reload the page to try again.")
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

  const [rwaEligibility, setRwaEligibility] = useState<RwaEligibilityStatus>('unknown')

  useEffect(() => {
    let cancelled = false

    if (!address || !opportunity || !selectedRoute?.rwa) {
      setRwaEligibility('unknown')
      return
    }

    setRwaEligibility('checking')
    checkStrategyEligibility(opportunity.sdk, selectedRoute.address, address)
      .then(eligible => {
        if (cancelled) return
        setRwaEligibility(eligible ? 'eligible' : 'ineligible')
      })
      .catch(() => {
        if (!cancelled) setRwaEligibility('error')
      })

    return () => {
      cancelled = true
    }
  }, [address, opportunity, selectedRoute])

  const rwaGate = useMemo<RwaExecutionGateView>(
    () =>
      rwaExecutionGate({
        rwa: Boolean(selectedRoute?.rwa),
        walletConnected: isConnected,
        eligibility: rwaEligibility,
        kycRegistrationLink: selectedRoute?.kycRegistrationLink,
      }),
    [isConnected, rwaEligibility, selectedRoute],
  )

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

    const targetChainId = MAINNET_CHAIN_ID

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
      ? `https://app.gearbox.finance/accounts/${MAINNET_CHAIN_ID}/${activeCreditAccount.creditAccount}/dashboard`
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
      rwaGate={displayedOpportunity.rwa ? rwaGate : undefined}
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
  // Institutional Credit / advisor entry point is disabled for now.
  // if (new URLSearchParams(window.location.search).get('view') === 'advisor') {
  //   return <AdvisorApp />
  // }

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <GearboxApp />
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export default App
