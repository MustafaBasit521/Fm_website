import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { getWishlist, type Page, type ProductSummary } from '../lib/api'
import { formatPrice } from '../lib/money'
import { secondaryButtonClass } from '../pages/ui'
import { useWishlist } from '../wishlist/context'
import { Drawer } from './Drawer'

/** Saved pieces as a panel that slides in from the right. The full page (/wishlist) stays. */
export function WishlistDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session } = useAuth()
  const wl = useWishlist()
  const signedIn = session !== null
  const [data, setData] = useState<Page<ProductSummary> | null | 'error'>(null)

  useEffect(() => {
    if (!open || !signedIn) return
    const controller = new AbortController()
    getWishlist(1, controller.signal)
      .then(setData)
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setData('error')
      })
    return () => controller.abort()
  }, [open, signedIn])

  // hearts toggled while the panel is open update the list without another request
  const items =
    data && data !== 'error' ? data.items.filter((p) => wl.ids?.has(p.product_id) ?? true) : []

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Wishlist"
      side="right"
      footer={
        signedIn && items.length > 0 ? (
          <Link to="/wishlist" className={`${secondaryButtonClass} w-full`}>
            See all saved pieces
          </Link>
        ) : undefined
      }
    >
      {!signedIn && (
        <div className="py-8 text-center">
          <p className="font-serif text-3xl">Save what you love</p>
          <p className="mt-2 text-bark">Log in to keep a wishlist of your favourite pieces.</p>
          <p className="mt-5 flex flex-wrap justify-center gap-3">
            <Link to="/login" className={secondaryButtonClass}>
              Log in
            </Link>
            <Link to="/register" className={secondaryButtonClass}>
              Create account
            </Link>
          </p>
        </div>
      )}
      {signedIn && data === null && <p role="status">Loading…</p>}
      {signedIn && data === 'error' && (
        <p role="alert" className="text-danger">
          Could not load your wishlist.
        </p>
      )}
      {signedIn && data && data !== 'error' && items.length === 0 && (
        <div className="py-8 text-center">
          <p className="font-serif text-3xl">Nothing saved yet</p>
          <p className="mt-2 text-bark">Tap the heart on any piece to save it here.</p>
          <p className="mt-5">
            <Link to="/shop" className={secondaryButtonClass}>
              Browse the collection
            </Link>
          </p>
        </div>
      )}
      {items.length > 0 && (
        <ul className="flex flex-col gap-4">
          {items.map((p) => (
            <li key={p.product_id} className="flex flex-nowrap gap-3">
              <Link to={`/shop/${p.product_id}`} className="shrink-0">
                {p.image ? (
                  <img
                    src={p.image.url}
                    alt=""
                    className="h-20 w-16 rounded-[10px] bg-cream-200 object-cover"
                  />
                ) : (
                  <div aria-hidden="true" className="h-20 w-16 rounded-[10px] bg-cream-200" />
                )}
              </Link>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Link to={`/shop/${p.product_id}`} className="font-semibold hover:underline">
                  {p.name}
                </Link>
                <span>{formatPrice(p.price_paisa)}</span>
                <button
                  type="button"
                  className="self-start text-sm text-bark underline"
                  aria-label={`Remove ${p.name} from wishlist`}
                  onClick={() => void wl.toggle(p.product_id)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  )
}
