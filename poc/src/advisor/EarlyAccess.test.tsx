import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdvisorApp } from './AdvisorApp'

const EARLY_ACCESS_STORAGE_KEY = 'advisor-early-access-submitted'
const EARLY_ACCESS_ENDPOINT = 'https://formspree.io/f/xrenlrpa'

function renderApp() {
  return render(<AdvisorApp />)
}

function stockRow(symbol: string): HTMLElement {
  const checkbox = screen.getByRole('checkbox', { name: new RegExp(`^select ${symbol}$`, 'i') })
  const row = checkbox.closest('.advisor-stock-row')
  if (!row) throw new Error(`stock row not found for ${symbol}`)
  return row as HTMLElement
}

function selectStock(symbol: string) {
  fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(`^select ${symbol}$`, 'i') }))
}

/** Builds a minimal valid position (NVDA, $5M) and activates through the full wizard. */
function activateFromScratch() {
  selectStock('NVDA')
  fireEvent.click(within(stockRow('NVDA')).getByRole('button', { name: '$5M' }))
  fireEvent.click(screen.getByRole('button', { name: /continue to mandate/i }))
  fireEvent.click(screen.getByRole('button', { name: /continue to review/i }))
  fireEvent.click(screen.getByTestId('activate-agent'))
}

function submitEmail(email: string) {
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: /request access/i }))
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AdvisorApp — early access gate', () => {
  it('activating shows the early access gate instead of the dashboard', () => {
    vi.stubGlobal('fetch', vi.fn())
    renderApp()
    activateFromScratch()

    expect(screen.getByRole('heading', { name: /get early access/i })).toBeInTheDocument()
    expect(screen.queryByTestId('hf-gauge')).not.toBeInTheDocument()
  })

  it('submitting a valid email posts to formspree with the email in the body and shows the confirmation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    renderApp()
    activateFromScratch()

    submitEmail('trader@example.com')

    await waitFor(() => expect(screen.getByText(/you're on the list/i)).toBeInTheDocument())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(EARLY_ACCESS_ENDPOINT)
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Accept: 'application/json' })
    const body = JSON.parse(init.body)
    expect(body.email).toBe('trader@example.com')
    expect(body.source).toBe('0x-credit stock credit early access')
    expect(body.deposits).toContain('NVDA')
    expect(body.mode).toBe('semi')
  })

  it('the preview-dashboard link advances to the dashboard', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    renderApp()
    activateFromScratch()
    submitEmail('trader@example.com')

    await waitFor(() => expect(screen.getByTestId('preview-dashboard')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('preview-dashboard'))

    expect(screen.getByTestId('hf-gauge')).toBeInTheDocument()
  })

  it('a fetch rejection shows the error line and allows retry', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    renderApp()
    activateFromScratch()

    submitEmail('trader@example.com')
    await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /request access/i })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: /request access/i }))
    await waitFor(() => expect(screen.getByText(/you're on the list/i)).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('with the early-access flag already stored, activate goes straight to the dashboard', () => {
    localStorage.setItem(EARLY_ACCESS_STORAGE_KEY, '1')
    vi.stubGlobal('fetch', vi.fn())
    renderApp()
    activateFromScratch()

    expect(screen.getByTestId('hf-gauge')).toBeInTheDocument()
  })

  it('skip-demo still lands directly on the dashboard with no fetch call', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderApp()
    fireEvent.click(screen.getByTestId('skip-demo'))

    expect(screen.getByTestId('hf-gauge')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
