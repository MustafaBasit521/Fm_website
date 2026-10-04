import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, getCustomOrderUploadTarget, submitCustomOrder } from '../lib/api'
import { parseRupeesToPaisa } from '../lib/money'
import { supabase } from '../lib/supabase'
import { buttonClass, Field, FormError } from './ui'

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
      <main className="mx-auto max-w-xl px-4 py-8">
        <h1 className="font-serif text-4xl">Request sent</h1>
        <p role="status" className="mt-4">
          Thank you! We received your custom order request and will contact you on WhatsApp to
          discuss the details and the price.
        </p>
        <p className="mt-4">
          <Link to="/" className="text-terracotta underline">
            Back to the home page
          </Link>
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <Link to="/" className="text-terracotta underline">
        ← Home
      </Link>
      <h1 className="mt-2 font-serif text-4xl">Custom order</h1>
      <p className="mt-2 text-muted">
        Tell us what you would like us to make. We will contact you on WhatsApp to agree the
        details.
      </p>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
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
            className="rounded-lg border border-sand px-3 py-2"
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
          <input id="reference" name="reference" type="file" accept={ALLOWED_TYPES.join(',')} />
        </div>
        <FormError message={error} />
        <button type="submit" className={buttonClass} disabled={busy}>
          {busy ? 'Sending…' : 'Send request'}
        </button>
      </form>
    </main>
  )
}
