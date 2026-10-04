import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getAdminOrders } from '../lib/adminApi'
import { formatPrice } from '../lib/money'
import { formatDate, paymentStatusLabel, statusLabel } from '../lib/orderStatus'
import { inputClass } from './styles'
import { Pager, State } from './ui'
import { useLoad } from './useLoad'

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
      <h1 className="font-serif text-4xl">Orders</h1>
      <form
        role="search"
        className="mt-4 grid gap-3 sm:grid-cols-3"
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
              <p className="text-muted">{data.total} orders</p>
              <ul className="mt-2 flex flex-col gap-2">
                {data.items.map((o) => (
                  <li key={o.order_id} className="rounded-xl border border-sand bg-white p-3">
                    <Link
                      to={`/admin/orders/${o.order_id}`}
                      className="flex flex-wrap justify-between gap-2"
                    >
                      <span>
                        <strong>{o.customer_name}</strong>{' '}
                        <span className="text-sm text-muted">{o.customer_email}</span>
                        <span className="block text-sm text-muted">
                          {formatDate(o.created_at)} · {o.item_count}{' '}
                          {o.item_count === 1 ? 'item' : 'items'}
                        </span>
                      </span>
                      <span className="text-right">
                        {statusLabel(o.status)}
                        <span className="block text-sm text-muted">
                          {formatPrice(o.total_amount_paisa)} ·{' '}
                          {o.payment_method === 'COD'
                            ? 'Cash on delivery'
                            : paymentStatusLabel(o.payment_status)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Pager page={page} total={data.total} pageSize={20} onPage={setPage} />
            </>
          )}
        </State>
      </div>
    </>
  )
}
