import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getAdminCustomer, getAdminCustomers } from '../lib/adminApi'
import { formatPrice } from '../lib/money'
import { formatDate, statusLabel } from '../lib/orderStatus'
import { inputClass } from './styles'
import { Pager, State } from './ui'
import { useLoad } from './useLoad'

export function CustomersAdminPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const { data, loading, failed } = useLoad(
    (s) => getAdminCustomers({ search, page }, s),
    [search, page],
  )
  return (
    <>
      <h1 className="font-serif text-4xl">Customers</h1>
      <div className="mt-4 flex flex-col gap-1 sm:w-80">
        <label htmlFor="c-search" className="text-sm font-medium text-bark">
          Search name or email
        </label>
        <input
          id="c-search"
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
      <div className="mt-6">
        <State
          loading={loading}
          failed={failed}
          empty={data?.items.length === 0}
          emptyText="No customers match."
        >
          {data && (
            <>
              <p className="text-muted">{data.total} customers</p>
              <ul className="mt-2 flex flex-col gap-2">
                {data.items.map((c) => (
                  <li key={c.customer_id} className="rounded-xl border border-sand bg-white p-3">
                    <Link
                      to={`/admin/customers/${c.customer_id}`}
                      className="flex flex-wrap justify-between gap-2"
                    >
                      <span>
                        <strong>{c.name}</strong>{' '}
                        <span className="text-sm text-muted">{c.email}</span>
                      </span>
                      <span className="text-sm text-muted">
                        {c.order_count} {c.order_count === 1 ? 'order' : 'orders'} · joined{' '}
                        {formatDate(c.created_at)}
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

export function CustomerAdminPage() {
  const { id = '' } = useParams()
  const { data, loading, failed } = useLoad((s) => getAdminCustomer(id, s), [id])
  return (
    <>
      <Link to="/admin/customers" className="text-terracotta underline">
        ← All customers
      </Link>
      <div className="mt-2">
        <State loading={loading} failed={failed}>
          {data && (
            <div className="flex flex-col gap-6">
              <header>
                <h1 className="font-serif text-4xl">{data.name}</h1>
                <p>
                  {data.email}
                  {data.phone ? ` · ${data.phone}` : ''}
                </p>
                <p className="text-sm text-muted">
                  Joined {formatDate(data.created_at)} ·{' '}
                  {data.subscribed_to_updates
                    ? 'subscribed to shop updates'
                    : 'not subscribed to updates'}{' '}
                  · {data.order_count} orders · {data.custom_order_count} custom requests
                </p>
              </header>
              <section aria-label="Recent orders">
                <h2 className="text-xl font-semibold">Recent orders</h2>
                {data.recent_orders.length === 0 ? (
                  <p className="mt-2">No orders yet.</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2">
                    {data.recent_orders.map((o) => (
                      <li key={o.order_id} className="rounded-xl border border-sand bg-white p-3">
                        <Link
                          to={`/admin/orders/${o.order_id}`}
                          className="flex flex-wrap justify-between gap-2"
                        >
                          <span>{formatDate(o.created_at)}</span>
                          <span>
                            {statusLabel(o.status)} · {formatPrice(o.total_amount_paisa)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </State>
      </div>
    </>
  )
}
