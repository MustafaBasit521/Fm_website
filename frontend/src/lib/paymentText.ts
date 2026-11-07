import type { PaymentMethod, RejectionReason } from './api'

const NAMES: Record<PaymentMethod, string> = {
  COD: 'Cash on Delivery',
  TRANSFER: 'bank or wallet transfer',
  EASYPAISA: 'Easypaisa',
  JAZZCASH: 'JazzCash',
  ONLINE: 'online payment',
}

/** "Cash on Delivery, Easypaisa or JazzCash": what the shop really offers right now, taken from
 *  the backend's list so the page can never promise a payment method that is switched off. */
export function paymentSummary(methods: PaymentMethod[]): string {
  const names = methods.map((m) => NAMES[m])
  if (names.length === 0) return 'Cash on Delivery'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

/** The name of a method as shown to people ("Easypaisa"). */
export const methodName = (m: PaymentMethod): string =>
  m === 'COD'
    ? 'Cash on delivery'
    : m === 'ONLINE'
      ? 'Pay online'
      : NAMES[m].replace(/^bank/, 'Bank')

/** The wallets that need the customer to send a transaction number and a receipt. */
export const isWalletMethod = (m: PaymentMethod): boolean => m === 'EASYPAISA' || m === 'JAZZCASH'

export const REJECTION_LABELS: Record<RejectionReason, string> = {
  INCORRECT_REFERENCE: 'Incorrect transaction number',
  AMOUNT_MISMATCH: 'Payment amount does not match',
  NOT_RECEIVED: 'Payment not received',
  UNCLEAR_RECEIPT: 'Invalid or unclear receipt',
  DUPLICATE_REFERENCE: 'Duplicate transaction number',
  OTHER: 'Other',
}
