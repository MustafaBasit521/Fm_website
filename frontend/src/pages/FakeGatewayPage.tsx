import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { fakeGatewayComplete } from '../lib/api'
import { buttonClass } from './ui'

/** DEVELOPMENT ONLY. Simulates the payment gateway so the whole online-payment flow can be tried
 *  without a real gateway. Routed only in dev builds, and the backend endpoint it calls exists
 *  only when PAYMENT_PROVIDER=fake (never in production). */
export default function FakeGatewayPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const reference = params.get('ref') ?? ''
  const orderId = params.get('order') ?? ''
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function finish(outcome: 'paid' | 'failed') {
    setBusy(true)
    setError(null)
    try {
      await fakeGatewayComplete(reference, outcome)
      navigate(`/payment/return?order=${encodeURIComponent(orderId)}`)
    } catch {
      setBusy(false)
      setError('The fake gateway could not process that. Is PAYMENT_PROVIDER=fake?')
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-8">
      <h1 className="font-serif text-4xl">Fake payment gateway</h1>
      <p className="rounded-lg border border-danger p-3 text-danger">
        Development only. No real payment happens here.
      </p>
      <p className="break-all text-sm text-muted">Reference: {reference || '(missing)'}</p>
      <button
        type="button"
        className={buttonClass}
        disabled={busy || !reference}
        onClick={() => void finish('paid')}
      >
        Pay successfully
      </button>
      <button
        type="button"
        className="rounded-lg border border-danger px-4 py-2 text-danger disabled:opacity-50"
        disabled={busy || !reference}
        onClick={() => void finish('failed')}
      >
        Fail the payment
      </button>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </main>
  )
}
