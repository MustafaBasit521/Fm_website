import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, getCustomOrderUploadTarget, submitCustomOrder } from '../lib/api'
import { parseRupeesToPaisa } from '../lib/money'
import { supabase } from '../lib/supabase'
import { useShopWhatsapp, waLink } from '../lib/whatsapp'
import { PageHeader } from './PageHeader'
import {
  buttonClass,
  Field,
  FormError,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './ui'

const STEPS: [string, string][] = [
  ['Share your idea', 'Fill in the form — a reference photo helps a lot.'],
  ['We confirm on WhatsApp', 'We message you with the price, colours and delivery date.'],
  ['Stitched & delivered', 'We make it by hand and deliver across Lahore.'],
]
// Just a starting point for the request: the choice is written at the top of the description.
const KINDS = ['Flowers', 'Car charm', 'Keychain', 'Bouquet', 'Something else']
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024 // the bucket enforces its own limit too

export default function CustomOrderPage() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const whatsapp = useShopWhatsapp()
  const today = new Date().toISOString().slice(0, 10)

  /** Opens WhatsApp with what has been typed so far; nothing is stored by the shop. */
  function sendOnWhatsApp() {
    if (!whatsapp || !formRef.current) return
    const form = new FormData(formRef.current)
    const text = (k: string) => String(form.get(k) ?? '').trim()
    const lines = [
      "Hi! I'd like a custom piece.",
      text('kind') && `Type: ${text('kind')}`,
      text('name') && `Name: ${text('name')}`,
      text('description') && `Details: ${text('description')}`,
      text('budget') && `Budget: Rs ${text('budget')}`,
      text('required_date') && `Needed by: ${text('required_date')}`,
    ].filter(Boolean)
    window.open(waLink(whatsapp, lines.join('\n')), '_blank', 'noopener,noreferrer')
  }

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
        description: text('kind')
          ? `Type: ${text('kind')}\n\n${text('description')}`.slice(0, 3000)
          : text('description'),
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
    <main className="mx-auto max-w-5xl px-4 py-10 md:py-14">
      <div className="grid items-start gap-10 md:grid-cols-[1fr_1.15fr]">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-bark">Custom orders</p>
          <h1 className="mt-2 font-serif text-5xl leading-none md:text-7xl">
            Your idea,
            <br />
            <em className="text-terracotta">our crochet.</em>
          </h1>
          <p className="mt-5 max-w-md text-bark">
            A keychain with a name, a bouquet in wedding colours, a jersey for a team — tell us what
            you have in mind and we&apos;ll message you on WhatsApp with a price and date.
          </p>
          <ol
            aria-label="How it works"
            className="mt-8 flex flex-col divide-y divide-dashed divide-linen border-y border-dashed border-linen"
          >
            {STEPS.map(([title, text], i) => (
              <li key={title} className="flex flex-nowrap gap-4 py-4">
                <span
                  aria-hidden="true"
                  className="w-6 shrink-0 font-serif text-3xl text-terracotta"
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
        </div>

        <form
          ref={formRef}
          onSubmit={onSubmit}
          aria-label="Custom order request"
          className="flex flex-col gap-4 rounded-[18px] border border-sand bg-paper p-5 md:p-6"
        >
          <h2 className="font-serif text-2xl">Tell us about it</h2>
          <fieldset>
            <legend className="text-sm font-medium text-bark">What would you like?</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {KINDS.map((kind) => (
                <label
                  key={kind}
                  className="cursor-pointer rounded-full border border-linen bg-paper px-4 py-1.5 text-sm has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-cream has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-dashed has-[:focus-visible]:outline-bark"
                >
                  <input type="radio" name="kind" value={kind} className="sr-only" />
                  {kind}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="name" name="name" label="Your name" maxLength={100} required />
            <Field
              id="whatsapp_number"
              name="whatsapp_number"
              label="WhatsApp number"
              type="tel"
              maxLength={20}
              required
            />
          </div>
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="budget" name="budget" label="Budget in Rs (optional)" inputMode="decimal" />
            <Field
              id="required_date"
              name="required_date"
              label="Needed by (optional)"
              type="date"
              min={today}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="reference" className="text-sm font-medium text-bark">
              Reference picture (optional, JPG/PNG/WebP, under 5 MB)
            </label>
            <input
              id="reference"
              name="reference"
              type="file"
              accept={ALLOWED_TYPES.join(',')}
              className="rounded-[10px] border-2 border-dashed border-linen bg-cream-100 p-6 text-bark file:mr-4 file:cursor-pointer file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:font-semibold file:text-cream"
            />
          </div>
          <FormError message={error} />
          <button type="submit" className={`${buttonClass} w-full`} disabled={busy}>
            {busy ? 'Sending…' : 'Send request'}
          </button>
          {whatsapp && (
            <button
              type="button"
              className={`${secondaryButtonClass} w-full`}
              onClick={sendOnWhatsApp}
            >
              Or send this on WhatsApp
            </button>
          )}
          <p className="text-sm text-bark">
            No payment now — we&apos;ll confirm the price with you first.
          </p>
        </form>
      </div>
    </main>
  )
}
