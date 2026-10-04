import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, cancelOrder, changeOrderAddress, getOrder, type Order } from '../lib/api'
import { formatPrice } from '../lib/money'
import { formatDate, paymentStatusLabel, statusLabel } from '../lib/orderStatus'
import { buttonClass, Field, FormError } from './ui'

// Which actions the customer is offered. The server enforces the same rules (business-rules
// §15, §16); the UI only decides what to show.
const CUSTOMER_EDITABLE = ['PENDING', 'CONFIRMED']

export default function OrderDetailPage() {
  const { id = '' } = useParams()
  const [loaded, setLoaded] = useState<{
    id: string
    order: Order | null
    notFound: boolean
  } | null>(null)
  const [override, setOverride] = useState<Order | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [editingAddress, setEditingAddress] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getOrder(id, controller.signal)
      .then((order) => setLoaded({ id, order, notFound: false }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        const notFound = e instanceof ApiError && (e.status === 404 || e.status === 422)
        setLoaded({ id, order: null, notFound })
      })
    return () => controller.abort()
  }, [id])

  const current = loaded?.id === id ? loaded : null
  const order = override?.order_id === id ? override : (current?.order ?? null)

  const back = (
    <Link to="/orders" className="text-terracotta underline">
      ← My orders
    </Link>
  )

  if (!current)
    return (
      <p role="status" className="p-4">
        Loading…
      </p>
    )
  if (!order) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        {back}
        {current.notFound ? (
          <h1 className="mt-2 font-serif text-4xl">Order not found</h1>
        ) : (
          <p role="alert" className="mt-4 text-danger">
            Could not load this order.
          </p>
        )}
      </main>
    )
  }

  const editable = CUSTOMER_EDITABLE.includes(order.status)

  async function onCancel() {
    setBusy(true)
    setError(null)
    try {
      setOverride(await cancelOrder(id))
      setConfirmCancel(false)
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'CONTACT_SHOP'
          ? 'This order is now being prepared. Please contact the shop to cancel it.'
          : 'This order can no longer be cancelled.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function onAddressSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const text = (k: string) => String(form.get(k) ?? '').trim()
    const optional = (k: string) => text(k) || null
    setBusy(true)
    setError(null)
    try {
      setOverride(
        await changeOrderAddress(id, {
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
      setEditingAddress(false)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NOT_DELIVERABLE') {
        setError('We currently deliver only within Lahore.')
      } else if (err instanceof ApiError && err.code === 'ADDRESS_LOCKED') {
        setError('The address can no longer be changed for this order.')
      } else {
        setError('Could not update the address. Please check the fields and try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      {back}
      <h1 className="mt-2 font-serif text-4xl">Order</h1>
      <p className="text-sm text-muted break-all">Reference: {order.order_id}</p>
      <p className="mt-2">
        <strong>{statusLabel(order.status)}</strong> · placed {formatDate(order.created_at)} ·{' '}
        {order.payment_method === 'COD'
          ? 'Cash on delivery'
          : paymentStatusLabel(order.payment_status)}
      </p>

      {order.status === 'CANCELLED' && (
        <div role="status" className="mt-4 rounded-xl border border-sand bg-cream-100 p-4">
          <p>
            This order was cancelled
            {order.cancelled_at ? ` on ${formatDate(order.cancelled_at)}` : ''}.
          </p>
          {order.cancellation_charge_paisa > 0 && (
            <p>Cancellation charge: {formatPrice(order.cancellation_charge_paisa)}.</p>
          )}
          {order.refund_due_paisa > 0 && (
            <p>Refund due to you: {formatPrice(order.refund_due_paisa)}.</p>
          )}
        </div>
      )}

      <h2 className="mt-6 text-xl font-semibold">Items</h2>
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
      <dl className="mt-4 grid grid-cols-2 gap-1 text-right">
        <dt className="text-left">Subtotal</dt>
        <dd>{formatPrice(order.subtotal_paisa)}</dd>
        <dt className="text-left">Delivery</dt>
        <dd>{formatPrice(order.delivery_fee_paisa)}</dd>
        <dt className="text-left font-semibold">Total</dt>
        <dd className="font-semibold">{formatPrice(order.total_amount_paisa)}</dd>
      </dl>

      <h2 className="mt-6 text-xl font-semibold">Delivering to</h2>
      {!editingAddress ? (
        <>
          <p>
            {order.delivery_name}, {order.delivery_house_no}
            {order.delivery_street_number ? `, ${order.delivery_street_number}` : ''},{' '}
            {order.delivery_city}, {order.delivery_postal_code}, {order.delivery_country}
          </p>
          {editable && (
            <button
              type="button"
              className="mt-2 text-terracotta underline"
              onClick={() => {
                setError(null)
                setEditingAddress(true)
              }}
            >
              Change address
            </button>
          )}
        </>
      ) : (
        <form
          onSubmit={onAddressSubmit}
          aria-label="Change delivery address"
          className="mt-2 flex flex-col gap-4 rounded-xl border border-sand bg-white p-4"
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
            maxLength={100}
            required
          />
          <Field
            id="street_number"
            name="street_number"
            label="Street number"
            defaultValue={order.delivery_street_number ?? ''}
            maxLength={100}
          />
          <Field
            id="city"
            name="city"
            label="City"
            defaultValue={order.delivery_city}
            maxLength={100}
            required
          />
          <Field
            id="province"
            name="province"
            label="Province"
            defaultValue={order.delivery_province ?? ''}
            maxLength={100}
          />
          <Field
            id="postal_code"
            name="postal_code"
            label="Postal code"
            defaultValue={order.delivery_postal_code}
            maxLength={20}
            required
          />
          <Field
            id="country"
            name="country"
            label="Country"
            defaultValue={order.delivery_country}
            maxLength={100}
            required
          />
          <FormError message={error} />
          <div className="flex gap-3">
            <button type="submit" className={buttonClass} disabled={busy}>
              {busy ? 'Saving…' : 'Save address'}
            </button>
            <button type="button" className="underline" onClick={() => setEditingAddress(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <h2 className="mt-6 text-xl font-semibold">Need to change something?</h2>
      {editable && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-sm text-muted">
            Items and quantities cannot be changed after ordering. You can cancel and order again.
          </p>
          {confirmCancel ? (
            <div className="flex gap-4">
              <button
                type="button"
                className="text-danger underline"
                disabled={busy}
                onClick={() => void onCancel()}
              >
                Yes, cancel this order
              </button>
              <button type="button" className="underline" onClick={() => setConfirmCancel(false)}>
                Keep order
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="text-left text-danger underline"
              onClick={() => {
                setError(null)
                setConfirmCancel(true)
              }}
            >
              Cancel order
            </button>
          )}
        </div>
      )}
      {order.status === 'PROCESSING' && (
        <p className="mt-2">
          Your order is being prepared. To cancel it or change the address, please contact the shop.
          A cancellation charge may apply.
        </p>
      )}
      {['SHIPPED', 'DELIVERED'].includes(order.status) && (
        <p className="mt-2">This order can no longer be changed or cancelled.</p>
      )}
      {!editingAddress && <FormError message={error} />}
    </main>
  )
}
