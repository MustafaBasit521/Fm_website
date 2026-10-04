import { useState } from 'react'
import { getAdminCustomOrders, setCustomOrderStatus, type AdminCustomOrder } from '../lib/adminApi'
import { ApiError, type CustomOrderStatus } from '../lib/api'
import { formatPrice } from '../lib/money'
import { formatDate } from '../lib/orderStatus'
import { inputClass } from './styles'
import { Badge, Pager, State } from './ui'
import { useLoad } from './useLoad'

const LABELS: Record<CustomOrderStatus, string> = {
  NEW: 'New',
  IN_DISCUSSION: 'In discussion',
  ACCEPTED: 'Accepted',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
}
// What the admin may do next (the server enforces the same rules).
const NEXT: Record<string, [CustomOrderStatus, string][]> = {
  NEW: [
    ['IN_DISCUSSION', 'Start discussion'],
    ['DECLINED', 'Decline'],
    ['CANCELLED', 'Cancel'],
  ],
  IN_DISCUSSION: [
    ['ACCEPTED', 'Accept'],
    ['DECLINED', 'Decline'],
    ['CANCELLED', 'Cancel'],
  ],
  ACCEPTED: [
    ['IN_PROGRESS', 'Start making'],
    ['CANCELLED', 'Cancel'],
  ],
  IN_PROGRESS: [
    ['COMPLETED', 'Mark completed'],
    ['CANCELLED', 'Cancel'],
  ],
}

export default function CustomOrdersAdminPage() {
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const { data, loading, failed } = useLoad(
    (s) => getAdminCustomOrders({ status, search, page }, s),
    [status, search, page],
  )
  const [override, setOverride] = useState<Record<string, AdminCustomOrder>>({})
  const [error, setError] = useState<string | null>(null)

  async function move(id: string, target: CustomOrderStatus) {
    setError(null)
    try {
      const updated = await setCustomOrderStatus(id, target)
      setOverride((o) => ({ ...o, [id]: updated }))
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'INVALID_TRANSITION'
          ? 'That change is not allowed from the current status. Reload the page.'
          : 'Could not change the status.',
      )
    }
  }

  return (
    <>
      <h1 className="font-serif text-4xl">Custom orders</h1>
      <form
        role="search"
        className="mt-4 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="co-status" className="text-sm font-medium text-bark">
            Status
          </label>
          <select
            id="co-status"
            className={inputClass}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All</option>
            {Object.entries(LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="co-search" className="text-sm font-medium text-bark">
            Search name, WhatsApp or description
          </label>
          <input
            id="co-search"
            type="search"
            maxLength={100}
            className={inputClass}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setSearch(e.currentTarget.value.trim())
                setPage(1)
              }
            }}
          />
        </div>
      </form>
      {error && (
        <p role="alert" className="mt-4 text-danger">
          {error}
        </p>
      )}
      <div className="mt-6">
        <State
          loading={loading}
          failed={failed}
          empty={data?.items.length === 0}
          emptyText="No custom orders match."
        >
          {data && (
            <>
              <ul className="flex flex-col gap-3">
                {data.items.map((original) => {
                  const c = override[original.custom_order_id] ?? original
                  return (
                    <li
                      key={c.custom_order_id}
                      className="rounded-xl border border-sand bg-white p-4"
                    >
                      <p className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <strong>{c.name}</strong> · WhatsApp {c.whatsapp_number}
                        </span>
                        <span className="flex items-center gap-2">
                          <Badge>{LABELS[c.status]}</Badge>
                          <span className="text-sm text-muted">{formatDate(c.created_at)}</span>
                        </span>
                      </p>
                      <p className="mt-2 whitespace-pre-line">{c.description}</p>
                      <p className="mt-1 text-sm text-muted">
                        {c.budget_paisa !== null && <>Budget {formatPrice(c.budget_paisa)} · </>}
                        {c.required_date && <>Needed by {formatDate(c.required_date)} · </>}
                        {c.customer_id ? 'Registered customer' : 'Guest'}
                      </p>
                      {c.reference_image_url && (
                        <p className="mt-1">
                          <a
                            href={c.reference_image_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-terracotta underline"
                          >
                            View reference picture
                          </a>{' '}
                          <span className="text-sm text-muted">(link expires after an hour)</span>
                        </p>
                      )}
                      {NEXT[c.status] && (
                        <p className="mt-3 flex flex-wrap gap-3">
                          {NEXT[c.status].map(([target, label]) => (
                            <button
                              key={target}
                              type="button"
                              className="rounded-lg border border-terracotta px-3 py-1 text-terracotta hover:bg-cream-100"
                              onClick={() => void move(c.custom_order_id, target)}
                            >
                              {label}
                            </button>
                          ))}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
              <Pager page={page} total={data.total} pageSize={20} onPage={setPage} />
            </>
          )}
        </State>
      </div>
    </>
  )
}
