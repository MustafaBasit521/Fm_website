import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { addToWishlist, ApiError, getWishlistIds, removeFromWishlist } from '../lib/api'

/** Wishlist is for registered customers only: signed-out visitors are pointed to log in. */
export function WishlistButton({ productId }: { productId: string }) {
  const { session } = useAuth()
  const [state, setState] = useState<{ productId: string; saved: boolean } | null>(null)
  const [error, setError] = useState(false)
  const signedIn = session !== null

  useEffect(() => {
    if (!signedIn) return
    const controller = new AbortController()
    getWishlistIds(controller.signal)
      .then((ids) => setState({ productId, saved: ids.includes(productId) }))
      .catch(() => {})
    return () => controller.abort()
  }, [signedIn, productId])

  if (!signedIn) {
    return (
      <Link to="/login" className="text-terracotta underline">
        Log in to save to your wishlist
      </Link>
    )
  }

  const known = state?.productId === productId
  const saved = known && state.saved

  async function toggle() {
    setError(false)
    try {
      if (saved) {
        await removeFromWishlist(productId)
        setState({ productId, saved: false })
      } else {
        try {
          await addToWishlist(productId)
        } catch (e) {
          // 409 = already there (e.g. another tab): the end state is what the user wanted.
          if (!(e instanceof ApiError && e.status === 409)) throw e
        }
        setState({ productId, saved: true })
      }
    } catch {
      setError(true)
    }
  }

  return (
    <div>
      <button
        type="button"
        aria-pressed={saved}
        disabled={!known}
        onClick={() => void toggle()}
        className="rounded-lg border border-terracotta px-4 py-2 text-terracotta hover:bg-cream-100 disabled:opacity-50"
      >
        {saved ? '♥ Saved to wishlist' : '♡ Add to wishlist'}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-danger">
          Could not update your wishlist. Please try again.
        </p>
      )}
    </div>
  )
}
