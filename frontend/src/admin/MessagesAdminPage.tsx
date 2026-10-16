import { useState } from 'react'
import {
  getAdminMessages,
  setMessageStatus,
  type AdminMessage,
  type MessageStatus,
} from '../lib/adminApi'
import { formatDate } from '../lib/orderStatus'
import { inputClass } from './styles'
import { Badge, Pager, State, PageTitle, cardClass } from './ui'
import { waDigits, waLink } from '../lib/whatsapp'
import { useLoad } from './useLoad'

const LABELS: Record<MessageStatus, string> = {
  NEW: 'New',
  READ: 'Read',
  REPLIED: 'Replied',
  ARCHIVED: 'Archived',
}

export default function MessagesAdminPage() {
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const { data, loading, failed } = useLoad(
    (s) => getAdminMessages({ status, search, page }, s),
    [status, search, page],
  )
  const [override, setOverride] = useState<Record<string, AdminMessage>>({})
  const [error, setError] = useState<string | null>(null)

  async function change(id: string, target: MessageStatus) {
    setError(null)
    try {
      const updated = await setMessageStatus(id, target)
      setOverride((o) => ({ ...o, [id]: updated }))
    } catch {
      setError('Could not change the status.')
    }
  }

  return (
    <>
      <PageTitle
        eyebrow={data ? `${data.total} ${data.total === 1 ? 'message' : 'messages'}` : undefined}
        title="Messages"
      />
      <form
        role="search"
        className="mt-4 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="m-status" className="text-sm font-medium text-bark">
            Status
          </label>
          <select
            id="m-status"
            className={inputClass}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All</option>
            {Object.entries(LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="m-search" className="text-sm font-medium text-bark">
            Search name, email or text
          </label>
          <input
            id="m-search"
            type="search"
            maxLength={100}
            className={inputClass}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setSearch(e.currentTarget.value.trim())
                setPage(1)
              }
            }}
          />
        </div>
      </form>
      {error && (
        <p role="alert" className="mt-4 text-danger">
          {error}
        </p>
      )}
      <div className="mt-6">
        <State
          loading={loading}
          failed={failed}
          empty={data?.items.length === 0}
          emptyText="Nothing here — you're all caught up."
        >
          {data && (
            <>
              <ul className="flex flex-col gap-3">
                {data.items.map((original) => {
                  const m = override[original.message_id] ?? original
                  const wa = waDigits(m.whatsapp_number)
                  return (
                    <li
                      key={m.message_id}
                      className={`${cardClass} flex flex-nowrap gap-3 p-4 ${m.status === 'NEW' ? 'border-linen' : ''}`}
                    >
                      <span
                        aria-hidden="true"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-linen font-serif text-xl"
                      >
                        {m.name.trim().charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center justify-between gap-2">
                          <strong>{m.name}</strong>
                          <span className="flex items-center gap-2">
                            <Badge>{LABELS[m.status]}</Badge>
                            <span className="text-sm text-muted">{formatDate(m.created_at)}</span>
                          </span>
                        </p>
                        <p className="mt-1 break-words text-sm text-muted">
                          {[m.email, m.phone, m.whatsapp_number && `WhatsApp ${m.whatsapp_number}`]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        <p className="mt-3 whitespace-pre-line rounded-[14px] bg-cream-200 px-4 py-3">
                          {m.message}
                        </p>
                        <p className="mt-3 flex flex-wrap items-center gap-3">
                          {m.email && (
                            <a
                              className="rounded-full border border-linen px-4 py-1.5 text-sm hover:bg-cream-100"
                              href={`mailto:${m.email}`}
                            >
                              Reply by email
                            </a>
                          )}
                          {wa && (
                            <a
                              className="rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-cream hover:opacity-90"
                              href={waLink(wa)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Reply on WhatsApp
                            </a>
                          )}
                          <label className="flex items-center gap-2 text-sm">
                            Status
                            <select
                              className={inputClass}
                              value={m.status}
                              aria-label={`Status of the message from ${m.name}`}
                              onChange={(e) =>
                                void change(m.message_id, e.target.value as MessageStatus)
                              }
                            >
                              {Object.entries(LABELS).map(([v, l]) => (
                                <option key={v} value={v}>
                                  {l}
                                </option>
                              ))}
                            </select>
                          </label>
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <Pager page={page} total={data.total} pageSize={20} onPage={setPage} />
            </>
          )}
        </State>
      </div>
    </>
  )
}
