import { useState } from 'react'
import { Link } from 'react-router-dom'
import { loadLastOrder, saveLastOrder } from '../lib/lastOrder'
import { OrderBreakdown } from './OrderBreakdown'
import { PayNowButton } from './PayNowButton'
import { TransferPayment } from './TransferPayment'
import { primaryButtonClass } from './ui'

export default function OrderConfirmationPage() {
  const [order, setOrder] = useState(loadLastOrder)

  if (!order) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="font-serif text-5xl">Order confirmation</h1>
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
    <main className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-sm font-medium uppercase tracking-widest text-bark">Order placed</p>
      <h1 className="mt-1 font-serif text-5xl">Thank you, {order.customer_name}!</h1>
      <p role="status" className="mt-2">
        Your order has been placed. Order reference:{' '}
        <strong className="break-all">{order.order_id}</strong>
      </p>
      <p className="mt-2 text-muted">
        {order.payment_method === 'COD'
          ? 'You will pay cash on delivery.'
          : order.payment_method === 'TRANSFER' && order.status !== 'PENDING'
            ? 'Your payment is confirmed.'
            : 'Your order is waiting for payment.'}{' '}
        A confirmation will be sent to {order.customer_email}.
      </p>

      {order.payment_method === 'ONLINE' && order.payment_status === 'PENDING' && (
        <div className="mt-4 flex flex-col gap-2 rounded-[18px] border border-sand bg-paper p-4">
          <p>
            Please complete your payment within 30 minutes
            {order.payment_deadline_at
              ? ` (by ${new Date(order.payment_deadline_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })})`
              : ''}
            , or the order will be cancelled.
          </p>
          <PayNowButton orderId={order.order_id} />
        </div>
      )}

      <TransferPayment
        order={order}
        onUpdated={(updated) => {
          saveLastOrder(updated)
          setOrder(updated)
        }}
      />

      <div className="mt-6">
        <OrderBreakdown order={order} />
      </div>

      <h2 className="mt-8 font-serif text-2xl">Delivering to</h2>
      <p className="mt-1">
        {order.delivery_name}, {order.delivery_house_no}
        {order.delivery_street_number ? `, ${order.delivery_street_number}` : ''},{' '}
        {order.delivery_city}, {order.delivery_postal_code}, {order.delivery_country}
      </p>

      <p className="mt-6">
        <Link to="/shop" className={primaryButtonClass}>
          Continue shopping
        </Link>
      </p>
    </main>
  )
}
