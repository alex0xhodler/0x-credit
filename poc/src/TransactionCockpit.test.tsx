import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TransactionCockpit } from './TransactionCockpit'
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
  it('renders the brand and a strategy tab for each opportunity', () => {
    render(<TransactionCockpit {...baseProps} />)
    expect(screen.getByText('0x.credit')).toBeInTheDocument()
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

  it('renders the deposit input with the current amount', () => {
    render(<TransactionCockpit {...baseProps} />)
    expect(screen.getByLabelText(/deposit amount/i)).toHaveValue('3')
  })

  it('renders the "powered by" footer', () => {
    render(<TransactionCockpit {...baseProps} />)
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByRole('img', { name: 'Gearbox' })).toBeInTheDocument()
    expect(within(footer).getByRole('img', { name: 'Beefy' })).toBeInTheDocument()
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
  it('shows borrow rate in chart footer when borrowRatePercent is provided', () => {
    render(<TransactionCockpit {...baseProps} />)
    expect(screen.getByText(/borrow\/yr/i)).toBeInTheDocument()
  })

  it('shows base APY in chart footer', () => {
    render(<TransactionCockpit {...baseProps} />)
    expect(screen.getByText(/^Base$/)).toBeInTheDocument()
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
