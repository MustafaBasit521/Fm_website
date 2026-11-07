import { useEffect, useState, type FormEvent } from 'react'
import {
  ApiError,
  getProofUploadTarget,
  getPublicSettings,
  sendPaymentProof,
  type BusinessSettings,
  type Order,
  type PaymentAttempt,
} from '../lib/api'
import { formatPrice } from '../lib/money'
import { isWalletMethod, methodName, REJECTION_LABELS } from '../lib/paymentText'
import { supabase } from '../lib/supabase'
import { waDigits, waLink } from '../lib/whatsapp'
import { useToast } from '../toast/context'
import { buttonClass, Field, FilePicker, FormError } from './ui'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024
const REFERENCE = /^[A-Za-z0-9-]{6,40}$/

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** The same short number the shop's emails use. */
const orderNumber = (order: Order) => order.order_id.slice(0, 8).toUpperCase()

function rejectionText(a: PaymentAttempt): string {
  const label = a.rejection_reason ? REJECTION_LABELS[a.rejection_reason] : 'Not accepted'
  if (a.rejection_reason === 'OTHER') return a.rejection_note ?? label
  return a.rejection_note ? `${label}: ${a.rejection_note}` : label
}

function qrAndDetails(order: Order, settings: BusinessSettings | null) {
  const easypaisa = order.payment_method === 'EASYPAISA'
  return {
    qr: (easypaisa ? settings?.easypaisa_qr_url : settings?.jazzcash_qr_url) ?? null,
    details: (easypaisa ? settings?.easypaisa_details : settings?.jazzcash_details) ?? null,
  }
}

/** Paying an Easypaisa or JazzCash order. Renders nothing for orders that are not paid this way.
 *
 *  The backend decides how (`wallet_receipts_enabled` in the public settings). At launch the
 *  customer pays the shop's wallet and messages the screenshot on WhatsApp, and the shop marks the
 *  order paid. With the receipt flow switched on, the page takes the transaction number and the
 *  screenshot itself. */
export function WalletPayment({
  order,
  onUpdated,
}: {
  order: Order
  onUpdated: (order: Order) => void
}) {
  // undefined = still loading, null = could not be loaded
  const [settings, setSettings] = useState<BusinessSettings | null | undefined>(undefined)

  useEffect(() => {
    getPublicSettings()
      .then(setSettings)
      .catch(() => setSettings(null)) // the page still tells the customer to contact the shop
  }, [])

  if (!isWalletMethod(order.payment_method) || settings === undefined) return null
  if (settings?.wallet_receipts_enabled) {
    return <ReceiptPayment order={order} onUpdated={onUpdated} settings={settings} />
  }
  return <WhatsAppPayment order={order} settings={settings} />
}

/** Launch mode: pay, then send the screenshot on WhatsApp. There is no form and no deadline. */
function WhatsAppPayment({ order, settings }: { order: Order; settings: BusinessSettings | null }) {
  const wallet = methodName(order.payment_method)
  const { qr, details } = qrAndDetails(order, settings)
  const amount = formatPrice(order.total_amount_paisa)
  const number = orderNumber(order)

  if (order.payment_status === 'PAID') {
    return (
      <section aria-label="Payment" className="mt-4 rounded-[18px] border border-sand bg-paper p-5">
        <h2 className="font-serif text-2xl">{wallet} payment received</h2>
        <p className="mt-1 text-bark">The shop has confirmed your payment. Thank you!</p>
      </section>
    )
  }
  if (order.status !== 'PENDING' || order.payment_status !== 'PENDING') return null

  const digits = waDigits(settings?.whatsapp)
  const message = `Hello, I paid ${amount} by ${wallet} for order ${number}. Here is my payment screenshot.`
  return (
    <section
      aria-label={`Pay with ${wallet}`}
      className="mt-4 flex flex-col gap-4 rounded-[18px] border border-sand bg-paper p-5"
    >
      <div>
        <h2 className="font-serif text-2xl">
          Pay {amount} with {wallet}
        </h2>
        <p className="mt-1 text-bark">
          Send exactly <strong>{amount}</strong> and write the order number{' '}
          <strong>{number}</strong> in the payment note.
        </p>
      </div>
      {qr ? (
        <img
          src={qr}
          alt={`${wallet} QR code of the shop`}
          className="mx-auto h-auto w-full max-w-64 rounded-[10px] border border-sand bg-white p-2"
        />
      ) : null}
      {details && (
        <p className="whitespace-pre-line rounded-[10px] bg-cream-100 p-4 font-medium">{details}</p>
      )}
      {!qr && !details && (
        <p className="rounded-[10px] bg-cream-100 p-4 text-bark">
          The {wallet} account details could not be loaded. Please contact the shop.
        </p>
      )}
      <p role="status" className="rounded-[10px] bg-accent-tint p-4">
        Send the payment, then message us the screenshot on WhatsApp. We will confirm your order
        once we receive it.
      </p>
      {digits && (
        <div>
          <a
            href={waLink(digits, message)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass}
          >
            Send the screenshot on WhatsApp
          </a>
        </div>
      )}
    </section>
  )
}

/** Receipt flow (MANUAL_RECEIPTS_ENABLED): shows the shop's QR code, the amount and the order
 *  number, takes the transaction number and a receipt screenshot, and then waits for the shop to
 *  check its own account. A rejected payment shows why and lets the customer send corrected
 *  details. */
function ReceiptPayment({
  order,
  onUpdated,
  settings,
}: {
  order: Order
  onUpdated: (order: Order) => void
  settings: BusinessSettings
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const attempts = order.payment_attempts ?? []
  const wallet = methodName(order.payment_method)
  const open = attempts.find((a) => a.status === 'SUBMITTED')
  const lastRejected = [...attempts].reverse().find((a) => a.status === 'REJECTED')
  const waiting = order.status === 'PENDING' && order.payment_status === 'PENDING'

  if (!waiting) {
    const last = attempts[attempts.length - 1]
    if (!last) return null
    return (
      <section aria-label="Payment" className="mt-4 rounded-[18px] border border-sand bg-paper p-5">
        <h2 className="font-serif text-2xl">{wallet} payment</h2>
        <p className="mt-1 text-bark">
          Transaction number <strong>{last.transaction_reference}</strong>
          {last.status === 'PAID' ? ' · verified by the shop' : ''}
        </p>
      </section>
    )
  }

  if (open) {
    return (
      <section
        aria-label="Payment"
        className="mt-4 rounded-[18px] border border-sand bg-accent-tint p-5"
      >
        <h2 className="font-serif text-2xl">Thank you, we got your payment details</h2>
        <p role="status" className="mt-2">
          The shop will check its {wallet} account and confirm your order soon. You will get a
          message when it is confirmed.
        </p>
        <p className="mt-2 text-sm text-bark">
          Transaction number <strong>{open.transaction_reference}</strong>, sent{' '}
          {day(open.created_at)} at {time(open.created_at)}.
        </p>
      </section>
    )
  }

  const { qr, details } = qrAndDetails(order, settings)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const reference = String(form.get('reference') ?? '').trim()
    const input = e.currentTarget.elements.namedItem('screenshot') as HTMLInputElement | null
    const file = input?.files?.[0] ?? null
    if (!REFERENCE.test(reference))
      return setError(
        'Please enter the transaction number from your payment message (letters, digits or dashes, 6 to 40 characters).',
      )
    if (file === null || file.size === 0)
      return setError('Please add a screenshot of your receipt.')
    if (!IMAGE_TYPES.includes(file.type))
      return setError('The screenshot must be a JPG, PNG or WebP picture.')
    if (file.size > MAX_BYTES) return setError('The screenshot must be under 5 MB.')

    setBusy(true)
    setError(null)
    try {
      const target = await getProofUploadTarget(order.order_id, file.type)
      const { error: uploadError } = await supabase.storage
        .from(target.bucket)
        .uploadToSignedUrl(target.storage_path, target.token, file)
      if (uploadError) throw new Error('upload failed')
      const updated = await sendPaymentProof(order.order_id, {
        reference,
        image_path: target.storage_path,
      })
      toast.show('Payment details sent')
      onUpdated(updated)
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'PAYMENT_WINDOW_CLOSED'
          ? 'The 30 minutes for this payment have passed. If you already paid, please contact the shop.'
          : err instanceof ApiError && err.code === 'DUPLICATE_REFERENCE'
            ? 'This transaction number was already used. Please check it, or contact the shop.'
            : err instanceof ApiError && err.code === 'ALREADY_SUBMITTED'
              ? 'Your payment details are already with the shop.'
              : err instanceof ApiError && err.status === 429
                ? 'Too many attempts. Please try again a little later.'
                : 'Could not send your details. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-label={`Pay with ${wallet}`}
      className="mt-4 flex flex-col gap-4 rounded-[18px] border border-sand bg-paper p-5"
    >
      {lastRejected && (
        <div role="alert" className="rounded-[10px] border border-danger bg-cream-100 p-4">
          <p className="font-semibold">Your last payment was not accepted</p>
          <p className="mt-1">{rejectionText(lastRejected)}</p>
          <p className="mt-1 text-sm text-bark">
            Transaction number {lastRejected.transaction_reference}. Please send corrected details
            below.
          </p>
        </div>
      )}
      <div>
        <h2 className="font-serif text-2xl">
          Pay {formatPrice(order.total_amount_paisa)} with {wallet}
        </h2>
        <p className="mt-1 text-bark">
          Order number <strong>{orderNumber(order)}</strong>. Scan the QR code with your {wallet}{' '}
          app and pay exactly {formatPrice(order.total_amount_paisa)}, then send us the transaction
          number and a screenshot of the receipt
          {order.payment_deadline_at ? ` before ${time(order.payment_deadline_at)}` : ''} (30
          minutes from placing the order), or the order is cancelled.
        </p>
      </div>
      {qr ? (
        <img
          src={qr}
          alt={`${wallet} QR code of the shop`}
          className="mx-auto h-auto w-full max-w-64 rounded-[10px] border border-sand bg-white p-2"
        />
      ) : (
        <p className="rounded-[10px] bg-cream-100 p-4 text-bark">
          The {wallet} QR code could not be loaded. Please contact the shop for its account details.
        </p>
      )}
      {details && (
        <p className="whitespace-pre-line rounded-[10px] bg-cream-100 p-4 font-medium">{details}</p>
      )}
      <form
        onSubmit={onSubmit}
        noValidate
        aria-label="Payment details"
        className="flex flex-col gap-3"
      >
        <Field
          id="proof-reference"
          name="reference"
          label="Transaction number (from your payment message)"
          maxLength={40}
          required
        />
        <FilePicker
          id="proof-screenshot"
          name="screenshot"
          label="Screenshot of the receipt (JPG, PNG or WebP, under 5 MB)"
          accept={IMAGE_TYPES.join(',')}
          buttonText="Choose screenshot"
        />
        <FormError message={error} />
        <div>
          <button type="submit" className={buttonClass} disabled={busy}>
            {busy
              ? 'Sending…'
              : lastRejected
                ? 'Send corrected details'
                : 'I have paid: send my details'}
          </button>
        </div>
      </form>
    </section>
  )
}
