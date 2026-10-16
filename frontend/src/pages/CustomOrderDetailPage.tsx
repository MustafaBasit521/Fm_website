import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ApiError,
  getCustomOrder,
  getCustomOrderMessages,
  sendCustomOrderMessage,
  type CustomOrder,
  type CustomOrderMessage,
} from '../lib/api'
import { formatPrice } from '../lib/money'
import { formatDate } from '../lib/orderStatus'
import { Discussion } from './Discussion'
import { PageHeader } from './PageHeader'
import { StatusBadge } from './StatusBadge'
import { CUSTOM_ORDER_TONE } from './statusColors'
import { BackLink } from './ui'

const CUSTOM_LABELS: Record<string, string> = {
  NEW: 'Received',
  IN_DISCUSSION: 'In discussion',
  ACCEPTED: 'Accepted',
  IN_PROGRESS: 'Being made',
  COMPLETED: 'Completed',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
}
const OPEN = ['NEW', 'IN_DISCUSSION', 'ACCEPTED', 'IN_PROGRESS']

/** One custom order of the signed-in customer: its details, the price the shop accepted and the
 *  discussion with the shop. */
export default function CustomOrderDetailPage() {
  const { id = '' } = useParams()
  const [state, setState] = useState<{
    id: string
    order: CustomOrder | null
    messages: CustomOrderMessage[]
    notFound: boolean
  } | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      getCustomOrder(id, controller.signal),
      getCustomOrderMessages(id, controller.signal),
    ])
      .then(([order, messages]) => setState({ id, order, messages, notFound: false }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setState({
          id,
          order: null,
          messages: [],
          notFound: e instanceof ApiError && e.status === 404,
        })
      })
    return () => controller.abort()
  }, [id, version])

  const refresh = useCallback(() => setVersion((v) => v + 1), [])
  const current = state?.id === id ? state : null
  const order = current?.order ?? null

  async function send(body: string) {
    const created = await sendCustomOrderMessage(id, body)
    setState((s) => (s ? { ...s, messages: [...s.messages, created] } : s))
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <BackLink to="/custom-orders">My custom orders</BackLink>
      {!current && (
        <p role="status" className="mt-6">
          Loading…
        </p>
      )}
      {current && !order && (
        <p role="alert" className="mt-6 text-danger">
          {current.notFound ? 'We could not find this request.' : 'Could not load this request.'}
        </p>
      )}
      {order && current && (
        <>
          <PageHeader eyebrow="Custom order" title="Your request" />
          <section
            aria-label="Request details"
            className="rounded-[18px] border border-sand bg-paper p-4 md:p-5"
          >
            <p className="flex flex-wrap items-center justify-between gap-2">
              <StatusBadge
                status={CUSTOM_ORDER_TONE[order.status]}
                label={CUSTOM_LABELS[order.status]}
              />
              <span className="text-sm text-muted">Sent {formatDate(order.created_at)}</span>
            </p>
            <p className="mt-3 whitespace-pre-line">{order.description}</p>
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {order.budget_paisa !== null && (
                <div className="flex gap-2">
                  <dt className="text-bark">Your budget</dt>
                  <dd className="font-semibold">{formatPrice(order.budget_paisa)}</dd>
                </div>
              )}
              {order.required_date && (
                <div className="flex gap-2">
                  <dt className="text-bark">Needed by</dt>
                  <dd className="font-semibold">{formatDate(order.required_date)}</dd>
                </div>
              )}
            </dl>
            {order.agreed_price_paisa !== null ? (
              <p className="mt-4 rounded-[10px] bg-accent-tint p-3">
                <span className="text-bark">Agreed price</span>{' '}
                <strong className="text-lg">{formatPrice(order.agreed_price_paisa)}</strong>
              </p>
            ) : (
              <p className="mt-4 text-bark">
                The price is agreed in the discussion below. The shop then confirms it here.
              </p>
            )}
          </section>
          <div className="mt-6">
            <Discussion
              messages={current.messages}
              me="CUSTOMER"
              otherName="the shop"
              canWrite={OPEN.includes(order.status)}
              closedText="This request is finished, so the discussion is closed."
              onSend={send}
              onRefresh={refresh}
            />
          </div>
        </>
      )}
    </main>
  )
}
