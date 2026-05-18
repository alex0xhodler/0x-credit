export interface TransactionReceiptStatusLike {
  status?: 'success' | 'reverted'
}

export function assertSuccessfulReceipt(
  receipt: TransactionReceiptStatusLike | undefined,
  message = 'Transaction failed on-chain.',
) {
  if (receipt?.status === 'success') return
  throw new Error(message)
}

export function formatTransactionError(error: unknown): string {
  const providerError = error && typeof error === 'object' ? error : undefined
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : providerError && 'message' in providerError && typeof providerError.message === 'string'
        ? providerError.message
      : 'The Gearbox route failed.'
  const code = providerError && 'code' in providerError ? providerError.code : undefined
  const name = providerError && 'name' in providerError ? providerError.name : undefined
  const normalizedMessage = message.toLowerCase()
  const isUserRejection = [
    'user rejected',
    'rejected the request',
    'user denied',
    'request rejected',
    'transaction rejected',
  ].some(fragment => normalizedMessage.includes(fragment)) ||
    code === 4001 ||
    name === 'UserRejectedRequestError'

  if (isUserRejection) return 'Transaction cancelled in your wallet. No funds moved.'

  return message
}
