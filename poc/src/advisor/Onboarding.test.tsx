import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { AdvisorApp } from './AdvisorApp'

beforeEach(() => {
  localStorage.clear()
})

function renderApp() {
  return render(<AdvisorApp />)
}

/** The catalog row `<div class="advisor-stock-row">` containing the given symbol's select checkbox. */
function stockRow(symbol: string): HTMLElement {
  const checkbox = screen.getByRole('checkbox', { name: new RegExp(`^select ${symbol}$`, 'i') })
  const row = checkbox.closest('.advisor-stock-row')
  if (!row) throw new Error(`stock row not found for ${symbol}`)
  return row as HTMLElement
}

function selectStock(symbol: string) {
  fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(`^select ${symbol}$`, 'i') }))
}

function setDepositByTyping(symbol: string, rawAmount: string) {
  const input = screen.getByLabelText(new RegExp(`${symbol} deposit amount`, 'i'))
  fireEvent.change(input, { target: { value: rawAmount } })
  fireEvent.blur(input)
}

/** Selects NVDA and deposits $5M via its preset pill — the minimal valid (single-stock, zero-borrow) position. */
function buildMinimalValidPosition() {
  selectStock('NVDA')
  fireEvent.click(within(stockRow('NVDA')).getByRole('button', { name: '$5M' }))
}

function goToScreen2() {
  buildMinimalValidPosition()
  fireEvent.click(screen.getByRole('button', { name: /continue to mandate/i }))
}

function goToScreen3() {
  goToScreen2()
  fireEvent.click(screen.getByRole('button', { name: /continue to review/i }))
}

describe('Onboarding — screen 1: build your position', () => {
  it('starts with no stocks selected and Continue disabled with a reason', () => {
    renderApp()
    expect(screen.getByRole('checkbox', { name: /^select nvda$/i })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /^select spy$/i })).not.toBeChecked()
    expect(screen.queryByLabelText(/nvda deposit amount/i)).not.toBeInTheDocument()

    const cta = screen.getByRole('button', { name: /continue to mandate/i })
    expect(cta).toBeDisabled()
    expect(screen.getAllByText(/deposit some collateral/i).length).toBeGreaterThan(0)
  })

  it('shows the USDC borrow input even before any stock is selected', () => {
    renderApp()
    expect(screen.getByLabelText(/usdc borrow amount/i)).toBeInTheDocument()
  })

  it('selecting a stock reveals its deposit input; the $5M preset sets it', () => {
    renderApp()
    selectStock('NVDA')
    const input = screen.getByLabelText(/nvda deposit amount/i)
    expect(input).toBeInTheDocument()

    fireEvent.click(within(stockRow('NVDA')).getByRole('button', { name: '$5M' }))
    expect(screen.getByLabelText(/nvda deposit amount/i)).toHaveValue('$5,000,000')
  })

  it('builds the default-intent deposit shape via the UI and totals the collateral in the rail', () => {
    renderApp()
    selectStock('NVDA')
    fireEvent.click(within(stockRow('NVDA')).getByRole('button', { name: '$5M' }))
    selectStock('SPY')
    setDepositByTyping('SPY', '3750000')
    selectStock('AAPL')
    fireEvent.click(within(stockRow('AAPL')).getByRole('button', { name: '$2.5M' }))
    selectStock('SPACEX')
    setDepositByTyping('SPACEX', '1250000')

    expect(screen.getByLabelText(/nvda deposit amount/i)).toHaveValue('$5,000,000')
    expect(screen.getByLabelText(/spy deposit amount/i)).toHaveValue('$3,750,000')
    expect(screen.getByLabelText(/aapl deposit amount/i)).toHaveValue('$2,500,000')
    expect(screen.getByLabelText(/spacex deposit amount/i)).toHaveValue('$1,250,000')
    expect(screen.getByText(/\$12,500,000/)).toBeInTheDocument()
  })

  it('clicking the Balanced preset sets a positive USDC amount with projected HF near 1.6', () => {
    renderApp()
    selectStock('NVDA')
    fireEvent.click(within(stockRow('NVDA')).getByRole('button', { name: '$5M' }))
    selectStock('SPY')
    setDepositByTyping('SPY', '3750000')

    fireEvent.click(screen.getByRole('button', { name: 'Balanced' }))

    const usdcInput = screen.getByLabelText(/usdc borrow amount/i) as HTMLInputElement
    expect(parseFloat(usdcInput.value.replace(/[^0-9.]/g, ''))).toBeGreaterThan(0)

    const hf = Number(screen.getByTestId('screen1-hf-value').textContent)
    expect(hf).toBeGreaterThan(1.55)
    expect(hf).toBeLessThan(1.65)
  })

  it('enabling USDT shows its input with a live max hint, and an over-cap amount is clamped on blur', () => {
    renderApp()
    selectStock('NVDA')
    fireEvent.click(within(stockRow('NVDA')).getByRole('button', { name: '$5M' }))
    selectStock('SPY')
    setDepositByTyping('SPY', '3750000')

    const usdcInput = screen.getByLabelText(/usdc borrow amount/i)
    fireEvent.change(usdcInput, { target: { value: '1000000' } })
    fireEvent.blur(usdcInput)

    fireEvent.click(screen.getByRole('checkbox', { name: /\+ usdt/i }))
    const usdtInput = screen.getByLabelText(/usdt borrow amount/i)
    expect(usdtInput).toBeInTheDocument()
    expect(screen.getByText(/up to \$1,500,000/)).toBeInTheDocument()

    fireEvent.change(usdtInput, { target: { value: '5000000' } })
    expect(screen.getAllByText(/permitted share/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /continue to mandate/i })).toBeDisabled()

    fireEvent.blur(usdtInput)
    expect(usdtInput).toHaveValue('$1,500,000')
    expect(screen.getByRole('button', { name: /continue to mandate/i })).toBeEnabled()
  })

  it('the Max preset with SPACEX selected keeps validateIntent passing (private-equity floor respected)', () => {
    renderApp()
    selectStock('SPACEX')
    setDepositByTyping('SPACEX', '1250000')

    fireEvent.click(screen.getByRole('button', { name: 'Max' }))

    const usdcInput = screen.getByLabelText(/usdc borrow amount/i) as HTMLInputElement
    expect(parseFloat(usdcInput.value.replace(/[^0-9.]/g, ''))).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /continue to mandate/i })).toBeEnabled()
  })

  it('skip-demo goes directly to the dashboard', () => {
    renderApp()
    fireEvent.click(screen.getByTestId('skip-demo'))
    expect(screen.getByTestId('hf-gauge')).toBeInTheDocument()
  })
})

describe('Onboarding — screen 2: mandate', () => {
  it('defaults to semi-automatic and switches to automatic on click', () => {
    renderApp()
    goToScreen2()

    expect(within(screen.getByTestId('mode-semi')).getByRole('radio')).toBeChecked()

    fireEvent.click(screen.getByTestId('mode-auto'))
    expect(within(screen.getByTestId('mode-auto')).getByRole('radio')).toBeChecked()
  })
})

describe('Onboarding — screen 3: review & activate', () => {
  it('summarizes the entered deposits and borrow, shows the agent preview, and activates into the dashboard', () => {
    renderApp()
    selectStock('NVDA')
    fireEvent.click(within(stockRow('NVDA')).getByRole('button', { name: '$5M' }))
    selectStock('SPY')
    setDepositByTyping('SPY', '3750000')
    fireEvent.click(screen.getByRole('button', { name: 'Balanced' }))
    fireEvent.click(screen.getByRole('button', { name: /continue to mandate/i }))
    fireEvent.click(screen.getByRole('button', { name: /continue to review/i }))

    expect(screen.getByText(/\$5,000,000/)).toBeInTheDocument()
    expect(screen.getByText(/\$3,750,000/)).toBeInTheDocument()

    const preview = screen.getByTestId('agent-preview')
    expect(within(preview).getByText(/risk-off signals on nvda/i)).toBeInTheDocument()
    expect(within(preview).getByText(/what your agent watches/i)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('activate-agent'))
    expect(screen.getByRole('heading', { name: /get early access/i })).toBeInTheDocument()
  })

  it('shows the exec steps with step 3 active after navigating through all screens', () => {
    renderApp()
    goToScreen3()
    const steps = screen.getByLabelText(/execution steps/i)
    expect(within(steps).getByText('Review')).toBeInTheDocument()
  })
})
