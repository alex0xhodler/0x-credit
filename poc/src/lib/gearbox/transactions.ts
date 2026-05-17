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
