import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AdvisorApp } from './AdvisorApp'
import { DEFAULT_INTENT, maxBorrowUsd, projectIntentHf, buildCollateralFromDeposits } from '../lib/advisor/onboarding/intent'
import { HERO_NOW, HERO_UNDERLYINGS } from '../lib/advisor/fixtures/heroScenario'

const MARKET = { equityMarketOpen: true, now: HERO_NOW }

function renderApp() {
  return render(<AdvisorApp />)
}

function goToStep2() {
  fireEvent.click(screen.getByRole('button', { name: /continue/i }))
}

function goToStep3() {
  goToStep2()
  fireEvent.click(screen.getByRole('button', { name: /continue/i }))
}

function goToStep4() {
  goToStep3()
  fireEvent.click(screen.getByRole('button', { name: /continue/i }))
}

describe('Onboarding — step 1 portfolio', () => {
  it('shows weight inputs and enables Continue at the default 100%', () => {
    renderApp()
    expect(screen.getByLabelText(/nvda target weight/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/spy target weight/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/aapl target weight/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/spacex target weight/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled()
  })

  it('disables Continue and shows a reason when weights no longer total 100%, then Normalize fixes it', () => {
    renderApp()
    const nvdaInput = screen.getByLabelText(/nvda target weight/i)
    fireEvent.change(nvdaInput, { target: { value: '50' } })

    expect(screen.getAllByText(/110%/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()
    expect(screen.getByText(/must add up to 100%/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /normalize/i }))

    expect(screen.getByText(/total: 100%/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled()
  })

  it('skip-demo goes directly to the dashboard', () => {
    renderApp()
    fireEvent.click(screen.getByTestId('skip-demo'))
    expect(screen.getByTestId('hf-gauge')).toBeInTheDocument()
  })
})

describe('Onboarding — step 2 borrow', () => {
  it('shows the hf-meter with a projected value above 1.5 at defaults', () => {
    renderApp()
    goToStep2()
    expect(screen.getByTestId('hf-meter')).toBeInTheDocument()
    const value = Number(screen.getByTestId('projected-hf-value').textContent)
    expect(value).toBeGreaterThan(1.5)
  })

  it('decreases the projected HF when the USDC amount is raised', () => {
    renderApp()
    goToStep2()
    const before = Number(screen.getByTestId('projected-hf-value').textContent)
    const usdcInput = screen.getByLabelText(/usdc amount/i)
    fireEvent.change(usdcInput, { target: { value: '8000000' } })
    const after = Number(screen.getByTestId('projected-hf-value').textContent)
    expect(after).toBeLessThan(before)
  })

  it('flags borrow above the origination limit and disables Continue', () => {
    renderApp()
    goToStep2()
    const usdcInput = screen.getByLabelText(/usdc amount/i)
    fireEvent.change(usdcInput, { target: { value: '9000000' } })
    expect(screen.getAllByText(/origination limit/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()
  })

  it('flags the private-equity minimum HF rule when borrow stays under capacity but HF drops below 1.50', () => {
    const deposits = DEFAULT_INTENT.deposits
    const borrows = [{ stablecoin: 'USDC' as const, amountUsd: 6_500_000 }]

    const capacity = maxBorrowUsd(buildCollateralFromDeposits(deposits), HERO_UNDERLYINGS, MARKET)
    expect(6_500_000).toBeLessThan(capacity)
    const projected = projectIntentHf(deposits, borrows)
    expect(projected.healthFactor).toBeLessThan(1.5)

    renderApp()
    goToStep2()
    const usdcInput = screen.getByLabelText(/usdc amount/i)
    fireEvent.change(usdcInput, { target: { value: '6500000' } })
    expect(screen.getAllByText(/1\.50/).length).toBeGreaterThan(0)
  })
})

describe('Onboarding — step 3 mandate', () => {
  it('defaults to semi-automatic and switches to automatic on click', () => {
    renderApp()
    goToStep3()
    expect(within(screen.getByTestId('mode-semi')).getByRole('radio')).toBeChecked()

    fireEvent.click(screen.getByTestId('mode-auto'))
    expect(within(screen.getByTestId('mode-auto')).getByRole('radio')).toBeChecked()
  })
})

describe('Onboarding — step 4 review & activate', () => {
  it('shows the agent preview and watch list, and activates into the dashboard', () => {
    renderApp()
    goToStep4()

    const preview = screen.getByTestId('agent-preview')
    expect(within(preview).getByText(/risk-off signals on nvda/i)).toBeInTheDocument()
    expect(within(preview).getByText(/what your agent watches/i)).toBeInTheDocument()
    expect(within(preview).getByText(/external signals/i)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('activate-agent'))
    expect(screen.getByTestId('hf-gauge')).toBeInTheDocument()
  })
})
