import { useEffect, useState, type FormEvent } from 'react'
import {
  ApiError,
  getProofUploadTarget,
  getPublicSettings,
  sendPaymentProof,
  type Order,
} from '../lib/api'
import { formatPrice } from '../lib/money'
import { supabase } from '../lib/supabase'
import { useToast } from '../toast/context'
import { buttonClass, Field, FilePicker, FormError } from './ui'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/** Paying an order by sending money to the shop's own account (JazzCash, Easypaisa, bank): shows
 *  where to send it, takes the transaction number and/or a screenshot, and then waits for the shop
 *  to check. Renders nothing for other orders or once the payment is settled. */
export function TransferPayment({
  order,
  onUpdated,
}: {
  order: Order
  onUpdated: (order: Order) => void
}) {
  const toast = useToast()
  const [instructions, setInstructions] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getPublicSettings()
      .then((s) => setInstructions(s.transfer_instructions ?? null))
      .catch(() => {}) // the shop's details are also in its footer; the form still works
  }, [])

  if (order.payment_method !== 'TRANSFER') return null
  if (order.status !== 'PENDING' || order.payment_status !== 'PENDING') return null

  if (order.proof_submitted_at) {
    return (
      <section
        aria-label="Payment"
        className="mt-4 rounded-[18px] border border-sand bg-accent-tint p-5"
      >
        <h2 className="font-serif text-2xl">Thank you, we got your payment details</h2>
        <p role="status" className="mt-2">
          The shop will check its account and confirm your order soon. You will get a message when
          it is confirmed.
        </p>
      </section>
    )
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const reference = String(form.get('reference') ?? '').trim()
    const input = e.currentTarget.elements.namedItem('screenshot') as HTMLInputElement | null
    const file = input?.files?.[0] ?? null
    const hasFile = file !== null && file.size > 0
    if (!reference && !hasFile)
      return setError('Please enter the transaction number, add a screenshot, or both.')
    if (hasFile && !IMAGE_TYPES.includes(file.type))
      return setError('The screenshot must be a JPG, PNG or WebP picture.')
    if (hasFile && file.size > MAX_BYTES) return setError('The screenshot must be under 5 MB.')

    setBusy(true)
    setError(null)
    try {
      let imagePath: string | null = null
      if (hasFile) {
        const target = await getProofUploadTarget(order.order_id, file.type)
        const { error: uploadError } = await supabase.storage
          .from(target.bucket)
          .uploadToSignedUrl(target.storage_path, target.token, file)
        if (uploadError) throw new Error('upload failed')
        imagePath = target.storage_path
      }
      const updated = await sendPaymentProof(order.order_id, {
        reference: reference || null,
        image_path: imagePath,
      })
      toast.show('Payment details sent')
      onUpdated(updated)
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'PAYMENT_WINDOW_CLOSED'
          ? 'The 30 minutes for this payment have passed. If you already paid, please contact the shop.'
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
      aria-label="Pay by transfer"
      className="mt-4 flex flex-col gap-4 rounded-[18px] border border-sand bg-paper p-5"
    >
      <div>
        <h2 className="font-serif text-2xl">
          Send {formatPrice(order.total_amount_paisa)} to the shop
        </h2>
        <p className="mt-1 text-bark">
          Send the money from JazzCash, Easypaisa or your bank to the account below, then tell us
          that you paid
          {order.payment_deadline_at ? ` before ${time(order.payment_deadline_at)}` : ''} (30
          minutes from placing the order), or the order is cancelled.
        </p>
      </div>
      {instructions ? (
        <p className="whitespace-pre-line rounded-[10px] bg-cream-100 p-4 font-medium">
          {instructions}
        </p>
      ) : (
        <p className="rounded-[10px] bg-cream-100 p-4 text-bark">
          The shop&apos;s account details are in the footer of this page, or contact the shop.
        </p>
      )}
      <form onSubmit={onSubmit} aria-label="Payment details" className="flex flex-col gap-3">
        <Field
          id="proof-reference"
          name="reference"
          label="Transaction number (from your payment message)"
          maxLength={100}
        />
        <FilePicker
          id="proof-screenshot"
          name="screenshot"
          label="Or a screenshot of the payment (JPG, PNG or WebP, under 5 MB)"
          accept={IMAGE_TYPES.join(',')}
          buttonText="Choose screenshot"
        />
        <FormError message={error} />
        <div>
          <button type="submit" className={buttonClass} disabled={busy}>
            {busy ? 'Sending…' : 'I have paid: send my details'}
          </button>
        </div>
      </form>
    </section>
  )
}
