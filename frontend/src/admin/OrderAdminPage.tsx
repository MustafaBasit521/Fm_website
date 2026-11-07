import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  cancelAdminOrder,
  confirmCodPayment,
  getAdminOrder,
  markOrderPaid,
  refundOrder,
  setOrderStatus,
  type AdminOrder,
} from '../lib/adminApi'
import { ApiError } from '../lib/api'
import { formatPrice, parseRupeesToPaisa } from '../lib/money'
import { formatDate, paymentStatusLabel, statusLabel } from '../lib/orderStatus'
import { isWalletMethod, methodName, REJECTION_LABELS } from '../lib/paymentText'
import { ConfirmDialog } from '../pages/ConfirmDialog'
import { BackLink, buttonClass, FormError } from '../pages/ui'
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
  AMOUNT_MISMATCH:
    'The amount must be exactly the order total. If the customer sent a different amount, do not mark this as paid: contact them first.',
  USE_PAYMENTS_QUEUE: 'Payments are checked on the Payments page. Open the receipt there.',
  ORDER_NOT_OPEN: 'This order is no longer waiting for payment. Reload the page.',
  NOT_A_MANUAL_PAYMENT: 'Only Easypaisa and JazzCash orders can be marked as paid.',
}
const REFERENCE = /^[A-Za-z0-9-]{6,40}$/

export default function OrderAdminPage() {
  const { id = '' } = useParams()
  const { data, loading, failed } = useLoad((s) => getAdminOrder(id, s), [id])
  const [override, setOverride] = useState<AdminOrder | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [waive, setWaive] = useState(false)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundRef, setRefundRef] = useState('')
  const [paying, setPaying] = useState(false) // the "Mark as paid" pop-up
  const [paidAmount, setPaidAmount] = useState('')
  const [paidRef, setPaidRef] = useState('')
  const [paidNote, setPaidNote] = useState('')

  const order = override?.order_id === id ? override : data
  // Easypaisa / JazzCash money not yet recorded (also after a cancellation: late payment)
  const walletUnpaid =
    order !== undefined &&
    order !== null &&
    order.payments.some((p) => isWalletMethod(p.method) && p.status === 'PENDING')
  const payable = walletUnpaid && order !== null && ['PENDING', 'CANCELLED'].includes(order.status)
  // an online or wallet order cannot be confirmed by hand before the money is recorded
  const awaitingMoney =
    order !== undefined &&
    order !== null &&
    order.payment_method !== 'COD' &&
    order.payment_status !== 'PAID'

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
    const reference = refundRef.trim()
    if (reference && !REFERENCE.test(reference))
      return setError('The wallet transaction number is 6 to 40 letters, digits or dashes.')
    if (await act(() => refundOrder(id, amount, reference || null))) {
      setRefundAmount('')
      setRefundRef('')
    }
  }

  function openPaid() {
    setPaidAmount('')
    setPaidRef('')
    setPaidNote('')
    setError(null)
    setPaying(true)
  }

  async function onMarkPaid() {
    const amount = parseRupeesToPaisa(paidAmount)
    if (amount === null || amount === 0)
      return setError('Type the amount you received in Rs, like 2701 or 2701.50.')
    const reference = paidRef.trim()
    if (reference && !REFERENCE.test(reference))
      return setError('The transaction number is 6 to 40 letters, digits or dashes.')
    // the server compares the amount with the order total; it alone decides
    const ok = await act(() =>
      markOrderPaid(id, { amount_paisa: amount, reference: reference || null, note: paidNote }),
    )
    if (ok) setPaying(false)
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
                  {methodName(order.payment_method)} · {paymentStatusLabel(order.payment_status)}
                </Badge>
              </p>
            </header>

            <FormError message={paying ? null : error} />

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
                        {p.method === 'ONLINE' ? 'Online attempt' : methodName(p.method)} —{' '}
                        {paymentStatusLabel(p.status)} — {formatPrice(p.amount_paisa)}
                        {p.refunded_amount_paisa > 0 &&
                          ` (refunded ${formatPrice(p.refunded_amount_paisa)})`}
                        {p.paid_marked_at && (
                          <span className="block text-sm text-bark">
                            Marked as paid {formatDate(p.paid_marked_at)}
                            {p.paid_reference ? ` · transaction ${p.paid_reference}` : ''}
                            {p.paid_note ? ` · ${p.paid_note}` : ''}
                          </span>
                        )}
                        {(p.refunds ?? []).map((r) => (
                          <span key={r.refund_id} className="block text-sm text-bark">
                            Refunded {formatPrice(r.amount_paisa)} on {formatDate(r.created_at)}
                            {r.wallet_reference ? ` · transaction ${r.wallet_reference}` : ''}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                  {order.payments.some((p) => (p.attempts?.length ?? 0) > 0) && (
                    <div className="mt-4 flex flex-col gap-2 rounded-[10px] bg-cream-100 p-3">
                      <h3 className="font-semibold">Payment details sent by the customer</h3>
                      <ul className="flex flex-col gap-1 text-sm">
                        {order.payments
                          .flatMap((p) => p.attempts ?? [])
                          .map((a) => (
                            <li key={a.attempt_id}>
                              <strong className="break-all">{a.transaction_reference}</strong> —{' '}
                              {a.status === 'SUBMITTED'
                                ? 'waiting for your check'
                                : a.status === 'PAID'
                                  ? 'verified'
                                  : `rejected${a.rejection_reason ? ` (${REJECTION_LABELS[a.rejection_reason]})` : ''}`}{' '}
                              — sent {formatDate(a.created_at)}
                            </li>
                          ))}
                      </ul>
                      <p className="text-sm text-bark">
                        Receipts are checked and decided on the{' '}
                        <Link to="/payments" className="underline">
                          Payments page
                        </Link>
                        .
                      </p>
                    </div>
                  )}
                  {order.payments.some((p) => isWalletMethod(p.method) && p.status === 'PENDING') &&
                    order.status === 'PENDING' &&
                    !order.payments.some((p) =>
                      p.attempts?.some((a) => a.status === 'SUBMITTED'),
                    ) && (
                      <p className="mt-4 rounded-[10px] bg-cream-100 p-3">
                        {order.payment_deadline_at
                          ? `Waiting for the customer to send the transaction number and receipt (until ${new Date(order.payment_deadline_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}).`
                          : 'Waiting for the payment. The customer sends the screenshot on WhatsApp. When you see the full amount in your wallet app, press "Mark as paid". This order does not expire: cancel it yourself if the customer does not pay.'}
                      </p>
                    )}
                </section>
              </div>

              <div className="flex flex-col gap-6">
                <section
                  aria-label="Actions"
                  className={`${cardClass} flex flex-col gap-3 p-4 md:p-5`}
                >
                  <h2 className="font-serif text-2xl">Actions</h2>
                  {payable && (
                    <div>
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={busy}
                        onClick={openPaid}
                      >
                        Mark as paid
                      </button>
                      <p className="mt-1 text-sm text-bark">
                        {order.status === 'CANCELLED'
                          ? 'The order was cancelled but the money arrived. It is recorded as paid and can be refunded in full.'
                          : 'Press this only after you saw the full amount in your wallet app.'}
                      </p>
                    </div>
                  )}
                  {NEXT[order.status] && !awaitingMoney && (
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
                      {order.payments.some((p) => isWalletMethod(p.method)) && (
                        <div className="flex flex-col gap-1 sm:w-64">
                          <label htmlFor="refund-ref" className="text-sm font-medium text-bark">
                            Transaction number of the refund in your wallet app (optional)
                          </label>
                          <input
                            id="refund-ref"
                            className={inputClass}
                            maxLength={40}
                            value={refundRef}
                            onChange={(e) => setRefundRef(e.target.value)}
                          />
                        </div>
                      )}
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
        open={paying}
        title="Did you receive the money?"
        confirmLabel="Yes, mark as paid"
        cancelLabel="Not yet"
        busy={busy}
        onCancel={() => setPaying(false)}
        onConfirm={() => void onMarkPaid()}
      >
        {order && (
          <>
            <p>
              Open your {methodName(order.payment_method)} app and look for{' '}
              <strong>{formatPrice(order.total_amount_paisa)}</strong> for order{' '}
              <strong>{order.order_id.slice(0, 8).toUpperCase()}</strong>. Only continue if you can
              see the full amount there.
            </p>
            <div className="mt-3 flex flex-col gap-1">
              <label htmlFor="paid-amount" className="text-sm font-medium text-bark">
                Amount you received, in Rs
              </label>
              <input
                id="paid-amount"
                className={inputClass}
                inputMode="decimal"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
              />
            </div>
            <div className="mt-3 flex flex-col gap-1">
              <label htmlFor="paid-ref" className="text-sm font-medium text-bark">
                Wallet transaction number (optional)
              </label>
              <input
                id="paid-ref"
                className={inputClass}
                maxLength={40}
                value={paidRef}
                onChange={(e) => setPaidRef(e.target.value)}
              />
            </div>
            <div className="mt-3 flex flex-col gap-1">
              <label htmlFor="paid-note" className="text-sm font-medium text-bark">
                Note (optional)
              </label>
              <input
                id="paid-note"
                className={inputClass}
                maxLength={300}
                value={paidNote}
                onChange={(e) => setPaidNote(e.target.value)}
              />
            </div>
            <FormError message={error} />
          </>
        )}
      </ConfirmDialog>
    </>
  )
}
