import { Link } from 'react-router-dom'
import { getDashboard } from '../lib/adminApi'
import { formatPrice } from '../lib/money'
import { formatDate, statusLabel } from '../lib/orderStatus'
import { StatusBadge } from '../pages/StatusBadge'
import { buttonClass, secondaryButtonClass } from '../pages/ui'
import { ArrowUpRightIcon, PlusIcon } from './icons'
import { Chevron, PageTitle, State, cardClass, rowLinkClass } from './ui'
import { useLoad } from './useLoad'

const STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']
const SHOP_URL = (import.meta.env.VITE_SHOP_URL as string | undefined) ?? 'http://localhost:5173'

function greeting(now = new Date()) {
  const h = now.getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export default function DashboardPage() {
  const { data, loading, failed } = useLoad((s) => getDashboard(s), [])
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const stat = 'block rounded-[18px] border border-sand bg-paper p-4 hover:bg-cream-100'
  return (
    <>
      <PageTitle
        eyebrow={today}
        title={
          <>
            {greeting()}, <em className="text-terracotta">welcome back</em>
          </>
        }
        actions={
          <>
            <a
              href={SHOP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={secondaryButtonClass}
            >
              View shop <ArrowUpRightIcon />
            </a>
            <Link to="/products/new" className={buttonClass}>
              <PlusIcon /> Add product
            </Link>
          </>
        }
      />
      <div className="mt-6">
        <State loading={loading} failed={failed}>
          {data && (
            <div className="flex flex-col gap-6">
              {data.orders_needing_action > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-accent-tint bg-accent-tint p-4">
                  <p>
                    <strong>
                      {data.orders_needing_action}{' '}
                      {data.orders_needing_action === 1 ? 'order is' : 'orders are'} waiting for
                      you.
                    </strong>
                    <span className="block text-bark">
                      Customers can be told once you confirm them.
                    </span>
                  </p>
                  <Link to="/orders" className={buttonClass}>
                    Review orders
                  </Link>
                </div>
              )}

              <section aria-label="Needs attention">
                <h2 className="sr-only">Needs your attention</h2>
                <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  <li>
                    <Link to="/orders" className={stat}>
                      <span className="block text-4xl">{data.orders_needing_action}</span>
                      <span>
                        {data.orders_needing_action === 1
                          ? 'order to process'
                          : 'orders to process'}
                      </span>
                    </Link>
                  </li>
                  <li>
                    <Link to="/messages" className={stat}>
                      <span className="block text-4xl">{data.new_messages}</span>
                      <span>{data.new_messages === 1 ? 'new message' : 'new messages'}</span>
                    </Link>
                  </li>
                  <li className="col-span-2 md:col-span-1">
                    <Link to="/custom-orders" className={stat}>
                      <span className="block text-4xl">{data.new_custom_orders}</span>
                      <span>
                        {data.new_custom_orders === 1
                          ? 'new custom request'
                          : 'new custom requests'}
                      </span>
                    </Link>
                  </li>
                </ul>
              </section>

              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
                <section aria-label="Recent orders" className={cardClass}>
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
                    <h2 className="font-serif text-2xl">Recent orders</h2>
                    <Link to="/orders" className="text-sm underline underline-offset-4">
                      See all orders
                    </Link>
                  </div>
                  {data.recent_orders.length === 0 ? (
                    <p className="p-4">No orders yet.</p>
                  ) : (
                    <ul className="mt-3 divide-y divide-sand border-t border-sand">
                      {data.recent_orders.map((o) => (
                        <li key={o.order_id}>
                          <Link
                            to={`/orders/${o.order_id}`}
                            className={`${rowLinkClass} grid-cols-[1fr_auto] md:grid-cols-[1.4fr_6rem_7.5rem_1rem]`}
                          >
                            <span>
                              <strong>{o.customer_name}</strong>
                              <span className="block text-sm text-bark">
                                {formatDate(o.created_at)}
                              </span>
                            </span>
                            <span className="whitespace-nowrap font-semibold md:text-right">
                              {formatPrice(o.total_amount_paisa)}
                            </span>
                            <span className="col-start-2 text-right md:col-start-auto md:text-left">
                              <StatusBadge status={o.status} />
                            </span>
                            <Chevron />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <div className="flex flex-col gap-6">
                  <section aria-label="Orders by status" className={`${cardClass} p-4`}>
                    <h2 className="font-serif text-2xl">Orders by status</h2>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {STATUSES.map((s) => (
                        <li
                          key={s}
                          className="rounded-full border border-linen bg-cream-100 px-3 py-1 text-sm"
                        >
                          {statusLabel(s)}: <strong>{data.orders_by_status[s] ?? 0}</strong>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section aria-label="Running low" className={`${cardClass} p-4`}>
                    <h2 className="font-serif text-2xl">Running low</h2>
                    {data.low_stock_products.length === 0 ? (
                      <p className="mt-2">Everything is well stocked.</p>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-1">
                        {data.low_stock_products.map((p) => (
                          <li key={p.product_id}>
                            <Link
                              to={`/products/${p.product_id}`}
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
                </div>
              </div>
            </div>
          )}
        </State>
      </div>
    </>
  )
}
