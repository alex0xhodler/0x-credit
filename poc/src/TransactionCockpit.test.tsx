import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GEARBOX_DASHBOARD_URL, TransactionCockpit } from './TransactionCockpit'
import { createExecutionSteps } from './lib/gearbox/plan'

const wstEthOpportunity = {
  id: 'mainnet-wsteth-001',
  strategyId: 'wmooCurveETH+-WETH',
  strategyName: 'Convex ETH+/WETH (Optimized by Beefy)',
  tokenSymbol: 'wstETH',
  chainName: 'Ethereum',
  apyLabel: 'Current APY 70.32%',
  leverageLabel: '7.60x target',
  protectionLabel: 'Mainnet strategy',
  minDepositLabel: 'Min deposit: 2.92 wstETH',
  isExecutable: true,
  apyPercent: 70.32,
  baseApyPercent: 4.2,
  borrowRatePercent: 0.67,
  leverageMultiple: 7.6,
  minimumDeposit: 2.92,
  collateralDecimals: 18,
  routeSteps: [
    { role: 'Manager', provider: 'KPK' },
    { role: 'Protocol', provider: 'Gearbox' },
    { role: 'Pool', provider: 'Beefy on Curve' },
  ],
}

const wethOpportunity = {
  id: 'mainnet-weth-002',
  strategyId: 'wmooCurveETH+-WETH',
  strategyName: 'Convex ETH+/WETH (Optimized by Beefy)',
  tokenSymbol: 'WETH',
  chainName: 'Ethereum',
  apyLabel: 'Current APY 51.39%',
  leverageLabel: '7.60x target',
  protectionLabel: 'Mainnet strategy',
  minDepositLabel: 'Min deposit: 1.50 WETH',
  isExecutable: false,
  disabledReason: 'Ethereum execution is not wired in this PoC yet.',
  apyPercent: 51.39,
  baseApyPercent: 3.1,
  leverageMultiple: 7.6,
  minimumDeposit: 1.5,
  collateralDecimals: 18,
}

const mGlobalOpportunity = {
  id: 'mainnet-mglobal-001',
  strategyId: 'mGLOBAL',
  strategyName: 'mGLOBAL',
  tokenSymbol: 'frxUSD',
  chainName: 'Ethereum',
  apyLabel: 'APY n/a',
  leverageLabel: '4.70x target',
  protectionLabel: 'Mainnet strategy',
  minDepositLabel: 'Min deposit: 40540.00 frxUSD',
  isExecutable: true,
  apyPercent: undefined,
  borrowRatePercent: 6.5,
  leverageMultiple: 4.7,
  minimumDeposit: 40540,
  collateralDecimals: 18,
  rwa: true,
  kycRegistrationLink: 'https://form.typeform.com/to/DqZaw6kr',
}

const baseProps = {
  amount: '3',
  accountStatus: 'disconnected' as const,
  isProjectReady: true,
  isBusy: false,
  opportunity: wstEthOpportunity,
  opportunities: [wstEthOpportunity, wethOpportunity],
  steps: [],
  onAmountChange: vi.fn(),
  onConnect: vi.fn(),
  onExecute: vi.fn(),
  onSelectOpportunity: vi.fn(),
  onResetFlow: vi.fn(),
}

describe('TransactionCockpit — cockpit layout', () => {
  it('renders the compact brand cue and a strategy tab for each opportunity', () => {
    render(<TransactionCockpit {...baseProps} />)
    expect(screen.getByLabelText('0x.credit')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /wsteth/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /weth/i })).toBeInTheDocument()
  })

  it('marks the current opportunity tab as selected', () => {
    render(<TransactionCockpit {...baseProps} />)
    expect(screen.getByRole('tab', { name: /wsteth/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /weth/i })).toHaveAttribute('aria-selected', 'false')
  })

  it('calls onSelectOpportunity when a different tab is clicked', () => {
    const onSelectOpportunity = vi.fn()
    render(<TransactionCockpit {...baseProps} onSelectOpportunity={onSelectOpportunity} />)
    fireEvent.click(screen.getByRole('tab', { name: /weth/i }))
    expect(onSelectOpportunity).toHaveBeenCalledWith(wethOpportunity)
  })

  it('ties explicit route provenance to the selected strategy instead of global partner branding', () => {
    render(<TransactionCockpit {...baseProps} />)

    expect(screen.getByRole('heading', { level: 1, name: /automated yield strategies/i })).toBeInTheDocument()
    const route = screen.getByLabelText(/strategy route/i)
    expect(within(route).getByText(/you deposit: wstETH/i)).toBeInTheDocument()
    expect(within(route).getByText(/manager: kpk/i)).toBeInTheDocument()
    expect(within(route).getByText(/protocol: gearbox/i)).toBeInTheDocument()
    expect(within(route).getByText(/pool: beefy on curve/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/route partners/i)).not.toBeInTheDocument()
  })

  it('does not invent provenance when the selected opportunity has none', () => {
    render(<TransactionCockpit {...baseProps} opportunity={wethOpportunity} />)

    expect(screen.queryByLabelText(/strategy route/i)).not.toBeInTheDocument()
  })

  it.each([
    ['desk', 'Strategy selection'],
    ['journey', 'How your position works'],
    ['ticket', 'Strategy ticket'],
    ['editorial', 'Selected yield strategy'],
  ] as const)('renders the %s header experiment as a usable strategy selector', (headerVariant, label) => {
    render(<TransactionCockpit {...baseProps} headerVariant={headerVariant} topbarVariant="identity" />)

    expect(screen.getByRole('banner', { name: label })).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: /strategy/i })).toBeInTheDocument()
  })

  it.each([
    ['identity', 'Strategy selection'],
    ['shelf', 'Strategy shelf'],
    ['switchboard', 'Strategy switchboard'],
    ['portfolio', 'Portfolio strategy selection'],
  ] as const)('renders the %s top-strip experiment with working strategy tabs', (topbarVariant, label) => {
    render(<TransactionCockpit {...baseProps} headerVariant="desk" topbarVariant={topbarVariant} />)

    expect(screen.getByRole('banner', { name: label })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /wsteth/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /weth/i })).toBeInTheDocument()
  })

  it('uses roving focus and arrow keys for strategy selection', () => {
    const onSelectOpportunity = vi.fn()
    render(<TransactionCockpit {...baseProps} onSelectOpportunity={onSelectOpportunity} />)

    const selectedTab = screen.getByRole('tab', { name: /wsteth/i })
    const nextTab = screen.getByRole('tab', { name: /weth/i })
    const panel = screen.getByRole('tabpanel')

    expect(selectedTab).toHaveAttribute('tabindex', '0')
    expect(nextTab).toHaveAttribute('tabindex', '-1')
    expect(selectedTab).toHaveAttribute('aria-controls', panel.id)
    expect(panel).toHaveAttribute('aria-labelledby', selectedTab.id)

    selectedTab.focus()
    fireEvent.keyDown(selectedTab, { key: 'ArrowRight' })

    expect(nextTab).toHaveFocus()
    expect(onSelectOpportunity).toHaveBeenCalledWith(wethOpportunity)
  })

  it('supports Home and End keys in the strategy selector', () => {
    const onSelectOpportunity = vi.fn()
    render(<TransactionCockpit {...baseProps} onSelectOpportunity={onSelectOpportunity} />)

    const firstTab = screen.getByRole('tab', { name: /wsteth/i })
    const lastTab = screen.getByRole('tab', { name: /weth/i })

    firstTab.focus()
    fireEvent.keyDown(firstTab, { key: 'End' })
    expect(lastTab).toHaveFocus()
    expect(onSelectOpportunity).toHaveBeenLastCalledWith(wethOpportunity)

    fireEvent.keyDown(lastTab, { key: 'Home' })
    expect(firstTab).toHaveFocus()
    expect(onSelectOpportunity).toHaveBeenLastCalledWith(wstEthOpportunity)
  })

  it('renders the deposit input with the current amount', () => {
    render(<TransactionCockpit {...baseProps} />)
    expect(screen.getByLabelText(/deposit amount/i)).toHaveValue('3')
  })

})

describe('TransactionCockpit — deposit controls', () => {
  it('calls onAmountChange when a preset chip is clicked', () => {
    const onAmountChange = vi.fn()
    render(<TransactionCockpit {...baseProps} onAmountChange={onAmountChange} />)
    fireEvent.click(screen.getByRole('button', { name: /min/i }))
    expect(onAmountChange).toHaveBeenCalledWith(expect.stringMatching(/^2\.9/))
  })

  it('calls onAmountChange with the preset value when a preset button is clicked', () => {
    const onAmountChange = vi.fn()
    render(<TransactionCockpit {...baseProps} amount="3" onAmountChange={onAmountChange} />)
    fireEvent.click(screen.getByRole('button', { name: '5' }))
    expect(onAmountChange).toHaveBeenCalledWith('5')
  })

  it('calls onAmountChange with min deposit when Min is clicked', () => {
    const onAmountChange = vi.fn()
    render(<TransactionCockpit {...baseProps} amount="10" onAmountChange={onAmountChange} />)
    fireEvent.click(screen.getByRole('button', { name: /min/i }))
    expect(onAmountChange).toHaveBeenCalledWith(expect.stringMatching(/^2\.9/))
  })
})

describe('TransactionCockpit — position preview', () => {
  it('shows estimated annual yield derived from numeric apyPercent', () => {
    render(<TransactionCockpit {...baseProps} amount="3" />)
    // 3 * 70.32% = 2.1096 wstETH/year
    expect(screen.getByText(/2\.1\d\s*wstETH\s*\/\s*year/i)).toBeInTheDocument()
  })

  it('shows borrow estimate derived from numeric leverageMultiple', () => {
    render(<TransactionCockpit {...baseProps} amount="3" />)
    // borrowed = 3 * (7.6 - 1) = 19.8 wstETH — appears in position-explained and preview
    expect(screen.getAllByText(/19\.\d+\s*wstETH/i).length).toBeGreaterThanOrEqual(1)
  })
})

describe('TransactionCockpit — CTA and execution', () => {
  it('shows "Start earning" CTA before connecting', () => {
    render(<TransactionCockpit {...baseProps} accountStatus="disconnected" />)
    expect(screen.getByRole('button', { name: /start earning/i })).toBeInTheDocument()
  })

  it('shows APY in CTA when connected', () => {
    render(<TransactionCockpit {...baseProps} accountStatus="connected" />)
    expect(screen.getByRole('button', { name: /earn 70\.32%/i })).toBeInTheDocument()
  })

  it('disables CTA when there is a route warning', () => {
    render(
      <TransactionCockpit
        {...baseProps}
        accountStatus="connected"
        routeWarning="Enter at least 2.92 wstETH"
      />,
    )
    expect(screen.getByRole('button', { name: /earn/i })).toBeDisabled()
    expect(screen.getByText(/Enter at least 2\.92 wstETH/i)).toBeInTheDocument()
  })

  it('disables CTA when project is not ready', () => {
    render(<TransactionCockpit {...baseProps} isProjectReady={false} accountStatus="connected" />)
    expect(screen.getByRole('button', { name: /earn/i })).toBeDisabled()
    expect(screen.getByText(/VITE_REOWN_PROJECT_ID/i)).toBeInTheDocument()
  })

  it('calls onConnect when CTA is clicked and not connected', () => {
    const onConnect = vi.fn()
    render(<TransactionCockpit {...baseProps} accountStatus="disconnected" onConnect={onConnect} />)
    fireEvent.click(screen.getByRole('button', { name: /start earning/i }))
    expect(onConnect).toHaveBeenCalledTimes(1)
  })

  it('calls onExecute when CTA is clicked while connected', () => {
    const onExecute = vi.fn()
    render(
      <TransactionCockpit
        {...baseProps}
        accountStatus="connected"
        onExecute={onExecute}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /earn 70\.32%/i }))
    expect(onExecute).toHaveBeenCalledTimes(1)
  })
})

describe('TransactionCockpit — execution step progress', () => {
  it('renders step track with approve, open and protection nodes', () => {
    const steps = createExecutionSteps({ allowance: 0n, amount: 3n, canBatch: false, symbol: 'wstETH' })
    render(<TransactionCockpit {...baseProps} accountStatus="connected" steps={steps} />)
    expect(screen.getByText('Approve')).toBeInTheDocument()
    expect(screen.getByText('Open account')).toBeInTheDocument()
    expect(screen.getByText('Automated protection')).toBeInTheDocument()
  })

  it('shows done circle for approve when approve step is done', () => {
    const steps = createExecutionSteps({ allowance: 0n, amount: 3n, canBatch: false, symbol: 'wstETH' })
      .map(s => s.id === 'approve' ? { ...s, status: 'done' as const } : s)
    render(<TransactionCockpit {...baseProps} accountStatus="connected" steps={steps} />)
    // Protection always shows ✓; done approve adds a second ✓
    expect(screen.getAllByText('✓').length).toBeGreaterThanOrEqual(2)
  })
})

describe('TransactionCockpit — chart footer', () => {
  it('uses the selected net strategy APY in one historical-to-projection comparison chart', () => {
    render(<TransactionCockpit {...baseProps} />)

    expect(screen.getByLabelText(/historical benchmark rates and future yield projection/i)).toBeInTheDocument()
    expect(screen.queryByText(/^Benchmark APY history$/i)).not.toBeInTheDocument()
    expect(screen.getByText(/net strategy/i)).toBeInTheDocument()
    expect(screen.queryByText(/^Base$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/borrow\/yr/i)).not.toBeInTheDocument()
  })

  it('uses 1 month, 6 months, and 1 year periods instead of multi-year horizons', () => {
    render(<TransactionCockpit {...baseProps} />)

    expect(screen.getByRole('radio', { name: /1 month/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /6 months/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /1 year/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '3Y' })).not.toBeInTheDocument()
  })

  it('keeps the chart free of explanatory implementation copy while deposits update', () => {
    vi.useFakeTimers()
    const view = render(<TransactionCockpit {...baseProps} amount="2.924" />)

    expect(screen.queryByText(/based on .*historical pool apy/i)).not.toBeInTheDocument()

    view.rerender(<TransactionCockpit {...baseProps} amount="5" />)
    act(() => vi.advanceTimersByTime(300))
    expect(screen.queryByText(/based on .*historical pool apy/i)).not.toBeInTheDocument()
    vi.useRealTimers()
  })
})

describe('TransactionCockpit — invested state', () => {
  it('shows position live screen with manage link', () => {
    render(
      <TransactionCockpit
        {...baseProps}
        accountStatus="connected"
        manageUrl="https://app.gearbox.finance/dashboard"
      />,
    )
    expect(screen.getByRole('heading', { name: /smart account earning/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /manage position/i })).toHaveAttribute(
      'href',
      'https://app.gearbox.finance/dashboard',
    )
  })
})

describe('TransactionCockpit — RWA strategies with no collateral APY', () => {
  const rwaProps = {
    ...baseProps,
    opportunity: mGlobalOpportunity,
    opportunities: [wstEthOpportunity, mGlobalOpportunity],
  }

  it('shows "APY n/a" instead of a loading skeleton when the RWA route has no APY', () => {
    render(<TransactionCockpit {...rwaProps} />)
    expect(screen.getAllByText(/apy n\/a/i).length).toBeGreaterThanOrEqual(1)
    expect(document.querySelector('.builder-apy-shimmer')).not.toBeInTheDocument()
    expect(document.querySelector('.chart-apy-badge--loading')).not.toBeInTheDocument()
  })

  it('shows borrow cost and leverage for the RWA route', () => {
    render(<TransactionCockpit {...rwaProps} />)
    expect(screen.getByLabelText(/borrow cost and leverage/i)).toBeInTheDocument()
    expect(screen.getByText('6.50%')).toBeInTheDocument()
    expect(screen.getByText('4.70x')).toBeInTheDocument()
  })

  it('does not show "APY n/a" for a regular strategy with a loaded numeric APY', () => {
    render(<TransactionCockpit {...baseProps} />)
    expect(screen.queryByText(/apy n\/a/i)).not.toBeInTheDocument()
  })

  it('shows the exit disclosure with a link to the Gearbox dashboard on the RWA panel', () => {
    render(<TransactionCockpit {...rwaProps} />)
    expect(screen.getByText(/exits use delayed midas redemption and are managed on gearbox/i)).toBeInTheDocument()
    const dashboardLink = screen.getByRole('link', { name: /gearbox dashboard/i })
    expect(dashboardLink).toHaveAttribute('href', GEARBOX_DASHBOARD_URL)
    expect(dashboardLink).toHaveAttribute('target', '_blank')
    expect(dashboardLink).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('does not show the exit disclosure for a non-RWA strategy', () => {
    render(<TransactionCockpit {...baseProps} />)
    expect(screen.queryByText(/exits use delayed midas redemption/i)).not.toBeInTheDocument()
  })

  it('does not show a misleading zero-yield deposit preview when APY is unavailable', () => {
    render(<TransactionCockpit {...rwaProps} amount="40540" />)
    expect(screen.queryByLabelText(/position preview/i)).not.toBeInTheDocument()
  })
})

describe('TransactionCockpit — RWA eligibility gate', () => {
  const rwaProps = {
    ...baseProps,
    accountStatus: 'connected' as const,
    opportunity: mGlobalOpportunity,
    opportunities: [wstEthOpportunity, mGlobalOpportunity],
  }

  it('disables execution and shows a checking message while eligibility is unresolved', () => {
    render(<TransactionCockpit {...rwaProps} rwaGate={{ canExecute: false, reason: 'Checking eligibility…' }} />)
    expect(screen.getByRole('button', { name: /earn/i })).toBeDisabled()
    expect(screen.getByText('Checking eligibility…')).toBeInTheDocument()
  })

  it('disables execution and shows the Midas registration link when ineligible', () => {
    render(
      <TransactionCockpit
        {...rwaProps}
        rwaGate={{
          canExecute: false,
          reason: "Your wallet isn't eligible for this strategy yet.",
          registrationLink: 'https://form.typeform.com/to/DqZaw6kr',
        }}
      />,
    )
    expect(screen.getByRole('button', { name: /earn/i })).toBeDisabled()
    expect(screen.getByText(/your wallet isn't eligible for this strategy yet/i)).toBeInTheDocument()
    const registrationLink = screen.getByRole('link', { name: /complete midas registration/i })
    expect(registrationLink).toHaveAttribute('href', 'https://form.typeform.com/to/DqZaw6kr')
    expect(registrationLink).toHaveAttribute('target', '_blank')
  })

  it('allows execution when the gate reports eligible', () => {
    render(<TransactionCockpit {...rwaProps} rwaGate={{ canExecute: true }} />)
    expect(screen.getByRole('button', { name: /earn/i })).toBeEnabled()
  })
})

