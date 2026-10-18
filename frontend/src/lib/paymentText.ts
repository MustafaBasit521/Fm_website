import type { PaymentMethod } from './api'

const NAMES: Record<PaymentMethod, string> = {
  COD: 'Cash on Delivery',
  TRANSFER: 'bank or wallet transfer',
  ONLINE: 'online payment',
}

/** "Cash on Delivery or bank or wallet transfer": what the shop really offers right now, taken
 *  from the backend's list so the page can never promise a payment method that is switched off. */
export function paymentSummary(methods: PaymentMethod[]): string {
  const names = methods.map((m) => NAMES[m])
  return names.length === 0 ? 'Cash on Delivery' : names.join(' or ')
}
