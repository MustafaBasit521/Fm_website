import { BackLink } from './ui'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getOrders, type OrderSummary, type Page } from '../lib/api'
import { formatPrice } from '../lib/money'
import { formatDate, paymentStatusLabel } from '../lib/orderStatus'
import { StatusBadge } from './StatusBadge'
import { PageHeader } from './PageHeader'

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
      <BackLink to="/account">My account</BackLink>
      <PageHeader eyebrow="My account" title="My orders" />

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
              <li key={o.order_id} className="rounded-[18px] border border-sand bg-paper p-4">
                <Link
                  to={`/orders/${o.order_id}`}
                  className="flex flex-nowrap items-center gap-3 focus-visible:outline-2 focus-visible:outline-terracotta"
                >
                  {o.image_urls && o.image_urls.length > 0 && (
                    <span aria-hidden="true" className="flex shrink-0 flex-nowrap -space-x-3">
                      {o.image_urls.map((url) => (
                        <img
                          key={url}
                          src={url}
                          alt=""
                          className="h-14 w-12 rounded-[10px] border-2 border-paper bg-cream-200 object-cover"
                        />
                      ))}
                    </span>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex justify-between">
                      <span className="font-semibold">Order placed {formatDate(o.created_at)}</span>
                      <span>{formatPrice(o.total_amount_paisa)}</span>
                    </span>
                    <span className="text-sm text-muted">
                      {o.item_count} {o.item_count === 1 ? 'item' : 'items'} ·{' '}
                      <StatusBadge status={o.status} /> · ·{' '}
                      {o.payment_method === 'COD'
                        ? 'Cash on delivery'
                        : paymentStatusLabel(o.payment_status)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <nav aria-label="Pagination" className="mt-6 flex flex-wrap items-center gap-4">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="min-h-11 rounded-full border border-linen px-5 py-2 disabled:opacity-40"
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
                className="min-h-11 rounded-full border border-linen px-5 py-2 disabled:opacity-40"
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
