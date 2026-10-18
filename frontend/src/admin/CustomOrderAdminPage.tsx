import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import {
  acceptCustomerOffer,
  acceptCustomOrder,
  getAdminCustomOrder,
  getAdminCustomOrderMessages,
  proposeCustomOrderPrice,
  sendAdminCustomOrderMessage,
  setCustomOrderStatus,
  type AdminCustomOrder,
} from '../lib/adminApi'
import { ApiError, type CustomOrderMessage, type CustomOrderStatus } from '../lib/api'
import { formatPrice, paisaToRupeesInput, parseRupeesToPaisa } from '../lib/money'
import { formatDate } from '../lib/orderStatus'
import { Discussion } from '../pages/Discussion'
import { StatusBadge } from '../pages/StatusBadge'
import { CUSTOM_ORDER_TONE } from '../pages/statusColors'
import { ConfirmDialog } from '../pages/ConfirmDialog'
import { BackLink, buttonClass, FormError, inputClass } from '../pages/ui'
import { useToast } from '../toast/context'
import { CUSTOM_ORDER_LABELS, CUSTOM_ORDER_NEXT, DISCUSSION_OPEN } from './customOrderStatus'
import { PageTitle, State, cardClass } from './ui'

/** One custom order: the request, the status actions, accepting at the agreed price and the
 *  discussion with the customer. */
export default function CustomOrderAdminPage() {
  const { id = '' } = useParams()
  const toast = useToast()
  const [state, setState] = useState<{
    id: string
    order: AdminCustomOrder | null
    messages: CustomOrderMessage[]
  } | null>(null)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [acceptingOffer, setAcceptingOffer] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      getAdminCustomOrder(id, controller.signal),
      getAdminCustomOrderMessages(id, controller.signal),
    ])
      .then(([order, messages]) => setState({ id, order, messages }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError'))
          setState({ id, order: null, messages: [] })
      })
    return () => controller.abort()
  }, [id, version])

  const refresh = useCallback(() => setVersion((v) => v + 1), [])
  const current = state?.id === id ? state : null
  const order = current?.order ?? null

  function explain(e: unknown): string {
    if (e instanceof ApiError && e.code === 'INVALID_TRANSITION')
      return 'That change is not allowed from the current status. Reload the page.'
    return 'That did not work. Please try again.'
  }

  async function move(target: CustomOrderStatus) {
    setBusy(true)
    setError(null)
    try {
      const updated = await setCustomOrderStatus(id, target)
      setState((s) => (s ? { ...s, order: updated } : s))
    } catch (e) {
      setError(explain(e))
    } finally {
      setBusy(false)
    }
  }

  async function onPrice(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const price = parseRupeesToPaisa(String(new FormData(e.currentTarget).get('price') ?? ''))
    if (price === null) return setError('Enter the price in Rs, like 2500 or 2500.50.')
    setBusy(true)
    setError(null)
    try {
      // a registered customer must confirm the proposal; a guest agreed it on WhatsApp
      const updated = order?.customer_id
        ? await proposeCustomOrderPrice(id, price)
        : await acceptCustomOrder(id, price)
      setState((s) => (s ? { ...s, order: updated } : s))
      toast.show(
        order?.customer_id
          ? `Proposed ${formatPrice(price)} to the customer`
          : `Accepted at ${formatPrice(price)}`,
      )
    } catch (err) {
      setError(explain(err))
    } finally {
      setBusy(false)
    }
  }

  async function onAcceptOffer() {
    const price = order?.customer_offer_paisa
    setAcceptingOffer(false)
    if (price == null) return
    setBusy(true)
    setError(null)
    try {
      const updated = await acceptCustomerOffer(id, price)
      setState((s) => (s ? { ...s, order: updated } : s))
      refresh()
      toast.show(`Accepted at ${formatPrice(price)}`)
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'PRICE_CHANGED'
          ? 'The customer changed their offer. Reload the page to see the new price.'
          : explain(err),
      )
    } finally {
      setBusy(false)
    }
  }

  async function send(body: string) {
    const created = await sendAdminCustomOrderMessage(id, body)
    setState((s) => (s ? { ...s, messages: [...s.messages, created] } : s))
  }

  return (
    <>
      <BackLink to="/custom-orders">All custom orders</BackLink>
      <State loading={!current} failed={!!current && !order}>
        {order && current && (
          <div className="mt-3 flex flex-col gap-6">
            <PageTitle
              eyebrow={`Sent ${formatDate(order.created_at)}`}
              title={order.name}
              actions={
                <StatusBadge
                  status={CUSTOM_ORDER_TONE[order.status]}
                  label={CUSTOM_ORDER_LABELS[order.status]}
                />
              }
            />
            <FormError message={error} />

            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <div className="flex flex-col gap-6">
                <section aria-label="Request" className={`${cardClass} p-4 md:p-5`}>
                  <h2 className="font-serif text-2xl">Request</h2>
                  <p className="mt-2 whitespace-pre-line">{order.description}</p>
                  <p className="mt-3 text-sm text-bark">
                    WhatsApp {order.whatsapp_number} ·{' '}
                    {order.customer_id ? 'Registered customer' : 'Guest'}
                    {order.required_date && <> · Needed by {formatDate(order.required_date)}</>}
                  </p>
                  {order.reference_image_url && (
                    <figure className="mt-3">
                      <a href={order.reference_image_url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={order.reference_image_url}
                          alt={`Reference picture from ${order.name}`}
                          className="max-h-96 w-full rounded-[14px] bg-cream-200 object-contain"
                        />
                      </a>
                      <figcaption className="mt-1 text-sm text-muted">
                        Reference picture.{' '}
                        <a
                          href={order.reference_image_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-4"
                        >
                          View reference picture
                        </a>{' '}
                        (the link expires after an hour)
                      </figcaption>
                    </figure>
                  )}
                </section>

                {order.customer_id ? (
                  <Discussion
                    messages={current.messages}
                    me="ADMIN"
                    otherName={order.name}
                    canWrite={DISCUSSION_OPEN.includes(order.status)}
                    closedText="This request is finished, so the discussion is closed."
                    onSend={send}
                    onRefresh={refresh}
                  />
                ) : (
                  <section aria-label="Discussion" className={`${cardClass} p-4 md:p-5`}>
                    <h2 className="font-serif text-2xl">Discussion</h2>
                    <p className="mt-2 text-bark">
                      This request came from a guest, so there is no discussion in the system. Talk
                      to them on WhatsApp ({order.whatsapp_number}).
                    </p>
                  </section>
                )}
              </div>

              <div className="flex flex-col gap-6">
                <section aria-label="Price" className={`${cardClass} p-4 md:p-5`}>
                  <h2 className="font-serif text-2xl">Price</h2>
                  <dl className="mt-2 flex flex-col gap-1">
                    <div className="flex flex-nowrap justify-between gap-4">
                      <dt className="text-bark">Customer&apos;s budget</dt>
                      <dd>
                        {order.budget_paisa !== null
                          ? formatPrice(order.budget_paisa)
                          : 'Not given'}
                      </dd>
                    </div>
                    <div className="flex flex-nowrap justify-between gap-4">
                      <dt className="text-bark">Agreed price</dt>
                      <dd className="font-semibold">
                        {order.agreed_price_paisa !== null
                          ? formatPrice(order.agreed_price_paisa)
                          : 'Not accepted yet'}
                      </dd>
                    </div>
                  </dl>
                  {order.customer_offer_paisa !== null && order.status === 'IN_DISCUSSION' && (
                    <div className="mt-3 rounded-[10px] bg-accent-tint p-3">
                      <p>
                        The customer offered{' '}
                        <strong>{formatPrice(order.customer_offer_paisa)}</strong>.
                      </p>
                      <button
                        type="button"
                        className={`${buttonClass} mt-2`}
                        disabled={busy}
                        onClick={() => setAcceptingOffer(true)}
                      >
                        Accept {formatPrice(order.customer_offer_paisa)}
                      </button>
                      <p className="mt-2 text-sm text-bark">
                        Or propose a different price below: that replaces their offer.
                      </p>
                    </div>
                  )}
                  {order.proposed_price_paisa !== null && order.agreed_price_paisa === null && (
                    <p className="mt-3 rounded-[10px] bg-accent-tint p-3">
                      You proposed <strong>{formatPrice(order.proposed_price_paisa)}</strong>.
                      Waiting for the customer to confirm it.
                    </p>
                  )}
                  {order.status === 'IN_DISCUSSION' && (
                    <form
                      onSubmit={onPrice}
                      aria-label={order.customer_id ? 'Propose a price' : 'Record the agreed price'}
                      className="mt-4 flex flex-col gap-2"
                    >
                      <label htmlFor="agreed-price" className="text-sm font-medium text-bark">
                        {order.customer_id
                          ? 'Price to propose in Rs'
                          : 'Price agreed on WhatsApp in Rs'}
                      </label>
                      <input
                        id="agreed-price"
                        name="price"
                        inputMode="decimal"
                        defaultValue={
                          order.proposed_price_paisa !== null
                            ? paisaToRupeesInput(order.proposed_price_paisa)
                            : order.budget_paisa !== null
                              ? paisaToRupeesInput(order.budget_paisa)
                              : ''
                        }
                        className={inputClass}
                      />
                      <p className="text-sm text-bark">
                        {order.customer_id
                          ? 'The customer is told and confirms the price themselves. Only then is the request accepted. You can change the price until they confirm.'
                          : 'This request came from a guest: once the guest has agreed on WhatsApp, record it here to accept.'}
                      </p>
                      <div>
                        <button type="submit" className={buttonClass} disabled={busy}>
                          {order.customer_id
                            ? order.proposed_price_paisa !== null
                              ? 'Change the proposed price'
                              : 'Propose this price'
                            : 'Accept at this price'}
                        </button>
                      </div>
                    </form>
                  )}
                  {order.status === 'NEW' && order.customer_id && (
                    <p className="mt-3 text-sm text-bark">
                      Start the discussion first, then propose a price.
                    </p>
                  )}
                </section>

                {CUSTOM_ORDER_NEXT[order.status] && (
                  <section aria-label="Actions" className={`${cardClass} p-4 md:p-5`}>
                    <h2 className="font-serif text-2xl">Actions</h2>
                    <p className="mt-3 flex flex-wrap gap-3">
                      {CUSTOM_ORDER_NEXT[order.status].map(([target, label]) => (
                        <button
                          key={target}
                          type="button"
                          disabled={busy}
                          className="min-h-11 rounded-full border border-terracotta px-4 py-1 text-terracotta hover:bg-cream-200 disabled:opacity-50"
                          onClick={() => void move(target)}
                        >
                          {label}
                        </button>
                      ))}
                    </p>
                  </section>
                )}
              </div>
            </div>
          </div>
        )}
      </State>
      <ConfirmDialog
        open={acceptingOffer}
        title="Accept the customer's offer?"
        confirmLabel="Yes, accept"
        cancelLabel="Not yet"
        onCancel={() => setAcceptingOffer(false)}
        onConfirm={() => void onAcceptOffer()}
      >
        <p>
          The request is accepted at{' '}
          {order?.customer_offer_paisa != null && formatPrice(order.customer_offer_paisa)} and the
          customer is told. The price is then final.
        </p>
      </ConfirmDialog>
    </>
  )
}
