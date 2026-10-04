import type { Order } from './api'

const KEY = 'crochet-last-order'

// Guests cannot look orders up later (they contact the shop instead, business-rules §24), so the
// confirmation shown right after checkout is kept for this browser tab only.
export function saveLastOrder(order: Order): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(order))
  } catch {
    // ignore: the confirmation page falls back to a generic message
  }
}

export function loadLastOrder(): Order | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Order) : null
  } catch {
    return null
  }
}
