// Browser cart (business-rules §11): just product ids and quantities in localStorage.
// There are no cart tables. Prices and availability always come from the backend quote.
import type { CartLine } from './api'

export const MAX_LINE_QUANTITY = 99
export const MAX_LINES = 50
const STORAGE_KEY = 'crochet-cart-v1'

export type CartItems = CartLine[]

const clampQuantity = (n: number) => Math.min(MAX_LINE_QUANTITY, Math.max(1, Math.floor(n)))

/** Defensive: localStorage can hold anything (old versions, edits, corruption). */
export function sanitize(raw: unknown): CartItems {
  if (!Array.isArray(raw)) return []
  const merged = new Map<string, number>()
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const { product_id, quantity } = entry as Record<string, unknown>
    if (
      typeof product_id !== 'string' ||
      typeof quantity !== 'number' ||
      !Number.isFinite(quantity)
    )
      continue
    if (quantity < 1) continue
    merged.set(product_id, clampQuantity((merged.get(product_id) ?? 0) + quantity))
  }
  return [...merged].slice(0, MAX_LINES).map(([product_id, quantity]) => ({ product_id, quantity }))
}

export function loadCart(): CartItems {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? sanitize(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function saveCart(items: CartItems): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // storage unavailable (private mode, quota): the cart still works for this session
  }
}

export function addItem(items: CartItems, productId: string, quantity = 1): CartItems {
  const existing = items.find((i) => i.product_id === productId)
  if (existing) {
    return items.map((i) =>
      i.product_id === productId ? { ...i, quantity: clampQuantity(i.quantity + quantity) } : i,
    )
  }
  if (items.length >= MAX_LINES) return items
  return [...items, { product_id: productId, quantity: clampQuantity(quantity) }]
}

export function setQuantity(items: CartItems, productId: string, quantity: number): CartItems {
  if (quantity < 1) return removeItem(items, productId)
  return items.map((i) =>
    i.product_id === productId ? { ...i, quantity: clampQuantity(quantity) } : i,
  )
}

export function removeItem(items: CartItems, productId: string): CartItems {
  return items.filter((i) => i.product_id !== productId)
}

export const totalUnits = (items: CartItems) => items.reduce((n, i) => n + i.quantity, 0)
