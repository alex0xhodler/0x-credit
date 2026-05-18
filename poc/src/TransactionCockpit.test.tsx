import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TransactionCockpit } from './TransactionCockpit'
import { createExecutionSteps } from './lib/gearbox/plan'

const opportunity = {
  id: 'monad-usdc-ausdct0',
  strategyId: 'AUSDCT0',
  strategyName: 'Curve AUSD/USDC/USDT0',
  tokenSymbol: 'USDC',
  chainName: 'Monad',
  apyLabel: 'Current APY 42.57%',
  leverageLabel: '3.50x sweet spot',
  protectionLabel: 'Deleverage bot included',
}

const wethOpportunity = {
  id: 'mainnet-weth-wmoo-curve-eth-weth',
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

describe('TransactionCockpit', () => {
  it('keeps the first-load state calm until the user starts earning', async () => {
    const onConnect = vi.fn()
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    function LandingHarness() {
      const [hasStartedFlow, setHasStartedFlow] = useState(false)

      return (
        <TransactionCockpit
          amount="1000"
          accountStatus="disconnected"
          hasStartedFlow={hasStartedFlow}
          isProjectReady
          isBusy={false}
          opportunity={opportunity}
          opportunities={[opportunity, wethOpportunity]}
          steps={[]}
          onAmountChange={() => undefined}
          onConnect={onConnect}
          onExecute={() => undefined}
          onSelectOpportunity={() => setHasStartedFlow(true)}
        />
      )
    }

    render(
      <LandingHarness />,
    )

    expect(screen.getByText('0x.credit')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /earn amplified yields on auto-pilot/i })).toBeInTheDocument()
    expect(screen.getByText('Pick a Strategy, open your Earn account, start earning Effortlessly')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /usdc on monad opportunity/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /weth on ethereum opportunity/i })).toBeInTheDocument()
    const opportunityCard = screen.getByLabelText('USDC on Monad opportunity')
    expect(within(opportunityCard).getByText('Show details')).toBeInTheDocument()
    expect(within(opportunityCard).getByText('Strategy: Curve AUSD/USDC/USDT0')).toBeInTheDocument()
    const wethCard = screen.getByLabelText('WETH on Ethereum opportunity')
    expect(within(wethCard).getByText('Ethereum')).toBeInTheDocument()
    expect(within(wethCard).getByText('Strategy: WMoo Curve ETH+-WETH')).toBeInTheDocument()
    expect(within(wethCard).getByText('Min deposit: 1.5 WETH')).toBeInTheDocument()
    expect(screen.queryByText('Connect')).not.toBeInTheDocument()
    expect(screen.queryByText('Earn 42.57% APY on USDC')).not.toBeInTheDocument()
    expect(screen.queryByText('Target')).not.toBeInTheDocument()
    expect(screen.queryByText('Est. 425.70 USDC / year on 1,000 USDC.')).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /execution steps/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Deposit amount')).not.toBeInTheDocument()
    const poweredBy = screen.getByRole('region', { name: /powered by/i })
    expect(within(poweredBy).getByRole('img', { name: 'Gearbox' })).toBeInTheDocument()
    expect(within(poweredBy).getByRole('img', { name: 'KPK' })).toBeInTheDocument()
    expect(within(poweredBy).getByRole('img', { name: 'Beefy' })).toBeInTheDocument()
    expect(within(poweredBy).getByRole('img', { name: 'Edge UltraYield' })).toBeInTheDocument()
    expect(within(poweredBy).getByRole('img', { name: 'Curve' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /usdc on monad opportunity/i }))
    expect(screen.getByLabelText('Deposit amount')).toHaveValue('1000')
    expect(screen.getAllByText('Strategy: Curve AUSD/USDC/USDT0').length).toBeGreaterThan(0)
    expect(screen.queryByRole('region', { name: /powered by/i })).not.toBeInTheDocument()
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /start earning/i }))
    expect(onConnect).toHaveBeenCalledTimes(1)
  })

  it('shows a clear disabled state when a listed opportunity is not executable yet', () => {
    const onExecute = vi.fn()

    render(
      <TransactionCockpit
        amount="1.5"
        accountStatus="connected"
        hasStartedFlow
        isProjectReady
        isBusy={false}
        opportunity={wethOpportunity}
        opportunities={[opportunity, wethOpportunity]}
        steps={[]}
        onAmountChange={() => undefined}
        onConnect={() => undefined}
        onExecute={onExecute}
      />,
    )

    expect(screen.getByLabelText('Deposit amount')).toHaveValue('1.5')
    expect(screen.getByText('Ethereum execution is not wired in this PoC yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /earn 14.08%/i })).toBeDisabled()
  })

  it('keeps the full transaction overview visible while the user confirms wallet prompts', () => {
    const onAmountChange = vi.fn()
    const onExecute = vi.fn()
    const steps = createExecutionSteps({
      allowance: 0n,
      amount: 100n,
      canBatch: false,
      symbol: 'USDC',
    })

    render(
      <TransactionCockpit
        amount="100"
        accountStatus="connected"
        hasStartedFlow
        isProjectReady
        isBusy={false}
        opportunity={opportunity}
        steps={steps}
        onAmountChange={onAmountChange}
        onConnect={() => undefined}
        onExecute={onExecute}
      />,
    )

    expect(screen.getByLabelText('Deposit amount')).toHaveValue('100')
    expect(screen.getByText('Approve USDC')).toBeInTheDocument()
    expect(screen.getByText('Open credit account')).toBeInTheDocument()
    expect(screen.getByText('Opening with 100 USDC. The approved amount is supplied inside this wallet action.')).toBeInTheDocument()
    expect(screen.queryByText('Deposit USDC')).not.toBeInTheDocument()
    expect(screen.queryByText('Check best route')).not.toBeInTheDocument()
    expect(screen.queryByText('Keep position protected')).not.toBeInTheDocument()
    expect(screen.getByText('Confirm the token approval without leaving this page.')).toBeInTheDocument()
    expect(screen.getByText('Confirm the account opening in your wallet.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Deposit amount'), { target: { value: '250' } })
    expect(onAmountChange).toHaveBeenCalledWith('250')

    fireEvent.click(screen.getByRole('button', { name: /earn 42.57%/i }))
    expect(onExecute).toHaveBeenCalledTimes(1)
  })

  it('collapses an on-chain confirmed approval into a completed approval row', () => {
    const steps = createExecutionSteps({
      allowance: 0n,
      amount: 100n,
      canBatch: false,
      symbol: 'USDC',
    }).map(step => (
      step.id === 'approve'
        ? { ...step, status: 'done' as const, txHash: '0xabc' }
        : step
    ))

    render(
      <TransactionCockpit
        amount="100"
        accountStatus="connected"
        hasStartedFlow
        isProjectReady
        isBusy={false}
        opportunity={opportunity}
        steps={steps}
        onAmountChange={() => undefined}
        onConnect={() => undefined}
        onExecute={() => undefined}
      />,
    )

    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(screen.queryByText('Approve USDC')).not.toBeInTheDocument()
    expect(screen.queryByText('Required once before the deposit can move.')).not.toBeInTheDocument()
    expect(screen.queryByText('Confirm the token approval without leaving this page.')).not.toBeInTheDocument()
    expect(screen.queryByText('0xabc')).not.toBeInTheDocument()
  })

  it('links to the Gearbox dashboard after a position exists', () => {
    render(
      <TransactionCockpit
        amount="1000"
        accountStatus="connected"
        isProjectReady
        isBusy={false}
        manageUrl="https://app.gearbox.finance/dashboard"
        opportunity={opportunity}
        steps={createExecutionSteps({
          allowance: 100n,
          amount: 100n,
          canBatch: false,
          symbol: 'USDC',
        })}
        onAmountChange={() => undefined}
        onConnect={() => undefined}
        onExecute={() => undefined}
      />,
    )

    expect(screen.queryByText('Target')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('USDC amount')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /account earning/i })).toBeInTheDocument()
    expect(screen.getByText('Credit account value')).toBeInTheDocument()
    expect(screen.getByText('1,000.0000 USDC')).toBeInTheDocument()
    expect(screen.getByText('Position live')).toBeInTheDocument()
    expect(screen.getByText('42.57%')).toBeInTheDocument()
    expect(screen.getByText('425.70 USDC / year')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /manage position/i })).toHaveAttribute(
      'href',
      'https://app.gearbox.finance/dashboard',
    )
    expect(screen.queryByRole('button', { name: /account earning/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /execution steps/i })).not.toBeInTheDocument()
  })

  it('does not show the Gearbox dashboard link before a position exists', () => {
    render(
      <TransactionCockpit
        amount="100"
        accountStatus="connected"
        isProjectReady
        isBusy={false}
        opportunity={opportunity}
        steps={[]}
        onAmountChange={() => undefined}
        onConnect={() => undefined}
        onExecute={() => undefined}
      />,
    )

    expect(screen.queryByRole('link', { name: /manage position/i })).not.toBeInTheDocument()
  })

  it('blocks execution with a concrete Reown configuration message when project id is missing', () => {
    render(
      <TransactionCockpit
        amount="100"
        accountStatus="connected"
        hasStartedFlow
        isProjectReady={false}
        isBusy={false}
        opportunity={opportunity}
        steps={[]}
        onAmountChange={() => undefined}
        onConnect={() => undefined}
        onExecute={() => undefined}
      />,
    )

    expect(screen.getByText('Set VITE_REOWN_PROJECT_ID to enable wallet connections.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /earn 42.57%/i })).toBeDisabled()
  })

  it('blocks execution with a route warning when the amount cannot satisfy Gearbox limits safely', () => {
    const onExecute = vi.fn()

    render(
      <TransactionCockpit
        amount="1100"
        accountStatus="connected"
        hasStartedFlow
        isProjectReady
        isBusy={false}
        opportunity={opportunity}
        routeWarning="Enter at least 1,212.13 USDC for this strategy."
        steps={[]}
        onAmountChange={() => undefined}
        onConnect={() => undefined}
        onExecute={onExecute}
      />,
    )

    expect(screen.getByText('Enter at least 1,212.13 USDC for this strategy.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /earn 42.57%/i })).toBeDisabled()
  })

  it('shows cancelled wallet prompts without leaking raw request arguments into the layout', () => {
    const rawWalletError = [
      'User rejected the request.',
      'Request Arguments:',
      'from: 0x894003A817e5c1AAFaC95b710bd2b68f0c040095',
      'Contract Call:',
      'address: 0x000000000eFE302BEAA2b3e6e1b18d008D69a9012a',
      'function: approve(address,uint256)',
      'Version: viem@2.47.0',
    ].join(' ')

    render(
      <TransactionCockpit
        amount="100"
        accountStatus="connected"
        error={rawWalletError}
        hasStartedFlow
        isProjectReady
        isBusy={false}
        opportunity={opportunity}
        steps={createExecutionSteps({
          allowance: 0n,
          amount: 100n,
          canBatch: false,
          symbol: 'USDC',
        }).map(step => (
          step.id === 'approve'
            ? { ...step, status: 'error' as const, error: rawWalletError }
            : step
        ))}
        onAmountChange={() => undefined}
        onConnect={() => undefined}
        onExecute={() => undefined}
      />,
    )

    expect(screen.getAllByText('Transaction cancelled in your wallet. No funds moved.').length).toBeGreaterThan(0)
    expect(screen.queryByText(rawWalletError)).not.toBeInTheDocument()
    expect(screen.queryByText(/Request Arguments/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/viem@2\.47\.0/i)).not.toBeInTheDocument()
  })
})
