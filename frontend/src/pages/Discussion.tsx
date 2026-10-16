import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { CustomOrderMessage } from '../lib/api'
import { formatDate } from '../lib/orderStatus'
import { buttonClass, FormError, inputClass } from './ui'

/** The conversation about a custom order: messages as bubbles (yours on the right) and a box to
 *  write a new one. Used by the customer page and the admin page (`me` says which side you are). */
export function Discussion({
  messages,
  me,
  otherName,
  canWrite,
  closedText,
  onSend,
  onRefresh,
}: {
  messages: CustomOrderMessage[]
  me: 'CUSTOMER' | 'ADMIN'
  /** How the other side is called in the empty-state text ("the shop", "Sara"). */
  otherName: string
  canWrite: boolean
  closedText: string
  onSend: (body: string) => Promise<void>
  onRefresh?: () => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const end = useRef<HTMLLIElement>(null)

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' })
  }, [messages.length])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSend(body)
      setText('')
    } catch {
      setError('Could not send your message. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-label="Discussion"
      className="rounded-[18px] border border-sand bg-paper p-4 md:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-2xl">Discussion</h2>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="text-sm underline underline-offset-4"
          >
            Check for new messages
          </button>
        )}
      </div>

      {messages.length === 0 ? (
        <p className="mt-3 text-bark">
          No messages yet. Say hello to {otherName} and talk about colours, size and price here.
        </p>
      ) : (
        <ul className="mt-4 flex max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1">
          {messages.map((m) => {
            const mine = m.sender === me
            return (
              <li
                key={m.message_id}
                className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}
              >
                <p
                  className={`max-w-[85%] whitespace-pre-line break-words rounded-[16px] px-4 py-2.5 ${mine ? 'bg-ink text-cream' : 'bg-cream-200 text-ink'}`}
                >
                  <span className="sr-only">{mine ? 'You wrote: ' : `${otherName} wrote: `}</span>
                  {m.body}
                </p>
                <span className="mt-1 text-xs text-bark">{formatDate(m.created_at)}</span>
              </li>
            )
          })}
          <li ref={end} aria-hidden="true" />
        </ul>
      )}

      {canWrite ? (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-2">
          <label htmlFor="discussion-text" className="text-sm font-medium text-bark">
            Write a message
          </label>
          <textarea
            id="discussion-text"
            rows={3}
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit(e)
            }}
            className={inputClass}
          />
          <FormError message={error} />
          <div>
            <button type="submit" className={buttonClass} disabled={busy || text.trim() === ''}>
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      ) : (
        <p className="mt-4 rounded-[10px] bg-cream-100 p-3 text-bark">{closedText}</p>
      )}
    </section>
  )
}
