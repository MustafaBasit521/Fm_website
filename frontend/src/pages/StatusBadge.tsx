import { statusLabel } from '../lib/orderStatus'
import { STATUS_COLORS } from './statusColors'

export function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.CONFIRMED
  return (
    <span
      className="inline-block rounded-full px-3 py-0.5 text-sm font-semibold"
      style={{ backgroundColor: c.bg, color: c.fg }}
    >
      {statusLabel(status)}
    </span>
  )
}
