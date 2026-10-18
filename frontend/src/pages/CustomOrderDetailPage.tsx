import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import {
  ApiError,
  getCustomOrder,
  confirmCustomOrderPrice,
  declineCustomOrderPrice,
  getCustomOrderMessages,
  offerCustomOrderPrice,
  sendCustomOrderMessage,
  type CustomOrder,
  type CustomOrderMessage,
} from '../lib/api'
import { formatPrice, parseRupeesToPaisa } from '../lib/money'
import { formatDate } from '../lib/orderStatus'
import { ConfirmDialog } from './ConfirmDialog'
import { Discussion } from './Discussion'
import { PageHeader } from './PageHeader'
import { StatusBadge } from './StatusBadge'
import { CUSTOM_ORDER_TONE } from './statusColors'
import { BackLink, buttonClass, FormError, inputClass, secondaryButtonClass } from './ui'

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
  const [asking, setAsking] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [offering, setOffering] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

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

  async function confirmPrice(price: number) {
    setBusy(true)
    setProblem(null)
    try {
      const updated = await confirmCustomOrderPrice(id, price)
      setState((st) => (st ? { ...st, order: updated } : st))
      setAsking(false)
    } catch (e) {
      setAsking(false)
      setProblem(
        e instanceof ApiError && e.code === 'PRICE_CHANGED'
          ? 'The shop changed the price a moment ago. Please look at the new price below.'
          : 'Could not confirm the price. Please try again.',
      )
      refresh()
    } finally {
      setBusy(false)
    }
  }

  /** Declining and offering both change the request and the thread, so reload both. */
  async function negotiate(action: () => Promise<CustomOrder>) {
    setBusy(true)
    setProblem(null)
    try {
      const updated = await action()
      setState((st) => (st ? { ...st, order: updated } : st))
      setDeclining(false)
      setOffering(false)
      refresh()
    } catch {
      setDeclining(false)
      setProblem('That did not work. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function sendOffer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const price = parseRupeesToPaisa(String(new FormData(e.currentTarget).get('offer') ?? ''))
    if (price === null || price === 0)
      return setProblem('Enter your offer in Rs, like 2500 or 2500.50.')
    void negotiate(() => offerCustomOrderPrice(id, price))
  }

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
            ) : order.proposed_price_paisa !== null && order.status === 'IN_DISCUSSION' ? (
              <div className="mt-4 rounded-[10px] bg-accent-tint p-4">
                <p>
                  The shop proposed{' '}
                  <strong className="text-lg">{formatPrice(order.proposed_price_paisa)}</strong>
                </p>
                <p className="mt-1 text-sm text-bark">
                  Nothing is agreed until you confirm. If the price does not suit you, keep talking
                  in the discussion below: the shop can change it.
                </p>
                <button
                  type="button"
                  className={`${buttonClass} mt-3`}
                  onClick={() => {
                    setProblem(null)
                    setAsking(true)
                  }}
                >
                  Accept this price
                </button>
                <span className="mt-3 inline-flex flex-wrap gap-3 sm:ml-3">
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    onClick={() => {
                      setProblem(null)
                      setDeclining(true)
                    }}
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    aria-expanded={offering}
                    onClick={() => setOffering((o) => !o)}
                  >
                    Offer a different price
                  </button>
                </span>
              </div>
            ) : order.customer_offer_paisa !== null && order.status === 'IN_DISCUSSION' ? (
              <div className="mt-4 rounded-[10px] bg-accent-tint p-4">
                <p>
                  You offered{' '}
                  <strong className="text-lg">{formatPrice(order.customer_offer_paisa)}</strong>
                </p>
                <p className="mt-1 text-sm text-bark">
                  Waiting for the shop to accept it or answer. You can talk about it below, or send
                  a different offer.
                </p>
                <button
                  type="button"
                  className={`${secondaryButtonClass} mt-3`}
                  aria-expanded={offering}
                  onClick={() => setOffering((o) => !o)}
                >
                  Change my offer
                </button>
              </div>
            ) : (
              <p className="mt-4 text-bark">
                The price is agreed in the discussion below. The shop proposes it and you confirm it
                here.
              </p>
            )}
            {offering && order.status === 'IN_DISCUSSION' && (
              <form
                onSubmit={sendOffer}
                aria-label="Make an offer"
                className="mt-3 flex flex-col gap-2 rounded-[10px] border border-sand p-3"
              >
                <label htmlFor="offer" className="text-sm font-medium text-bark">
                  Your offer in Rs
                </label>
                <input id="offer" name="offer" inputMode="decimal" className={inputClass} />
                <div>
                  <button type="submit" className={buttonClass} disabled={busy}>
                    Send my offer
                  </button>
                </div>
              </form>
            )}
            <FormError message={problem} />
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
      <ConfirmDialog
        open={asking}
        title="Accept this price?"
        confirmLabel="Yes, accept"
        cancelLabel="Not yet"
        busy={busy}
        onCancel={() => setAsking(false)}
        onConfirm={() =>
          order?.proposed_price_paisa != null && void confirmPrice(order.proposed_price_paisa)
        }
      >
        <p>
          You agree to{' '}
          {order?.proposed_price_paisa != null && formatPrice(order.proposed_price_paisa)} for this
          custom order. Once you accept, the price is final and the shop can start making it.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={declining}
        title="Decline this price?"
        confirmLabel="Yes, decline"
        cancelLabel="Keep it"
        busy={busy}
        onCancel={() => setDeclining(false)}
        onConfirm={() => void negotiate(() => declineCustomOrderPrice(id))}
      >
        <p>
          The shop is told you do not accept{' '}
          {order?.proposed_price_paisa != null && formatPrice(order.proposed_price_paisa)}. The
          request stays open: you can talk about the price or offer a different one.
        </p>
      </ConfirmDialog>
    </main>
  )
}
