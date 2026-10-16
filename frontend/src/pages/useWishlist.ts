import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/context'
import { addToWishlist, ApiError, getWishlistIds, removeFromWishlist } from '../lib/api'

/** Which products the signed-in shopper has saved, with a toggle. Signed out: `enabled` is false
 *  and nothing is requested (hearts are simply not shown). */
export function useWishlist() {
  const { session } = useAuth()
  const enabled = session !== null
  const [ids, setIds] = useState<Set<string> | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    getWishlistIds(controller.signal)
      .then((list) => setIds(new Set(list)))
      .catch(() => {})
    return () => controller.abort()
  }, [enabled])

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

  return { enabled: enabled && ids !== null, ids, toggle, failed }
}
