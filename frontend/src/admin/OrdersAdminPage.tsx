import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getAdminOrders } from '../lib/adminApi'
import { formatPrice } from '../lib/money'
import { formatDate, paymentStatusLabel, statusLabel } from '../lib/orderStatus'
import { inputClass } from './styles'
import { Chevron, PageTitle, Pager, State, cardClass, rowLinkClass } from './ui'
import { useLoad } from './useLoad'
import { StatusBadge } from '../pages/StatusBadge'

const STATUSES = ['', 'PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']

export default function OrdersAdminPage() {
  const [status, setStatus] = useState('')
  const [method, setMethod] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const { data, loading, failed } = useLoad(
    (s) => getAdminOrders({ status, payment_method: method, search, page }, s),
    [status, method, search, page],
  )

  return (
    <>
      <PageTitle
        eyebrow={data ? `${data.total} ${data.total === 1 ? 'order' : 'orders'}` : undefined}
        title="Orders"
      />
      <form
        role="search"
        className="mt-5 grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="o-status" className="text-sm font-medium text-bark">
            Status
          </label>
          <select
            id="o-status"
            className={inputClass}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s ? statusLabel(s) : 'All'}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="o-method" className="text-sm font-medium text-bark">
            Payment
          </label>
          <select
            id="o-method"
            className={inputClass}
            value={method}
            onChange={(e) => {
              setMethod(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All</option>
            <option value="COD">Cash on delivery</option>
            <option value="ONLINE">Online</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="o-search" className="text-sm font-medium text-bark">
            Search name, email or order id
          </label>
          <input
            id="o-search"
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

      <div className="mt-6">
        <State
          loading={loading}
          failed={failed}
          empty={data?.items.length === 0}
          emptyText="No orders match."
        >
          {data && (
            <>
              <div className={`${cardClass} overflow-hidden`}>
                <div
                  aria-hidden="true"
                  className="hidden grid-cols-[1fr_1.4fr_7rem_9rem_7rem_1rem] gap-x-4 border-b border-sand px-4 py-3 text-[11px] font-medium uppercase tracking-widest text-bark md:grid"
                >
                  <span>Order</span>
                  <span>Customer</span>
                  <span>Amount</span>
                  <span>Payment</span>
                  <span>Status</span>
                  <span />
                </div>
                <ul className="divide-y divide-sand">
                  {data.items.map((o) => (
                    <li key={o.order_id}>
                      <Link
                        to={`/orders/${o.order_id}`}
                        className={`${rowLinkClass} grid-cols-[1fr_auto] md:grid-cols-[1fr_1.4fr_7rem_9rem_7rem_1rem]`}
                      >
                        <span className="text-sm text-bark">{formatDate(o.created_at)}</span>
                        <span className="col-span-2 row-start-2 md:col-span-1 md:row-start-auto">
                          <strong>{o.customer_name}</strong>
                          <span className="block text-sm text-muted">
                            {o.item_count} {o.item_count === 1 ? 'item' : 'items'} ·{' '}
                            {o.customer_email}
                          </span>
                        </span>
                        <span className="whitespace-nowrap font-semibold">
                          {formatPrice(o.total_amount_paisa)}
                        </span>
                        <span className="text-sm">
                          {o.payment_method === 'COD'
                            ? 'Cash on delivery'
                            : paymentStatusLabel(o.payment_status)}
                        </span>
                        <span>
                          <StatusBadge status={o.status} />
                        </span>
                        <Chevron />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <Pager page={page} total={data.total} pageSize={20} onPage={setPage} />
            </>
          )}
        </State>
      </div>
    </>
  )
}
