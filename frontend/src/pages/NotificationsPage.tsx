import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
  type Page,
} from '../lib/api'
import { formatDate } from '../lib/orderStatus'

export default function NotificationsPage() {
  const [page, setPage] = useState(1)
  const [loaded, setLoaded] = useState<{ page: number; data: Page<AppNotification> | null } | null>(
    null,
  )
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getNotifications(page, controller.signal)
      .then((data) => setLoaded({ page, data }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setLoaded({ page, data: null })
      })
    return () => controller.abort()
  }, [page])

  const current = loaded?.page === page ? loaded : null
  const data = current?.data ?? null
  const isUnread = (n: AppNotification) => n.status === 'UNREAD' && !readIds.has(n.notification_id)
  const unreadHere = data ? data.items.filter(isUnread).length : 0
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  async function markOne(n: AppNotification) {
    setError(false)
    try {
      await markNotificationRead(n.notification_id)
      setReadIds((s) => new Set(s).add(n.notification_id))
    } catch {
      setError(true)
    }
  }

  async function markAll() {
    setError(false)
    try {
      await markAllNotificationsRead()
      setReadIds(new Set(data?.items.map((n) => n.notification_id) ?? []))
    } catch {
      setError(true)
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/account" className="text-terracotta underline">
        ← My account
      </Link>
      <h1 className="mt-2 font-serif text-4xl">Notifications</h1>

      {!current && (
        <p role="status" className="mt-6">
          Loading…
        </p>
      )}
      {current && !data && (
        <p role="alert" className="mt-6 text-danger">
          Could not load your notifications.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 text-danger">
          Could not update the notification. Please try again.
        </p>
      )}
      {data && data.items.length === 0 && <p className="mt-6">You have no notifications.</p>}
      {data && data.items.length > 0 && (
        <>
          {unreadHere > 0 && (
            <button
              type="button"
              className="mt-4 text-terracotta underline"
              onClick={() => void markAll()}
            >
              Mark all as read
            </button>
          )}
          <ul className="mt-4 flex flex-col gap-3">
            {data.items.map((n) => (
              <li
                key={n.notification_id}
                className={`rounded-xl border p-4 ${isUnread(n) ? 'border-terracotta bg-cream-100' : 'border-sand bg-white'}`}
              >
                <p className="flex justify-between gap-4">
                  <span className="font-semibold">
                    {isUnread(n) && <span className="mr-2 text-sm text-terracotta">New</span>}
                    {n.title}
                  </span>
                  <span className="text-sm text-muted">{formatDate(n.created_at)}</span>
                </p>
                <p className="mt-1">{n.message}</p>
                {isUnread(n) && (
                  <button
                    type="button"
                    className="mt-2 text-sm text-terracotta underline"
                    aria-label={`Mark "${n.title}" as read`}
                    onClick={() => void markOne(n)}
                  >
                    Mark as read
                  </button>
                )}
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
