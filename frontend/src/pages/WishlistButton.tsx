import { Link } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { HeartIcon } from '../shop/icons'
import { useWishlist } from '../wishlist/context'
import { secondaryButtonClass } from './ui'

/** Wishlist is for registered customers only: signed-out visitors are pointed to log in. The
 *  saved pieces are shared with the header heart, the wishlist panel and the hearts on cards
 *  (one list in `WishlistProvider`), so they can never disagree. */
export function WishlistButton({ productId }: { productId: string }) {
  const { session } = useAuth()
  const wl = useWishlist()

  if (session === null) {
    return (
      <Link to="/login" className="text-terracotta underline">
        Log in to save to your wishlist
      </Link>
    )
  }

  const saved = wl.ids?.has(productId) ?? false

  return (
    <div>
      <button
        type="button"
        aria-pressed={saved}
        disabled={!wl.enabled}
        onClick={() => void wl.toggle(productId)}
        className={`${secondaryButtonClass} w-full ${saved ? 'border-terracotta text-terracotta' : ''}`}
      >
        <HeartIcon fill={saved ? 'currentColor' : 'none'} />
        {saved ? 'Saved to wishlist' : 'Add to wishlist'}
      </button>
      {wl.failed && (
        <p role="alert" className="mt-1 text-danger">
          Could not update your wishlist. Please try again.
        </p>
      )}
    </div>
  )
}
