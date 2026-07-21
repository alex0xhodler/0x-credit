import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AdvisorDashboard } from './AdvisorDashboard'

function renderDashboard() {
  return render(<AdvisorDashboard />)
}

describe('AdvisorDashboard', () => {
  it('shows the health factor from the hero scenario with a healthy status', () => {
    renderDashboard()
    const gauge = screen.getByTestId('hf-gauge')
    expect(within(gauge).getByText(/healthy/i)).toBeInTheDocument()
    // Hero HF ≈ 1.86 — assert the rendered number parses above intervention.
    const value = Number(within(gauge).getByTestId('hf-value').textContent)
    expect(value).toBeGreaterThan(1.5)
  })

  it('renders the basket at the underlying level with weights', () => {
    renderDashboard()
    const basket = screen.getByTestId('basket-panel')
    expect(within(basket).getByText('NVDA')).toBeInTheDocument()
    expect(within(basket).getByText('SPY')).toBeInTheDocument()
    expect(within(basket).getByText('AAPL')).toBeInTheDocument()
    expect(within(basket).getByText('SPACEX')).toBeInTheDocument()
  })

  it('surfaces the earnings-risk proposal with rationale and contributing signal', () => {
    renderDashboard()
    const proposal = screen.getByTestId('proposal-reduce_weight:EQUITY:NVDA')
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

  it('approving the proposal applies the rebalance and raises the displayed HF', () => {
    renderDashboard()
    const gauge = screen.getByTestId('hf-gauge')
    const hfBefore = Number(within(gauge).getByTestId('hf-value').textContent)
    const proposal = screen.getByTestId('proposal-reduce_weight:EQUITY:NVDA')
    fireEvent.click(within(proposal).getByRole('button', { name: /approve/i }))
    const hfAfter = Number(within(screen.getByTestId('hf-gauge')).getByTestId('hf-value').textContent)
    expect(hfAfter).toBeGreaterThan(hfBefore)
    // The acted-on proposal leaves the queue.
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

  it('enabling the reflexive scenario surfaces the wrong-way warning and refinance proposal', () => {
    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: /simulate securitize/i }))
    const panel = screen.getByTestId('reflexive-panel')
    expect(within(panel).getByText(/securitize/i)).toBeInTheDocument()
    expect(within(panel).getByText(/hits both sides/i)).toBeInTheDocument()
    const refinance = screen.getByTestId('proposal-refinance_stablecoin:USDe')
    expect(within(refinance).getByText(/break the loop/i)).toBeInTheDocument()
  })

  it('approving the refinance moves USDe debt into USDC', () => {
    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: /simulate securitize/i }))
    const refinance = screen.getByTestId('proposal-refinance_stablecoin:USDe')
    fireEvent.click(within(refinance).getByRole('button', { name: /approve/i }))
    // USDe row disappears from the borrow summary once refinanced.
    const borrow = screen.getByTestId('borrow-panel')
    expect(within(borrow).queryByText('USDe')).not.toBeInTheDocument()
  })
})
