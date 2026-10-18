import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  cancelAdminOrder,
  confirmCodPayment,
  confirmTransferPayment,
  getPaymentProofImage,
  rejectTransferProof,
  getAdminOrder,
  refundOrder,
  setOrderStatus,
  type AdminOrder,
} from '../lib/adminApi'
import { ApiError } from '../lib/api'
import { formatPrice, parseRupeesToPaisa } from '../lib/money'
import { formatDate, paymentStatusLabel, statusLabel } from '../lib/orderStatus'
import { ConfirmDialog } from '../pages/ConfirmDialog'
import { BackLink, buttonClass, FormError, secondaryButtonClass } from '../pages/ui'
import { inputClass } from './styles'
import { Badge, ConfirmButton, PageTitle, State, cardClass } from './ui'
import { useLoad } from './useLoad'
import { StatusBadge } from '../pages/StatusBadge'

const NEXT: Record<string, [string, string]> = {
  PENDING: ['CONFIRMED', 'Confirm order'],
  CONFIRMED: ['PROCESSING', 'Start preparing'],
  PROCESSING: ['SHIPPED', 'Mark as shipped'],
  SHIPPED: ['DELIVERED', 'Mark as delivered'],
}
const STEPS = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']
const ERRORS: Record<string, string> = {
  PAYMENT_NOT_VERIFIED: 'An online order can be confirmed only after its payment is verified.',
  INVALID_TRANSITION: 'That change is not allowed from the current status. Reload the page.',
  CANNOT_CANCEL: 'This order can no longer be cancelled.',
  ADDRESS_LOCKED: 'The address can no longer be changed for this order.',
  NOT_DELIVERABLE: 'We deliver only within Lahore.',
  NOT_DELIVERED: 'Cash payment can be confirmed only after delivery.',
  ALREADY_PAID: 'Payment was already recorded.',
  NOT_CANCELLED: 'Only cancelled orders can be refunded.',
  NOTHING_TO_REFUND: 'There is nothing left to refund.',
  REFUND_TOO_LARGE: 'That is more than is still owed to the customer.',
  REFUND_FAILED:
    'The payment provider could not process the refund. Nothing was changed; try again.',
  PAYMENT_PROVIDER_UNAVAILABLE: 'The payment service is unavailable right now.',
}

export default function OrderAdminPage() {
  const { id = '' } = useParams()
  const { data, loading, failed } = useLoad((s) => getAdminOrder(id, s), [id])
  const [override, setOverride] = useState<AdminOrder | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [waive, setWaive] = useState(false)
  const [refundAmount, setRefundAmount] = useState('')

  const order = override?.order_id === id ? override : data
  const [transferDialog, setTransferDialog] = useState<'confirm' | 'reject' | null>(null)
  const [proofImage, setProofImage] = useState<{ key: string; url: string | null } | null>(null)
  const transfer = order?.payments.find((p) => p.method === 'TRANSFER') ?? null
  const proofKey = `${id}:${transfer?.proof_submitted_at ?? ''}`
  // the proof is only shown (and so only fetched) while the payment is waiting to be checked
  const proofOpen =
    !!transfer?.proof_submitted_at && transfer.status === 'PENDING' && order?.status === 'PENDING'

  // the screenshot sits in a private bucket: ask for a temporary link when a proof exists
  useEffect(() => {
    if (!proofOpen) return
    const controller = new AbortController()
    getPaymentProofImage(id, controller.signal)
      .then(({ url }) => setProofImage({ key: proofKey, url }))
      .catch(() => setProofImage({ key: proofKey, url: null }))
    return () => controller.abort()
  }, [id, proofKey, proofOpen])

  async function act(fn: () => Promise<AdminOrder>) {
    setBusy(true)
    setError(null)
    try {
      setOverride(await fn())
      return true
    } catch (e) {
      setError(
        (e instanceof ApiError && e.code && ERRORS[e.code]) ||
          'That did not work. Please try again.',
      )
      return false
    } finally {
      setBusy(false)
    }
  }

  async function onRefund() {
    let amount: number | null = null
    if (refundAmount.trim()) {
      amount = parseRupeesToPaisa(refundAmount)
      if (amount === null || amount === 0)
        return setError('Enter the refund amount in Rs, like 500 or 500.50.')
    }
    await act(() => refundOrder(id, amount))
    setRefundAmount('')
  }

  return (
    <>
      <BackLink to="/orders">All orders</BackLink>
      <State loading={loading && !order} failed={failed && !order}>
        {order && (
          <div className="mt-3 flex flex-col gap-6">
            <header>
              <PageTitle
                eyebrow={`Placed ${formatDate(order.created_at)} · ${order.items.length} ${order.items.length === 1 ? 'line' : 'lines'} · ${formatPrice(order.total_amount_paisa)}`}
                title="Order"
              />
              <p className="mt-1 break-all text-sm text-muted">{order.order_id}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={order.status} />
                <Badge>
                  {order.payment_method === 'COD' ? 'Cash on delivery' : 'Online'} ·{' '}
                  {paymentStatusLabel(order.payment_status)}
                </Badge>
              </p>
            </header>

            <FormError message={error} />

            <section aria-label="Progress" className={`${cardClass} p-4`}>
              {order.status === 'CANCELLED' ? (
                <p>
                  <strong>This order was cancelled.</strong>
                  {order.cancelled_at ? ` ${formatDate(order.cancelled_at)}` : ''}
                </p>
              ) : (
                <ol aria-label="Order progress" className="grid grid-cols-5 gap-2">
                  {STEPS.map((step, i) => {
                    const reached = i <= STEPS.indexOf(order.status)
                    return (
                      <li
                        key={step}
                        aria-current={step === order.status ? 'step' : undefined}
                        className="min-w-0"
                      >
                        <span
                          aria-hidden="true"
                          className={`block h-1.5 rounded-full ${reached ? 'bg-terracotta' : 'bg-linen'}`}
                        />
                        <span
                          className={`mt-2 block truncate text-xs sm:text-sm ${step === order.status ? 'font-semibold text-ink' : 'text-bark'}`}
                        >
                          {statusLabel(step)}
                        </span>
                      </li>
                    )
                  })}
                </ol>
              )}
            </section>

            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className="flex flex-col gap-6">
                <section aria-label="Items" className={`${cardClass} p-4 md:p-5`}>
                  <h2 className="font-serif text-2xl">Items</h2>
                  <ul className="mt-3 divide-y divide-sand">
                    {order.items.map((i) => (
                      <li
                        key={`${i.product_name_snapshot}-${i.unit_price_at_purchase_paisa}`}
                        className="flex flex-nowrap items-center gap-3 py-3"
                      >
                        {i.image_url ? (
                          <img
                            src={i.image_url}
                            alt=""
                            className="h-14 w-12 shrink-0 rounded-[10px] bg-cream-200 object-cover"
                          />
                        ) : (
                          <span
                            aria-hidden="true"
                            className="h-14 w-12 shrink-0 rounded-[10px] bg-cream-200"
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          {i.quantity} × {i.product_name_snapshot}
                        </span>
                        <span className="whitespace-nowrap font-semibold">
                          {formatPrice(i.quantity * i.unit_price_at_purchase_paisa)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <dl className="mt-2 grid grid-cols-2 gap-1 border-t border-sand pt-3 text-right">
                    <dt className="text-left text-bark">Subtotal</dt>
                    <dd>{formatPrice(order.subtotal_paisa)}</dd>
                    <dt className="text-left text-bark">Delivery</dt>
                    <dd>{formatPrice(order.delivery_fee_paisa)}</dd>
                    <dt className="text-left text-lg font-semibold">Total</dt>
                    <dd className="text-lg font-semibold">
                      {formatPrice(order.total_amount_paisa)}
                    </dd>
                    {order.status === 'CANCELLED' && (
                      <>
                        <dt className="text-left text-bark">Cancellation charge</dt>
                        <dd>
                          {formatPrice(order.cancellation_charge_paisa)}
                          {order.charge_waived ? ' (waived)' : ''}
                        </dd>
                      </>
                    )}
                  </dl>
                </section>

                <section aria-label="Payments" className={`${cardClass} p-4 md:p-5`}>
                  <h2 className="font-serif text-2xl">Payments</h2>
                  <ul className="mt-3 flex flex-col gap-1">
                    {order.payments.map((p) => (
                      <li key={p.payment_id}>
                        {p.method === 'COD'
                          ? 'Cash on delivery'
                          : p.method === 'TRANSFER'
                            ? 'Bank or wallet transfer'
                            : 'Online attempt'}{' '}
                        — {paymentStatusLabel(p.status)} — {formatPrice(p.amount_paisa)}
                        {p.refunded_amount_paisa > 0 &&
                          ` (refunded ${formatPrice(p.refunded_amount_paisa)})`}
                      </li>
                    ))}
                  </ul>
                  {transfer && transfer.status === 'PENDING' && order.status === 'PENDING' && (
                    <div className="mt-4 flex flex-col gap-3 rounded-[10px] bg-cream-100 p-3">
                      {transfer.proof_submitted_at ? (
                        <>
                          <p>
                            <strong>The customer says they paid.</strong>{' '}
                            {transfer.proof_reference && (
                              <>
                                Transaction number: <strong>{transfer.proof_reference}</strong>
                                .{' '}
                              </>
                            )}
                            Sent {formatDate(transfer.proof_submitted_at)}.
                          </p>
                          {proofImage?.key === proofKey && proofImage.url && (
                            <figure>
                              <a href={proofImage.url} target="_blank" rel="noopener noreferrer">
                                <img
                                  src={proofImage.url}
                                  alt="Screenshot of the payment sent by the customer"
                                  className="max-h-96 w-full rounded-[10px] bg-cream-200 object-contain"
                                />
                              </a>
                              <figcaption className="mt-1 text-sm text-muted">
                                Payment screenshot (the link expires after an hour)
                              </figcaption>
                            </figure>
                          )}
                          <p className="text-sm text-bark">
                            Check your account for {formatPrice(transfer.amount_paisa)}, then
                            choose.
                          </p>
                        </>
                      ) : (
                        <p>
                          Waiting for the customer to send their payment details
                          {order.payment_deadline_at
                            ? ` (until ${new Date(order.payment_deadline_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })})`
                            : ''}
                          . If you already see the money in your account you can confirm it now.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={busy}
                          onClick={() => setTransferDialog('confirm')}
                        >
                          Payment received
                        </button>
                        {transfer.proof_submitted_at && (
                          <button
                            type="button"
                            className={secondaryButtonClass}
                            disabled={busy}
                            onClick={() => setTransferDialog('reject')}
                          >
                            Not received
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              </div>

              <div className="flex flex-col gap-6">
                <section
                  aria-label="Actions"
                  className={`${cardClass} flex flex-col gap-3 p-4 md:p-5`}
                >
                  <h2 className="font-serif text-2xl">Actions</h2>
                  {NEXT[order.status] && (
                    <div>
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={busy}
                        onClick={() => void act(() => setOrderStatus(id, NEXT[order.status][0]))}
                      >
                        {NEXT[order.status][1]}
                      </button>
                    </div>
                  )}
                  {order.status === 'DELIVERED' &&
                    order.payment_method === 'COD' &&
                    order.payment_status === 'PENDING' && (
                      <div>
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={busy}
                          onClick={() => void act(() => confirmCodPayment(id))}
                        >
                          Confirm cash received
                        </button>
                      </div>
                    )}
                  {['PENDING', 'CONFIRMED', 'PROCESSING'].includes(order.status) && (
                    <div className="flex flex-col gap-2">
                      {order.status === 'PROCESSING' &&
                        order.payment_method === 'ONLINE' &&
                        order.payment_status === 'PAID' && (
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={waive}
                              onChange={(e) => setWaive(e.target.checked)}
                            />
                            Waive the cancellation charge (otherwise{' '}
                            {formatPrice(Math.floor(order.total_amount_paisa / 2))} is kept)
                          </label>
                        )}
                      {order.status === 'PROCESSING' && order.payment_method === 'COD' && (
                        <p className="text-sm text-muted">
                          Cash on delivery: the cancellation charge is waived automatically.
                        </p>
                      )}
                      <ConfirmButton
                        label="Cancel order"
                        confirmLabel="Yes, cancel this order"
                        disabled={busy}
                        onConfirm={() => void act(() => cancelAdminOrder(id, waive))}
                      />
                    </div>
                  )}
                  {order.status === 'CANCELLED' && order.refund_due_paisa > 0 && (
                    <div className="flex flex-col gap-2">
                      <p>
                        Refund still owed to the customer:{' '}
                        <strong>{formatPrice(order.refund_due_paisa)}</strong>
                      </p>
                      <div className="flex flex-col gap-1 sm:w-64">
                        <label htmlFor="refund" className="text-sm font-medium text-bark">
                          Amount in Rs (leave empty to refund everything owed)
                        </label>
                        <input
                          id="refund"
                          className={inputClass}
                          inputMode="decimal"
                          value={refundAmount}
                          onChange={(e) => setRefundAmount(e.target.value)}
                        />
                      </div>
                      <div>
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={busy}
                          onClick={() => void onRefund()}
                        >
                          Refund
                        </button>
                      </div>
                    </div>
                  )}
                  {((order.status === 'CANCELLED' && order.refund_due_paisa === 0) ||
                    (order.status === 'DELIVERED' &&
                      !(order.payment_method === 'COD' && order.payment_status === 'PENDING'))) && (
                    <p className="text-muted">No actions left.</p>
                  )}
                </section>

                <section aria-label="Customer" className={`${cardClass} p-4 md:p-5`}>
                  <h2 className="font-serif text-2xl">Customer</h2>
                  <p className="mt-2">
                    {order.customer_name} · {order.customer_email}
                    {order.customer_phone ? ` · ${order.customer_phone}` : ''}
                  </p>
                  <p className="text-sm text-muted">
                    {order.customer_id ? (
                      <Link
                        to={`/customers/${order.customer_id}`}
                        className="text-terracotta underline"
                      >
                        View customer
                      </Link>
                    ) : (
                      'Guest order'
                    )}
                  </p>
                </section>

                <section aria-label="Delivery" className={`${cardClass} p-4 md:p-5`}>
                  <h2 className="font-serif text-2xl">Delivery</h2>
                  <p className="mt-2">
                    {order.delivery_name}, {order.delivery_house_no}
                    {order.delivery_street_number ? `, ${order.delivery_street_number}` : ''},{' '}
                    {order.delivery_city}, {order.delivery_postal_code}, {order.delivery_country}
                  </p>
                </section>
              </div>
            </div>
          </div>
        )}
      </State>
      <ConfirmDialog
        open={transferDialog === 'confirm'}
        title="Payment received?"
        confirmLabel="Yes, confirm the order"
        cancelLabel="Not yet"
        onCancel={() => setTransferDialog(null)}
        onConfirm={() => {
          setTransferDialog(null)
          void act(() => confirmTransferPayment(id))
        }}
      >
        <p>
          Only confirm if the money is really in your account. The payment is marked Paid, the order
          is confirmed and the customer is told.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={transferDialog === 'reject'}
        title="Money not found?"
        confirmLabel="Yes, ask them again"
        cancelLabel="Back"
        onCancel={() => setTransferDialog(null)}
        onConfirm={() => {
          setTransferDialog(null)
          void act(() => rejectTransferProof(id))
        }}
      >
        <p>
          The customer is told you could not find their payment and gets another 30 minutes to send
          correct details. After that the order is cancelled.
        </p>
      </ConfirmDialog>
    </>
  )
}
