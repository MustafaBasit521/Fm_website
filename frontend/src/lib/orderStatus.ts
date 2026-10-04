// Plain-text labels: status is always shown as words, never by colour alone.
const LABELS: Record<string, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
}
const PAYMENT_LABELS: Record<string, string> = {
  PENDING: 'Payment pending',
  PAID: 'Paid',
  PARTIALLY_REFUNDED: 'Partially refunded',
  REFUNDED: 'Refunded',
}

export const statusLabel = (s: string) => LABELS[s] ?? s
export const paymentStatusLabel = (s: string) => PAYMENT_LABELS[s] ?? s
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
