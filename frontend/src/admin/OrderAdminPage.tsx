import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  cancelAdminOrder,
  changeAdminOrderAddress,
  confirmCodPayment,
  getAdminOrder,
  refundOrder,
  setOrderStatus,
  type AdminOrder,
} from '../lib/adminApi'
import { ApiError } from '../lib/api'
import { formatPrice, parseRupeesToPaisa } from '../lib/money'
import { formatDate, paymentStatusLabel, statusLabel } from '../lib/orderStatus'
import { buttonClass, Field, FormError } from '../pages/ui'
import { inputClass } from './styles'
import { Badge, ConfirmButton, State } from './ui'
import { useLoad } from './useLoad'

const NEXT: Record<string, [string, string]> = {
  PENDING: ['CONFIRMED', 'Confirm order'],
  CONFIRMED: ['PROCESSING', 'Start preparing'],
  PROCESSING: ['SHIPPED', 'Mark as shipped'],
  SHIPPED: ['DELIVERED', 'Mark as delivered'],
}
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
  const [editingAddress, setEditingAddress] = useState(false)

  const order = override?.order_id === id ? override : data

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

  async function onAddress(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const text = (k: string) => String(form.get(k) ?? '').trim()
    const optional = (k: string) => text(k) || null
    const ok = await act(() =>
      changeAdminOrderAddress(id, {
        recipient_name: optional('recipient_name'),
        address: {
          house_no: text('house_no'),
          street_number: optional('street_number'),
          city: text('city'),
          province: optional('province'),
          postal_code: text('postal_code'),
          country: text('country'),
        },
      }),
    )
    if (ok) setEditingAddress(false)
  }

  return (
    <>
      <Link to="/admin/orders" className="text-terracotta underline">
        ← All orders
      </Link>
      <State loading={loading && !order} failed={failed && !order}>
        {order && (
          <div className="mt-2 flex flex-col gap-6">
            <header>
              <h1 className="font-serif text-4xl">Order</h1>
              <p className="break-all text-sm text-muted">{order.order_id}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2">
                <Badge>{statusLabel(order.status)}</Badge>
                <Badge>
                  {order.payment_method === 'COD' ? 'Cash on delivery' : 'Online'} ·{' '}
                  {paymentStatusLabel(order.payment_status)}
                </Badge>
                <span className="text-sm text-muted">Placed {formatDate(order.created_at)}</span>
              </p>
            </header>

            <FormError message={error} />

            <section
              aria-label="Actions"
              className="flex flex-col gap-3 rounded-xl border border-sand bg-cream-100 p-4"
            >
              <h2 className="text-xl font-semibold">Actions</h2>
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
              {!NEXT[order.status] &&
                !['CANCELLED'].includes(order.status) &&
                order.status !== 'DELIVERED' &&
                null}
              {order.status === 'CANCELLED' && order.refund_due_paisa === 0 && (
                <p className="text-muted">No actions left.</p>
              )}
            </section>

            <section aria-label="Items">
              <h2 className="text-xl font-semibold">Items</h2>
              <ul className="mt-2 flex flex-col gap-1">
                {order.items.map((i) => (
                  <li
                    key={`${i.product_name_snapshot}-${i.unit_price_at_purchase_paisa}`}
                    className="flex justify-between"
                  >
                    <span>
                      {i.quantity} × {i.product_name_snapshot}
                    </span>
                    <span>{formatPrice(i.quantity * i.unit_price_at_purchase_paisa)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-3 grid grid-cols-2 gap-1 text-right">
                <dt className="text-left">Subtotal</dt>
                <dd>{formatPrice(order.subtotal_paisa)}</dd>
                <dt className="text-left">Delivery</dt>
                <dd>{formatPrice(order.delivery_fee_paisa)}</dd>
                <dt className="text-left font-semibold">Total</dt>
                <dd className="font-semibold">{formatPrice(order.total_amount_paisa)}</dd>
                {order.status === 'CANCELLED' && (
                  <>
                    <dt className="text-left">Cancellation charge</dt>
                    <dd>
                      {formatPrice(order.cancellation_charge_paisa)}
                      {order.charge_waived ? ' (waived)' : ''}
                    </dd>
                  </>
                )}
              </dl>
            </section>

            <section aria-label="Customer">
              <h2 className="text-xl font-semibold">Customer</h2>
              <p>
                {order.customer_name} · {order.customer_email}
                {order.customer_phone ? ` · ${order.customer_phone}` : ''}
              </p>
              <p className="text-sm text-muted">
                {order.customer_id ? (
                  <Link
                    to={`/admin/customers/${order.customer_id}`}
                    className="text-terracotta underline"
                  >
                    View customer
                  </Link>
                ) : (
                  'Guest order'
                )}
              </p>
            </section>

            <section aria-label="Delivery">
              <h2 className="text-xl font-semibold">Delivery</h2>
              {!editingAddress ? (
                <>
                  <p>
                    {order.delivery_name}, {order.delivery_house_no}
                    {order.delivery_street_number ? `, ${order.delivery_street_number}` : ''},{' '}
                    {order.delivery_city}, {order.delivery_postal_code}, {order.delivery_country}
                  </p>
                  {['PENDING', 'CONFIRMED'].includes(order.status) && (
                    <button
                      type="button"
                      className="mt-1 text-terracotta underline"
                      onClick={() => setEditingAddress(true)}
                    >
                      Change address
                    </button>
                  )}
                </>
              ) : (
                <form
                  onSubmit={onAddress}
                  aria-label="Change delivery address"
                  className="mt-2 flex flex-col gap-3 rounded-xl border border-sand bg-white p-4"
                >
                  <Field
                    id="recipient_name"
                    name="recipient_name"
                    label="Recipient name"
                    defaultValue={order.delivery_name}
                    maxLength={100}
                  />
                  <Field
                    id="house_no"
                    name="house_no"
                    label="House number"
                    defaultValue={order.delivery_house_no}
                    required
                  />
                  <Field
                    id="street_number"
                    name="street_number"
                    label="Street number"
                    defaultValue={order.delivery_street_number ?? ''}
                  />
                  <Field
                    id="city"
                    name="city"
                    label="City"
                    defaultValue={order.delivery_city}
                    required
                  />
                  <Field
                    id="province"
                    name="province"
                    label="Province"
                    defaultValue={order.delivery_province ?? ''}
                  />
                  <Field
                    id="postal_code"
                    name="postal_code"
                    label="Postal code"
                    defaultValue={order.delivery_postal_code}
                    required
                  />
                  <Field
                    id="country"
                    name="country"
                    label="Country"
                    defaultValue={order.delivery_country}
                    required
                  />
                  <div className="flex gap-3">
                    <button type="submit" className={buttonClass} disabled={busy}>
                      Save address
                    </button>
                    <button
                      type="button"
                      className="underline"
                      onClick={() => setEditingAddress(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </section>

            <section aria-label="Payments">
              <h2 className="text-xl font-semibold">Payments</h2>
              <ul className="mt-2 flex flex-col gap-1">
                {order.payments.map((p) => (
                  <li key={p.payment_id}>
                    {p.method === 'COD' ? 'Cash on delivery' : 'Online attempt'} —{' '}
                    {paymentStatusLabel(p.status)} — {formatPrice(p.amount_paisa)}
                    {p.refunded_amount_paisa > 0 &&
                      ` (refunded ${formatPrice(p.refunded_amount_paisa)})`}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </State>
    </>
  )
}
