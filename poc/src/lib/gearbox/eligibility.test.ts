import { describe, expect, it } from 'vitest'
import { rwaExecutionGate } from './eligibility'

describe('rwaExecutionGate', () => {
  it('leaves non-RWA strategies unaffected', () => {
    const result = rwaExecutionGate({ rwa: false, walletConnected: true, eligibility: 'ineligible' })
    expect(result).toEqual({ canExecute: true })
  })

  it('leaves the existing connect-wallet flow unaffected when not connected', () => {
    const result = rwaExecutionGate({ rwa: true, walletConnected: false, eligibility: 'unknown' })
    expect(result.canExecute).toBe(true)
  })

  it('disables execution with a checking message while eligibility is being checked', () => {
    const result = rwaExecutionGate({ rwa: true, walletConnected: true, eligibility: 'checking' })
    expect(result.canExecute).toBe(false)
    expect(result.reason).toBe('Checking eligibility…')
  })

  it('disables execution and surfaces the Midas registration link when ineligible', () => {
    const result = rwaExecutionGate({
      rwa: true,
      walletConnected: true,
      eligibility: 'ineligible',
      kycRegistrationLink: 'https://form.typeform.com/to/DqZaw6kr',
    })
    expect(result.canExecute).toBe(false)
    expect(result.reason).toBe("Your wallet isn't eligible for this strategy yet.")
    expect(result.registrationLink).toBe('https://form.typeform.com/to/DqZaw6kr')
  })

  it('omits the registration link when ineligible and none was provided', () => {
    const result = rwaExecutionGate({ rwa: true, walletConnected: true, eligibility: 'ineligible' })
    expect(result.canExecute).toBe(false)
    expect(result.registrationLink).toBeUndefined()
  })

  it('fails closed with a retry message when the eligibility check errors', () => {
    const result = rwaExecutionGate({ rwa: true, walletConnected: true, eligibility: 'error' })
    expect(result.canExecute).toBe(false)
    expect(result.reason).toBe("Couldn't verify eligibility. Try again.")
  })

  it('allows execution once the wallet is confirmed eligible', () => {
    const result = rwaExecutionGate({ rwa: true, walletConnected: true, eligibility: 'eligible' })
    expect(result).toEqual({ canExecute: true })
  })

  it('fails closed while eligibility has not been checked yet, connected + RWA', () => {
    const result = rwaExecutionGate({ rwa: true, walletConnected: true, eligibility: 'unknown' })
    expect(result.canExecute).toBe(false)
  })
})
