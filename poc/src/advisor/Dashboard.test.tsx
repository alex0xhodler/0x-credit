import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AdvisorApp } from './AdvisorApp'

function renderDashboard() {
  render(<AdvisorApp />)
  fireEvent.click(screen.getByTestId('skip-demo'))
}

/** Expands a proposal's disclosure body if it is not already open. */
function expandProposal(testId: string) {
  const card = screen.getByTestId(testId)
  const toggle = within(card).getByRole('button', { expanded: false })
  fireEvent.click(toggle)
}

describe('Dashboard', () => {
  it('shows a healthy health factor above 1.5', () => {
    renderDashboard()
    const gauge = screen.getByTestId('hf-gauge')
    expect(within(gauge).getByText(/healthy/i)).toBeInTheDocument()
    const value = Number(within(gauge).getByTestId('hf-value').textContent)
    expect(value).toBeGreaterThan(1.5)
  })

  it('renders the basket at the underlying level', () => {
    renderDashboard()
    const basket = screen.getByTestId('basket-panel')
    expect(within(basket).getByText('NVDA')).toBeInTheDocument()
    expect(within(basket).getByText('SPY')).toBeInTheDocument()
    expect(within(basket).getByText('AAPL')).toBeInTheDocument()
    expect(within(basket).getByText('SPACEX')).toBeInTheDocument()
  })

  it('surfaces the NVDA proposal first and already expanded', () => {
    renderDashboard()
    const cards = screen.getAllByTestId(/^proposal-/)
    expect(cards[0]).toHaveAttribute('data-testid', 'proposal-reduce_weight:EQUITY:NVDA')
    const proposal = screen.getByTestId('proposal-reduce_weight:EQUITY:NVDA')
    const toggle = within(proposal).getByRole('button', { expanded: true })
    expect(toggle).toBeInTheDocument()
    expect(within(proposal).getByText(/risk-off signals on nvda/i)).toBeInTheDocument()
    expect(within(proposal).getByText(/refinitiv earnings calendar/i)).toBeInTheDocument()
  })

  it('recomputes the projected HF when the proposed weight is edited', () => {
    renderDashboard()
    const proposal = screen.getByTestId('proposal-reduce_weight:EQUITY:NVDA')
    const before = within(proposal).getByTestId('projected-hf').textContent
    const input = within(proposal).getByLabelText(/target nvda weight/i)
    fireEvent.change(input, { target: { value: '10' } })
    const after = within(proposal).getByTestId('projected-hf').textContent
    expect(after).not.toBe(before)
  })

  it('approving the proposal applies the rebalance, raises HF, and removes the card', async () => {
    renderDashboard()
    const gauge = screen.getByTestId('hf-gauge')
    const hfBefore = Number(within(gauge).getByTestId('hf-value').textContent)
    const proposal = screen.getByTestId('proposal-reduce_weight:EQUITY:NVDA')
    await act(async () => {
      fireEvent.click(within(proposal).getByRole('button', { name: /approve/i }))
    })
    await waitFor(() => {
      const hfAfter = Number(within(screen.getByTestId('hf-gauge')).getByTestId('hf-value').textContent)
      expect(hfAfter).toBeGreaterThan(hfBefore)
    })
    expect(screen.queryByTestId('proposal-reduce_weight:EQUITY:NVDA')).not.toBeInTheDocument()
  })

  it('dismissing the proposal removes it without changing HF', () => {
    renderDashboard()
    const gauge = screen.getByTestId('hf-gauge')
    const hfBefore = Number(within(gauge).getByTestId('hf-value').textContent)
    const proposal = screen.getByTestId('proposal-reduce_weight:EQUITY:NVDA')
    fireEvent.click(within(proposal).getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByTestId('proposal-reduce_weight:EQUITY:NVDA')).not.toBeInTheDocument()
    const hfAfter = Number(within(screen.getByTestId('hf-gauge')).getByTestId('hf-value').textContent)
    expect(hfAfter).toBeCloseTo(hfBefore, 2)
  })

  it('enabling the reflexive scenario surfaces the wrong-way warning and moves the refinance proposal first', () => {
    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: /simulate securitize/i }))

    const panel = screen.getByTestId('reflexive-panel')
    expect(within(panel).getByText(/securitize/i)).toBeInTheDocument()
    expect(within(panel).getByText(/hits both sides/i)).toBeInTheDocument()

    const cards = screen.getAllByTestId(/^proposal-/)
    expect(cards[0]).toHaveAttribute('data-testid', 'proposal-refinance_stablecoin:USDe')

    expandProposal('proposal-refinance_stablecoin:USDe')
    const refinance = screen.getByTestId('proposal-refinance_stablecoin:USDe')
    expect(within(refinance).getByText(/break the loop/i)).toBeInTheDocument()
  })

  it('approving the refinance removes USDe from the borrow panel', async () => {
    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: /simulate securitize/i }))
    expandProposal('proposal-refinance_stablecoin:USDe')
    const refinance = screen.getByTestId('proposal-refinance_stablecoin:USDe')
    await act(async () => {
      fireEvent.click(within(refinance).getByRole('button', { name: /approve/i }))
    })
    await waitFor(() => {
      const borrow = screen.getByTestId('borrow-panel')
      expect(within(borrow).queryByText('USDe')).not.toBeInTheDocument()
    })
  })

  it('reconfigure returns to the onboarding wizard', () => {
    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: 'Reconfigure' }))
    expect(screen.getByRole('heading', { name: /build your position/i })).toBeInTheDocument()
  })
})
