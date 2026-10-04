import { useState } from 'react'
import { ApiError, payOrder } from '../lib/api'
import { redirectTo } from '../lib/navigation'
import { buttonClass } from './ui'

const MESSAGES: Record<string, string> = {
  ALREADY_PAID: 'This order is already paid.',
  PAYMENT_IN_PROGRESS:
    'A payment is already in progress. If you have finished paying, check the status again in a moment.',
  WINDOW_EXPIRED: 'The 30-minute payment window has passed, so this order can no longer be paid.',
  NOT_PAYABLE: 'This order can no longer be paid.',
}

export function PayNowButton({ orderId, label = 'Pay now' }: { orderId: string; label?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    setBusy(true)
    setError(null)
    try {
      const { redirect_url } = await payOrder(orderId)
      redirectTo(redirect_url)
    } catch (e) {
      setBusy(false)
      setError(
        e instanceof ApiError && e.code && MESSAGES[e.code]
          ? MESSAGES[e.code]
          : e instanceof ApiError && e.status === 503
            ? 'Online payment is temporarily unavailable. Please try again shortly.'
            : 'Could not start the payment. Please try again.',
      )
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" className={buttonClass} disabled={busy} onClick={() => void onClick()}>
        {busy ? 'Redirecting…' : label}
      </button>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
