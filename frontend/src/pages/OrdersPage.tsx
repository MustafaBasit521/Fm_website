import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getOrders, type OrderSummary, type Page } from '../lib/api'
import { formatPrice } from '../lib/money'
import { formatDate, paymentStatusLabel, statusLabel } from '../lib/orderStatus'

export default function OrdersPage() {
  const [page, setPage] = useState(1)
  const [loaded, setLoaded] = useState<{ page: number; data: Page<OrderSummary> | null } | null>(
    null,
  )

  useEffect(() => {
    const controller = new AbortController()
    getOrders(page, controller.signal)
      .then((data) => setLoaded({ page, data }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setLoaded({ page, data: null })
      })
    return () => controller.abort()
  }, [page])

  const current = loaded?.page === page ? loaded : null
  const data = current?.data ?? null
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link to="/account" className="text-terracotta underline">
        ← My account
      </Link>
      <h1 className="mt-2 font-serif text-4xl">My orders</h1>

      {!current && (
        <p role="status" className="mt-6">
          Loading…
        </p>
      )}
      {current && !data && (
        <p role="alert" className="mt-6 text-danger">
          Could not load your orders.
        </p>
      )}
      {data && data.items.length === 0 && (
        <p className="mt-6">
          You have not placed any orders yet.{' '}
          <Link to="/shop" className="text-terracotta underline">
            Browse the shop
          </Link>
        </p>
      )}
      {data && data.items.length > 0 && (
        <>
          <ul className="mt-6 flex flex-col gap-3">
            {data.items.map((o) => (
              <li key={o.order_id} className="rounded-xl border border-sand bg-white p-4">
                <Link
                  to={`/orders/${o.order_id}`}
                  className="flex flex-col gap-1 focus-visible:outline-2 focus-visible:outline-terracotta"
                >
                  <span className="flex justify-between">
                    <span className="font-semibold">Order placed {formatDate(o.created_at)}</span>
                    <span>{formatPrice(o.total_amount_paisa)}</span>
                  </span>
                  <span className="text-sm text-muted">
                    {o.item_count} {o.item_count === 1 ? 'item' : 'items'} · {statusLabel(o.status)}{' '}
                    ·{' '}
                    {o.payment_method === 'COD'
                      ? 'Cash on delivery'
                      : paymentStatusLabel(o.payment_status)}
                  </span>
                </Link>
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
