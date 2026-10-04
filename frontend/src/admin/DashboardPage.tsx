import { Link } from 'react-router-dom'
import { getDashboard } from '../lib/adminApi'
import { formatPrice } from '../lib/money'
import { formatDate, statusLabel } from '../lib/orderStatus'
import { State } from './ui'
import { useLoad } from './useLoad'

const STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']

export default function DashboardPage() {
  const { data, loading, failed } = useLoad((s) => getDashboard(s), [])
  return (
    <>
      <h1 className="font-serif text-4xl">Dashboard</h1>
      <div className="mt-4">
        <State loading={loading} failed={failed}>
          {data && (
            <div className="flex flex-col gap-8">
              <section aria-label="Needs attention">
                <h2 className="text-xl font-semibold">Needs your attention</h2>
                <ul className="mt-2 grid gap-3 sm:grid-cols-3">
                  <li className="rounded-xl border border-sand bg-white p-4">
                    <Link to="/admin/orders" className="block">
                      <span className="block text-3xl">{data.orders_needing_action}</span>
                      <span>
                        {data.orders_needing_action === 1
                          ? 'order to process'
                          : 'orders to process'}
                      </span>
                    </Link>
                  </li>
                  <li className="rounded-xl border border-sand bg-white p-4">
                    <Link to="/admin/messages" className="block">
                      <span className="block text-3xl">{data.new_messages}</span>
                      <span>{data.new_messages === 1 ? 'new message' : 'new messages'}</span>
                    </Link>
                  </li>
                  <li className="rounded-xl border border-sand bg-white p-4">
                    <Link to="/admin/custom-orders" className="block">
                      <span className="block text-3xl">{data.new_custom_orders}</span>
                      <span>
                        {data.new_custom_orders === 1
                          ? 'new custom request'
                          : 'new custom requests'}
                      </span>
                    </Link>
                  </li>
                </ul>
              </section>

              <section aria-label="Orders by status">
                <h2 className="text-xl font-semibold">Orders by status</h2>
                <ul className="mt-2 flex flex-wrap gap-3">
                  {STATUSES.map((s) => (
                    <li key={s} className="rounded-lg border border-sand bg-white px-3 py-2">
                      {statusLabel(s)}: <strong>{data.orders_by_status[s] ?? 0}</strong>
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-label="Running low">
                <h2 className="text-xl font-semibold">Running low</h2>
                {data.low_stock_products.length === 0 ? (
                  <p className="mt-2">Everything is well stocked.</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1">
                    {data.low_stock_products.map((p) => (
                      <li key={p.product_id}>
                        <Link
                          to={`/admin/products/${p.product_id}`}
                          className="text-terracotta underline"
                        >
                          {p.name}
                        </Link>{' '}
                        — {p.stock_quantity === 0 ? 'sold out' : `${p.stock_quantity} left`}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

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
                          <span>
                            <strong>{o.customer_name}</strong> · {formatDate(o.created_at)}
                          </span>
                          <span>
                            {statusLabel(o.status)} · {formatPrice(o.total_amount_paisa)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2">
                  <Link to="/admin/orders" className="text-terracotta underline">
                    See all orders
                  </Link>
                </p>
              </section>
            </div>
          )}
        </State>
      </div>
    </>
  )
}
