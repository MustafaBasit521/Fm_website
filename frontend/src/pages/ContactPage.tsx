import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { getPublicSettings } from '../lib/adminApi'
import { ApiError, sendContactMessage } from '../lib/api'
import { buttonClass, Field, FormError } from './ui'

function ShopDetails() {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof getPublicSettings>> | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    getPublicSettings(controller.signal)
      .then(setInfo)
      .catch(() => {}) // the contact form works without these details
    return () => controller.abort()
  }, [])
  if (!info) return null
  const wa = info.whatsapp?.replace(/[^\d]/g, '')
  const links = Object.entries(info.social_links)
  if (!info.phone && !wa && !info.address && !info.email && links.length === 0) return null
  return (
    <section
      aria-label="Shop details"
      className="mt-4 rounded-xl border border-sand bg-cream-100 p-4"
    >
      <h2 className="text-xl font-semibold">{info.business_name ?? 'Our details'}</h2>
      <ul className="mt-2 flex flex-col gap-1">
        {wa && (
          <li>
            <a
              className="text-terracotta underline"
              href={`https://wa.me/${wa}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Chat on WhatsApp
            </a>
          </li>
        )}
        {info.phone && <li>Phone: {info.phone}</li>}
        {info.email && <li>Email: {info.email}</li>}
        {info.address && <li>{info.address}</li>}
        {links.map(([name, url]) => (
          <li key={name}>
            <a
              className="text-terracotta underline"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {name.charAt(0).toUpperCase() + name.slice(1)}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

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
      <ShopDetails />
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
