import type { ProductSummary } from '../lib/api'

/** Availability in words plus a coloured dot (never colour alone). */
export function stockLabel(p: Pick<ProductSummary, 'is_available' | 'availability_type'>): {
  text: string
  dot: string
} {
  if (!p.is_available) return { text: 'Currently unavailable', dot: 'bg-danger' }
  if (p.availability_type === 'MADE_TO_ORDER') return { text: 'Made to order', dot: 'bg-bark' }
  return { text: 'In stock', dot: 'bg-moss' }
}
