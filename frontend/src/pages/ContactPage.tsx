import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, sendContactMessage } from '../lib/api'
import { buttonClass, Field, FormError } from './ui'

export default function ContactPage() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const text = (k: string) => String(form.get(k) ?? '').trim()
    const optional = (k: string) => text(k) || null
    if (!text('email') && !text('phone') && !text('whatsapp_number'))
      return setError('Please give an email, phone or WhatsApp number so we can reply.')
    setBusy(true)
    setError(null)
    try {
      await sendContactMessage({
        name: text('name'),
        email: optional('email'),
        phone: optional('phone'),
        whatsapp_number: optional('whatsapp_number'),
        message: text('message'),
      })
      setDone(true)
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? 'You have sent several messages recently. Please try again a little later.'
          : err instanceof ApiError && err.status === 422
            ? 'Please check your details and try again.'
            : 'Could not send your message. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <main className="mx-auto max-w-xl px-4 py-8">
        <h1 className="font-serif text-4xl">Message sent</h1>
        <p role="status" className="mt-4">
          Thank you! We received your message and will reply soon.
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
      <h1 className="mt-2 font-serif text-4xl">Contact us</h1>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        <Field id="name" name="name" label="Your name" maxLength={100} required />
        <Field id="email" name="email" label="Email" type="email" />
        <Field id="phone" name="phone" label="Phone" type="tel" maxLength={20} />
        <Field
          id="whatsapp_number"
          name="whatsapp_number"
          label="WhatsApp number"
          type="tel"
          maxLength={20}
        />
        <p className="text-sm text-muted">Give at least one way for us to reply.</p>
        <div className="flex flex-col gap-1">
          <label htmlFor="message" className="text-sm font-medium text-bark">
            Message
          </label>
          <textarea
            id="message"
            name="message"
            rows={5}
            maxLength={3000}
            required
            className="rounded-lg border border-sand px-3 py-2"
          />
        </div>
        <FormError message={error} />
        <button type="submit" className={buttonClass} disabled={busy}>
          {busy ? 'Sending…' : 'Send message'}
        </button>
      </form>
    </main>
  )
}
