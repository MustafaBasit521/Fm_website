import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/context'
import { addToWishlist, ApiError, getWishlistIds, removeFromWishlist } from '../lib/api'
import { WishlistContext } from './context'

/** Which products the signed-in shopper has saved, shared by every heart, the header badge and
 *  the wishlist panel. Signed out: nothing is requested. */
export function WishlistProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const signedIn = session !== null
  const [ids, setIds] = useState<Set<string> | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!signedIn) return
    const controller = new AbortController()
    getWishlistIds(controller.signal)
      .then((list) => setIds(new Set(list)))
      .catch(() => {})
    return () => controller.abort()
  }, [signedIn])

  const toggle = useCallback(
    async (productId: string) => {
      const saved = ids?.has(productId) ?? false
      setFailed(false)
      try {
        if (saved) await removeFromWishlist(productId)
        else {
          try {
            await addToWishlist(productId)
          } catch (e) {
            if (!(e instanceof ApiError && e.status === 409)) throw e // 409 = already saved
          }
        }
        setIds((current) => {
          const next = new Set(current ?? [])
          if (saved) next.delete(productId)
          else next.add(productId)
          return next
        })
      } catch {
        setFailed(true)
      }
    },
    [ids],
  )

  const value = useMemo(
    () => ({ enabled: signedIn && ids !== null, ids: signedIn ? ids : null, toggle, failed }),
    [signedIn, ids, toggle, failed],
  )
  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>
}
