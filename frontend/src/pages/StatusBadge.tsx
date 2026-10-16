import { statusLabel } from '../lib/orderStatus'
import { STATUS_COLORS } from './statusColors'

/** `status` picks the colours (an order status); `label` overrides the words shown. */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.CONFIRMED
  return (
    <span
      className="inline-block rounded-full px-3 py-0.5 text-sm font-semibold"
      style={{ backgroundColor: c.bg, color: c.fg }}
    >
      {label ?? statusLabel(status)}
    </span>
  )
}
