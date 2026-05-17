import { describe, expect, it } from 'vitest'
import { assertSuccessfulReceipt } from './transactions'

describe('Gearbox transaction helpers', () => {
  it('accepts successful on-chain receipts', () => {
    expect(() => assertSuccessfulReceipt({ status: 'success' })).not.toThrow()
  })

  it('rejects reverted on-chain receipts before local position state can be stored', () => {
    expect(() => assertSuccessfulReceipt({ status: 'reverted' }, 'Opening position failed on-chain.')).toThrow(
      'Opening position failed on-chain.',
    )
  })
})
