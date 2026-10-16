// Colours from the design system's "Order status" badges. Every pair has AA contrast
// (checked in contrast.test.ts). The status is always written out, never colour alone.
export const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  PENDING: { bg: '#f6e8c3', fg: '#6b4e12' },
  CONFIRMED: { bg: '#e9dfce', fg: '#5c4436' },
  PROCESSING: { bg: '#e0e3f1', fg: '#33407a' },
  SHIPPED: { bg: '#d9eaee', fg: '#1f5663' },
  DELIVERED: { bg: '#dde8d6', fg: '#3f5233' },
  CANCELLED: { bg: '#f5d9d6', fg: '#8a2a24' },
}

/** Custom-order statuses reuse the order-status colours: new = pending, in discussion = processing,
 *  accepted = confirmed, in progress = shipped, completed = delivered, declined/cancelled = red. */
export const CUSTOM_ORDER_TONE: Record<string, string> = {
  NEW: 'PENDING',
  IN_DISCUSSION: 'PROCESSING',
  ACCEPTED: 'CONFIRMED',
  IN_PROGRESS: 'SHIPPED',
  COMPLETED: 'DELIVERED',
  DECLINED: 'CANCELLED',
  CANCELLED: 'CANCELLED',
}
