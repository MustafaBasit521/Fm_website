import { useState, type FormEvent } from 'react'
import { ApiError, subscribeNewsletter } from '../lib/api'
import { buttonClass, FormError, inputClass } from '../pages/ui'

/** "Join the circle": anyone, signed in or not, can ask to hear about new pieces by email. */
export function NewsletterSignup() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await subscribeNewsletter(email.trim())
      setDone(true)
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts. Please try again a little later.')
      } else if (err instanceof ApiError && err.status === 422) {
        setError('Please enter a valid email address.')
      } else {
        setError('Could not sign you up. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="circle-heading" className="mx-auto mt-16 max-w-6xl px-4">
      <div className="grid items-center gap-6 rounded-[18px] bg-accent-tint p-6 md:grid-cols-2 md:p-10">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-bark">Newsletter</p>
          <h2 id="circle-heading" className="mt-1 font-serif text-4xl md:text-5xl">
            Join the <em className="text-terracotta">circle</em>
          </h2>
          <p className="mt-2 text-bark">
            Be the first to hear when new pieces arrive. No spam — unsubscribe in one click.
          </p>
        </div>
        {done ? (
          <p role="status" className="text-lg">
            Thank you! You&apos;re on the list — look out for a welcome note.
          </p>
        ) : (
          <form onSubmit={onSubmit} aria-label="Newsletter" className="flex flex-col gap-3">
            <label htmlFor="newsletter-email" className="sr-only">
              Your email address
            </label>
            <div className="flex flex-wrap gap-3">
              <input
                id="newsletter-email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`${inputClass} min-w-0 flex-1 basis-56`}
              />
              <button type="submit" className={buttonClass} disabled={busy}>
                {busy ? 'Joining…' : 'Join'}
              </button>
            </div>
            <FormError message={error} />
          </form>
        )}
      </div>
    </section>
  )
}
