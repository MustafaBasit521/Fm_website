import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getWishlist, removeFromWishlist, type Page, type ProductSummary } from '../lib/api'
import { AddToCartButton } from './AddToCartButton'
import { ProductCard } from './ProductCard'

export default function WishlistPage() {
  const [page, setPage] = useState(1)
  const [loaded, setLoaded] = useState<{ page: number; data: Page<ProductSummary> | null } | null>(
    null,
  )
  const [removeError, setRemoveError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getWishlist(page, controller.signal)
      .then((data) => setLoaded({ page, data }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setLoaded({ page, data: null })
      })
    return () => controller.abort()
  }, [page])

  const current = loaded?.page === page ? loaded : null
  const data = current?.data ?? null

  async function remove(productId: string) {
    setRemoveError(false)
    try {
      await removeFromWishlist(productId)
      setLoaded((prev) =>
        prev && prev.data
          ? {
              ...prev,
              data: {
                ...prev.data,
                total: prev.data.total - 1,
                items: prev.data.items.filter((p) => p.product_id !== productId),
              },
            }
          : prev,
      )
    } catch {
      setRemoveError(true)
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Link to="/account" className="text-terracotta underline">
        ← My account
      </Link>
      <h1 className="mt-2 font-serif text-4xl">My wishlist</h1>

      {!current && (
        <p role="status" className="mt-6">
          Loading…
        </p>
      )}
      {current && !data && (
        <p role="alert" className="mt-6 text-danger">
          Could not load your wishlist.
        </p>
      )}
      {removeError && (
        <p role="alert" className="mt-4 text-danger">
          Could not remove that item. Please try again.
        </p>
      )}
      {data && data.items.length === 0 && (
        <p className="mt-6">
          Your wishlist is empty.{' '}
          <Link to="/shop" className="text-terracotta underline">
            Browse the shop
          </Link>
        </p>
      )}
      {data && data.items.length > 0 && (
        <>
          <ul className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {data.items.map((p) => (
              <li key={p.product_id} className="flex flex-col gap-2">
                <ProductCard product={p} />
                <AddToCartButton
                  compact
                  productId={p.product_id}
                  productName={p.name}
                  disabled={!p.is_available}
                />
                <button
                  type="button"
                  className="text-left text-danger underline"
                  aria-label={`Remove ${p.name} from wishlist`}
                  onClick={() => void remove(p.product_id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <nav aria-label="Pagination" className="mt-6 flex items-center gap-4">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="rounded-lg border border-sand px-3 py-1 disabled:opacity-40"
              >
                Previous
              </button>
              <span>
                Page {data.page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="rounded-lg border border-sand px-3 py-1 disabled:opacity-40"
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </main>
  )
}
