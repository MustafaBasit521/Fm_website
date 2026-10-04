import { Link } from 'react-router-dom'
import { loadLastOrder } from '../lib/lastOrder'
import { formatPrice } from '../lib/money'

export default function OrderConfirmationPage() {
  const order = loadLastOrder()

  if (!order) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="font-serif text-4xl">Order confirmation</h1>
        <p className="mt-4">We could not find a recent order in this browser.</p>
        <p className="mt-2">
          <Link to="/shop" className="text-terracotta underline">
            Back to the shop
          </Link>
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="font-serif text-4xl">Thank you, {order.customer_name}!</h1>
      <p role="status" className="mt-2">
        Your order has been placed. Order reference:{' '}
        <strong className="break-all">{order.order_id}</strong>
      </p>
      <p className="mt-2 text-muted">
        {order.payment_method === 'COD'
          ? 'You will pay cash on delivery.'
          : 'Your order is waiting for payment.'}{' '}
        A confirmation will be sent to {order.customer_email}.
      </p>

      <h2 className="mt-6 text-xl font-semibold">Items</h2>
      <ul className="mt-2 flex flex-col gap-1">
        {order.items.map((i) => (
          <li
            key={`${i.product_name_snapshot}-${i.unit_price_at_purchase_paisa}`}
            className="flex justify-between"
          >
            <span>
              {i.quantity} × {i.product_name_snapshot}
            </span>
            <span>{formatPrice(i.quantity * i.unit_price_at_purchase_paisa)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-4 grid grid-cols-2 gap-1 text-right">
        <dt className="text-left">Subtotal</dt>
        <dd>{formatPrice(order.subtotal_paisa)}</dd>
        <dt className="text-left">Delivery</dt>
        <dd>{formatPrice(order.delivery_fee_paisa)}</dd>
        <dt className="text-left font-semibold">Total</dt>
        <dd className="font-semibold">{formatPrice(order.total_amount_paisa)}</dd>
      </dl>

      <h2 className="mt-6 text-xl font-semibold">Delivering to</h2>
      <p>
        {order.delivery_name}, {order.delivery_house_no}
        {order.delivery_street_number ? `, ${order.delivery_street_number}` : ''},{' '}
        {order.delivery_city}, {order.delivery_postal_code}, {order.delivery_country}
      </p>

      <p className="mt-6">
        <Link to="/shop" className="text-terracotta underline">
          Continue shopping
        </Link>
      </p>
    </main>
  )
}
