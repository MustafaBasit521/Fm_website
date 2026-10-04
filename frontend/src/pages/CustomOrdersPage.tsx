import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  cancelCustomOrder,
  getCustomOrders,
  type CustomOrder,
  type CustomOrderStatus,
  type Page,
} from '../lib/api'
import { formatPrice } from '../lib/money'
import { formatDate } from '../lib/orderStatus'

const LABELS: Record<CustomOrderStatus, string> = {
  NEW: 'Received',
  IN_DISCUSSION: 'In discussion',
  ACCEPTED: 'Accepted',
  IN_PROGRESS: 'Being made',
  COMPLETED: 'Completed',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
}
// The customer may withdraw only before anything is agreed (the server enforces this too).
const CANCELLABLE: CustomOrderStatus[] = ['NEW', 'IN_DISCUSSION']

export default function CustomOrdersPage() {
  const [page, setPage] = useState(1)
  const [loaded, setLoaded] = useState<{ page: number; data: Page<CustomOrder> | null } | null>(
    null,
  )
  const [override, setOverride] = useState<Record<string, CustomOrder>>({})
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getCustomOrders(page, controller.signal)
      .then((data) => setLoaded({ page, data }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setLoaded({ page, data: null })
      })
    return () => controller.abort()
  }, [page])

  const current = loaded?.page === page ? loaded : null
  const data = current?.data ?? null
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  async function onCancel(id: string) {
    setError(null)
    try {
      const updated = await cancelCustomOrder(id)
      setOverride((o) => ({ ...o, [id]: updated }))
      setConfirming(null)
    } catch {
      setError('This request can no longer be cancelled here. Please contact the shop.')
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link to="/account" className="text-terracotta underline">
        ← My account
      </Link>
      <h1 className="mt-2 font-serif text-4xl">My custom orders</h1>

      {!current && (
        <p role="status" className="mt-6">
          Loading…
        </p>
      )}
      {current && !data && (
        <p role="alert" className="mt-6 text-danger">
          Could not load your custom orders.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 text-danger">
          {error}
        </p>
      )}
      {data && data.items.length === 0 && (
        <p className="mt-6">
          You have not sent any custom order requests.{' '}
          <Link to="/custom-order" className="text-terracotta underline">
            Send one
          </Link>
        </p>
      )}
      {data && data.items.length > 0 && (
        <>
          <ul className="mt-6 flex flex-col gap-3">
            {data.items.map((original) => {
              const c = override[original.custom_order_id] ?? original
              return (
                <li key={c.custom_order_id} className="rounded-xl border border-sand bg-white p-4">
                  <p className="flex justify-between">
                    <span className="font-semibold">{LABELS[c.status]}</span>
                    <span className="text-sm text-muted">Sent {formatDate(c.created_at)}</span>
                  </p>
                  <p className="mt-1 whitespace-pre-line">{c.description}</p>
                  <p className="mt-1 text-sm text-muted">
                    {c.budget_paisa !== null && <>Budget {formatPrice(c.budget_paisa)} · </>}
                    {c.required_date && <>Needed by {formatDate(c.required_date)} · </>}
                    {c.has_reference_image ? 'Picture attached' : 'No picture'}
                  </p>
                  {CANCELLABLE.includes(c.status) &&
                    (confirming === c.custom_order_id ? (
                      <p className="mt-2 flex gap-4">
                        <button
                          type="button"
                          className="text-danger underline"
                          onClick={() => void onCancel(c.custom_order_id)}
                        >
                          Yes, cancel this request
                        </button>
                        <button
                          type="button"
                          className="underline"
                          onClick={() => setConfirming(null)}
                        >
                          Keep it
                        </button>
                      </p>
                    ) : (
                      <button
                        type="button"
                        className="mt-2 text-danger underline"
                        onClick={() => {
                          setError(null)
                          setConfirming(c.custom_order_id)
                        }}
                      >
                        Cancel request
                      </button>
                    ))}
                </li>
              )
            })}
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
