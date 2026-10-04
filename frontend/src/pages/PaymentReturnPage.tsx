import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { refreshPayment, type PaymentStatusResponse } from '../lib/api'
import { PayNowButton } from './PayNowButton'

export default function PaymentReturnPage() {
  const [params] = useSearchParams()
  const orderId = params.get('order') ?? ''
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{
    key: string
    result: PaymentStatusResponse | null
  } | null>(null)

  const key = `${orderId}:${attempt}`
  useEffect(() => {
    if (!orderId) return
    // The browser only returns here; the server asks the payment provider what really happened.
    refreshPayment(orderId)
      .then((result) => setLoaded({ key, result }))
      .catch(() => setLoaded({ key, result: null }))
  }, [orderId, key])

  if (!orderId) {
    return (
      <main className="mx-auto max-w-xl px-4 py-8">
        <h1 className="font-serif text-4xl">Payment</h1>
        <p className="mt-4">No order was specified.</p>
        <p className="mt-2">
          <Link to="/shop" className="text-terracotta underline">
            Back to the shop
          </Link>
        </p>
      </main>
    )
  }

  const current = loaded?.key === key ? loaded : null
  const result = current?.result ?? null
  const paid = result && ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(result.payment_status)

  let heading = 'Checking your payment…'
  let body: React.ReactNode = null
  if (current && !result) {
    heading = 'Could not check your payment'
    body = (
      <p role="alert" className="text-danger">
        We could not reach the payment service. If you paid, your order will be updated shortly.
      </p>
    )
  } else if (result && paid && result.order_status === 'CANCELLED') {
    heading = 'Your payment arrived too late'
    body = (
      <p>
        The 30-minute payment window had already passed and the order was cancelled. Your payment
        will be refunded in full.
      </p>
    )
  } else if (result && paid) {
    heading = 'Payment received'
    body = <p>Thank you! Your order is confirmed.</p>
  } else if (result?.order_status === 'CANCELLED') {
    heading = 'Order cancelled'
    body = <p>This order was cancelled, so it can no longer be paid.</p>
  } else if (result?.payment_status === 'FAILED') {
    heading = 'Payment failed'
    body = (
      <>
        <p>Your payment did not go through. Your order is still reserved for a short time.</p>
        <PayNowButton orderId={orderId} label="Try paying again" />
      </>
    )
  } else if (result) {
    heading = 'Waiting for your payment'
    body = (
      <>
        <p>We have not received a confirmation yet.</p>
        <button
          type="button"
          className="text-left text-terracotta underline"
          onClick={() => setAttempt((n) => n + 1)}
        >
          Check again
        </button>
      </>
    )
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-8">
      <h1 className="font-serif text-4xl" role="status">
        {heading}
      </h1>
      {body}
      <p>
        <Link to="/shop" className="text-terracotta underline">
          Continue shopping
        </Link>
      </p>
    </main>
  )
}
