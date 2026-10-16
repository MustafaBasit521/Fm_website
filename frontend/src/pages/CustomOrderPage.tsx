import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, getCustomOrderUploadTarget, submitCustomOrder } from '../lib/api'
import { parseRupeesToPaisa } from '../lib/money'
import { supabase } from '../lib/supabase'
import { PageHeader } from './PageHeader'
import { buttonClass, Field, FormError, inputClass, primaryButtonClass } from './ui'

const STEPS: [string, string][] = [
  ['Share your idea', 'Fill in the form — a reference photo helps a lot.'],
  ['We confirm on WhatsApp', 'We message you with the price, colours and delivery date.'],
  ['Stitched & delivered', 'We make it by hand and deliver across Lahore.'],
]
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024 // the bucket enforces its own limit too

export default function CustomOrderPage() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const today = new Date().toISOString().slice(0, 10)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const text = (k: string) => String(form.get(k) ?? '').trim()
    const fileInput = e.currentTarget.elements.namedItem('reference') as HTMLInputElement | null
    const file = fileInput?.files?.[0] ?? null
    const hasFile = file !== null && file.size > 0

    let budget: number | null = null
    if (text('budget')) {
      budget = parseRupeesToPaisa(text('budget'))
      if (budget === null)
        return setError('Please enter the budget as a number, like 2500 or 2500.50.')
    }
    if (hasFile && !ALLOWED_TYPES.includes(file.type))
      return setError('The reference image must be a JPG, PNG or WebP picture.')
    if (hasFile && file.size > MAX_BYTES) return setError('The reference image must be under 5 MB.')

    setBusy(true)
    setError(null)
    try {
      let path: string | null = null
      if (hasFile) {
        // The file goes straight to private storage with a short-lived signed link.
        const target = await getCustomOrderUploadTarget(file.type)
        const { error: uploadError } = await supabase.storage
          .from(target.bucket)
          .uploadToSignedUrl(target.storage_path, target.token, file)
        if (uploadError) throw new Error('upload failed')
        path = target.storage_path
      }
      await submitCustomOrder({
        name: text('name'),
        whatsapp_number: text('whatsapp_number'),
        description: text('description'),
        budget_paisa: budget,
        required_date: text('required_date') || null,
        reference_image_path: path,
      })
      setDone(true)
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('You have sent several requests recently. Please try again a little later.')
      } else if (err instanceof ApiError && err.status === 503) {
        setError(
          'Picture upload is not available right now. You can send your request without a picture.',
        )
      } else if (err instanceof ApiError && err.status === 422) {
        setError('Please check your details (WhatsApp number, date and description) and try again.')
      } else {
        setError('Could not send your request. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <PageHeader eyebrow="Custom order" title="Request sent">
          <p role="status">
            Thank you! We received your custom order request and will message you on WhatsApp with a
            price and delivery date.
          </p>
        </PageHeader>
        <Link to="/" className={primaryButtonClass}>
          Back to the home page
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        eyebrow="Custom orders"
        title={
          <>
            Don&apos;t see it? <em className="text-terracotta">Customize anything.</em>
          </>
        }
      >
        Your colours, your name, your idea — tell us and we&apos;ll stitch it.
      </PageHeader>

      <div className="grid items-start gap-8 md:grid-cols-[1fr_1.4fr]">
        <ol aria-label="How it works" className="flex flex-col gap-4">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="flex flex-nowrap gap-4">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-tint font-semibold text-terracotta"
              >
                {i + 1}
              </span>
              <div>
                <p className="font-semibold">{title}</p>
                <p className="text-bark">{text}</p>
              </div>
            </li>
          ))}
        </ol>

        <form
          onSubmit={onSubmit}
          aria-label="Custom order request"
          className="flex flex-col gap-4 rounded-[18px] border border-sand bg-paper p-5"
        >
          <Field id="name" name="name" label="Your name" maxLength={100} required />
          <Field
            id="whatsapp_number"
            name="whatsapp_number"
            label="WhatsApp number"
            type="tel"
            maxLength={20}
            required
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="description" className="text-sm font-medium text-bark">
              What should we make? (include sizes, colours and quantity)
            </label>
            <textarea
              id="description"
              name="description"
              rows={5}
              maxLength={3000}
              required
              className={inputClass}
            />
          </div>
          <Field id="budget" name="budget" label="Budget in Rs (optional)" inputMode="decimal" />
          <Field
            id="required_date"
            name="required_date"
            label="Needed by (optional)"
            type="date"
            min={today}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="reference" className="text-sm font-medium text-bark">
              Reference picture (optional, JPG/PNG/WebP, under 5 MB)
            </label>
            <input
              id="reference"
              name="reference"
              type="file"
              accept={ALLOWED_TYPES.join(',')}
              className="rounded-[10px] border border-dashed border-linen bg-cream-100 p-4"
            />
          </div>
          <FormError message={error} />
          <button type="submit" className={`${buttonClass} w-full`} disabled={busy}>
            {busy ? 'Sending…' : 'Send request'}
          </button>
          <p className="text-sm text-bark">
            No payment now — we&apos;ll confirm the price with you first.
          </p>
        </form>
      </div>
    </main>
  )
}
