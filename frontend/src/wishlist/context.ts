import { createContext, useContext } from 'react'

export interface WishlistContextValue {
  /** True once the signed-in shopper's saved ids are loaded (hearts can be shown). */
  enabled: boolean
  ids: Set<string> | null
  toggle: (productId: string) => Promise<void>
  failed: boolean
}

export const WishlistContext = createContext<WishlistContextValue | null>(null)

export function useWishlist(): WishlistContextValue {
  const ctx = useContext(WishlistContext)
  if (!ctx) throw new Error('useWishlist must be used inside <WishlistProvider>')
  return ctx
}
