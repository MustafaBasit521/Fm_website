import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError, unsubscribeNewsletter } from '../lib/api'
import { PageHeader } from './PageHeader'
import { FormError, primaryButtonClass, secondaryButtonClass } from './ui'

/** Opened from the link in every newsletter email. A button confirms, so a mail scanner that
 *  merely opens the link cannot unsubscribe anyone. */
export default function UnsubscribePage() {
  const token = useSearchParams()[0].get('token') ?? ''
  const [state, setState] = useState<'ask' | 'busy' | 'done' | 'gone'>('ask')
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setState('busy')
    setError(null)
    try {
      await unsubscribeNewsletter(token)
      setState('done')
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 422)) setState('gone')
      else {
        setError('Could not unsubscribe right now. Please try again.')
        setState('ask')
      }
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <PageHeader eyebrow="Newsletter" title="Unsubscribe">
        {state === 'done' && <p role="status">You have been unsubscribed. We&apos;ll miss you!</p>}
        {state === 'gone' && (
          <p role="status">This link is no longer valid — you may already be unsubscribed.</p>
        )}
        {(state === 'ask' || state === 'busy') && (
          <p>Stop receiving emails about new pieces at this address?</p>
        )}
      </PageHeader>
      {(state === 'ask' || state === 'busy') && (
        <>
          <FormError message={error} />
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className={primaryButtonClass}
              disabled={state === 'busy' || token.length < 10}
              onClick={() => void confirm()}
            >
              {state === 'busy' ? 'Unsubscribing…' : 'Yes, unsubscribe me'}
            </button>
            <Link to="/" className={secondaryButtonClass}>
              Keep me subscribed
            </Link>
          </div>
        </>
      )}
      {(state === 'done' || state === 'gone') && (
        <Link to="/" className={secondaryButtonClass}>
          Back to the shop
        </Link>
      )}
    </main>
  )
}
