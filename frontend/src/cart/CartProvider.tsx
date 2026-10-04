import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as cart from '../lib/cart'
import { CartContext, type CartContextValue } from './context'

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<cart.CartItems>(() => cart.loadCart())

  // Keep other tabs in sync: the browser fires `storage` in the tabs that did NOT write.
  useEffect(() => {
    const onStorage = () => setItems(cart.loadCart())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const update = useCallback((fn: (current: cart.CartItems) => cart.CartItems) => {
    setItems((current) => {
      const next = fn(current)
      cart.saveCart(next)
      return next
    })
  }, [])

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      units: cart.totalUnits(items),
      add: (id, qty = 1) => update((c) => cart.addItem(c, id, qty)),
      setQuantity: (id, qty) => update((c) => cart.setQuantity(c, id, qty)),
      remove: (id) => update((c) => cart.removeItem(c, id)),
      clear: () => update(() => []),
    }),
    [items, update],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
