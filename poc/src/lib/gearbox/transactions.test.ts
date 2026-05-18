import { describe, expect, it } from 'vitest'
import { assertSuccessfulReceipt, formatTransactionError } from './transactions'

describe('Gearbox transaction helpers', () => {
  it('accepts successful on-chain receipts', () => {
    expect(() => assertSuccessfulReceipt({ status: 'success' })).not.toThrow()
  })

  it('rejects reverted on-chain receipts before local position state can be stored', () => {
    expect(() => assertSuccessfulReceipt({ status: 'reverted' }, 'Opening position failed on-chain.')).toThrow(
      'Opening position failed on-chain.',
    )
  })

  it('formats wallet cancellation errors without exposing raw request details', () => {
    const message = formatTransactionError(
      [
        'User rejected the request.',
        'Request Arguments:',
        'from: 0x894003A817e5c1AAFaC95b710bd2b68f0c040095',
        'Contract Call:',
        'Version: viem@2.47.0',
      ].join(' '),
    )

    expect(message).toBe('Transaction cancelled in your wallet. No funds moved.')
    expect(message).not.toContain('Request Arguments')
    expect(message).not.toContain('viem@')
  })

  it('formats provider cancellation objects by their rejection code', () => {
    expect(formatTransactionError({
      code: 4001,
      message: 'User rejected the request. Request Arguments: from: 0x894003A817e5c1AAFaC95b710bd2b68f0c040095',
    })).toBe('Transaction cancelled in your wallet. No funds moved.')
  })
})
