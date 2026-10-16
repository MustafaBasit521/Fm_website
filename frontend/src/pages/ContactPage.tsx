import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, getPublicSettings, sendContactMessage } from '../lib/api'
import { waDigits, waLink } from '../lib/whatsapp'
import { PageHeader } from './PageHeader'
import { buttonClass, Field, FormError, inputClass, primaryButtonClass } from './ui'

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
  const wa = waDigits(info.whatsapp)
  const links = Object.entries(info.social_links)
  if (!info.phone && !wa && !info.address && !info.email && links.length === 0) return null
  return (
    <section aria-label="Shop details" className="rounded-[18px] border border-sand bg-paper p-5">
      <h2 className="font-serif text-2xl">{info.business_name ?? 'Our details'}</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {wa && (
          <li>
            <a
              className={`${primaryButtonClass} w-full`}
              href={waLink(wa, 'Hi! I have a question.')}
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
      <main className="mx-auto max-w-xl px-4 py-12">
        <PageHeader eyebrow="Contact" title="Message sent">
          <p role="status">Thank you! We received your message and will reply soon.</p>
        </PageHeader>
        <Link to="/" className={primaryButtonClass}>
          Back to the home page
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto grid max-w-5xl items-start gap-10 px-4 py-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:py-14">
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow="Contact"
          title={
            <>
              Say <em className="text-terracotta">hello</em>
            </>
          }
        >
          Questions about a piece, an order or a custom idea? Write to us.
        </PageHeader>
        <ShopDetails />
        <p className="border-y border-dashed border-linen py-4 text-bark">
          We reply by email, phone or WhatsApp — whichever you leave us.
        </p>
      </div>
      <form
        onSubmit={onSubmit}
        aria-label="Contact form"
        className="flex flex-col gap-4 rounded-[18px] border border-sand bg-paper p-5 md:p-6"
      >
        <h2 className="font-serif text-2xl">Send us a message</h2>
        <div className="grid gap-4 sm:grid-cols-2">
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
        </div>
        <p className="-mt-2 text-sm text-muted">
          Give at least one way for us to reply (email, phone or WhatsApp).
        </p>
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
            className={inputClass}
          />
        </div>
        <FormError message={error} />
        <button type="submit" className={`${buttonClass} w-full`} disabled={busy}>
          {busy ? 'Sending…' : 'Send message'}
        </button>
      </form>
    </main>
  )
}
