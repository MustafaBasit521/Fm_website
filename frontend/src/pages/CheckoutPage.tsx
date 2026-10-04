import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { useCart } from '../cart/context'
import {
  ApiError,
  createOrder,
  getAddresses,
  getMe,
  getQuote,
  type Address,
  type PaymentMethod,
  type Quote,
} from '../lib/api'
import { formatPrice } from '../lib/money'
import { saveLastOrder } from '../lib/lastOrder'
import { buttonClass, Field, FormError } from './ui'

const NEW_ADDRESS = 'new'

export default function CheckoutPage() {
  const { session } = useAuth()
  const { items, clear } = useCart()
  const navigate = useNavigate()
  const key = JSON.stringify(items)

  const [loaded, setLoaded] = useState<{ key: string; quote: Quote | null } | null>(null)
  const [profile, setProfile] = useState<{
    name: string
    email: string
    phone: string | null
  } | null>(null)
  const [addresses, setAddresses] = useState<Address[]>([])
  const [addressChoice, setAddressChoice] = useState<string>(NEW_ADDRESS)
  const [method, setMethod] = useState<PaymentMethod>('COD')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [quoteOverride, setQuoteOverride] = useState<{ key: string; total: number } | null>(null)

  useEffect(() => {
    if (items.length === 0) return
    const controller = new AbortController()
    getQuote(items, controller.signal)
      .then((quote) => setLoaded({ key, quote }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setLoaded({ key, quote: null })
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const signedIn = session !== null
  useEffect(() => {
    if (!signedIn) return
    const controller = new AbortController()
    getMe(controller.signal)
      .then((c) => setProfile({ name: c.name, email: c.email, phone: c.phone }))
      .catch(() => {})
    getAddresses(controller.signal)
      .then((list) => {
        setAddresses(list)
        if (list.length > 0) setAddressChoice(list[0].address_id)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [signedIn])

  if (items.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="font-serif text-4xl">Checkout</h1>
        <p className="mt-4">
          Your cart is empty.{' '}
          <Link to="/shop" className="text-terracotta underline">
            Browse the shop
          </Link>
        </p>
      </main>
    )
  }

  const current = loaded?.key === key ? loaded : null
  const quote = current?.quote ?? null
  const total = quoteOverride?.key === key ? quoteOverride.total : quote?.total_paisa

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!quote) return
    const form = new FormData(e.currentTarget)
    const text = (k: string) => String(form.get(k) ?? '').trim()
    const optional = (k: string) => text(k) || null

    const useSaved = signedIn && addressChoice !== NEW_ADDRESS
    setBusy(true)
    setError(null)
    try {
      const order = await createOrder({
        items,
        contact: { name: text('name'), email: text('email'), phone: optional('phone') },
        delivery: {
          recipient_name: optional('recipient_name'),
          ...(useSaved
            ? { address_id: addressChoice }
            : {
                address: {
                  house_no: text('house_no'),
                  street_number: optional('street_number'),
                  city: text('city'),
                  province: optional('province'),
                  postal_code: text('postal_code'),
                  country: text('country'),
                },
              }),
        },
        payment_method: method,
        expected_total_paisa: total,
      })
      saveLastOrder(order)
      clear()
      navigate('/order-confirmation', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        const detail = err.detail as { total_paisa?: number } | undefined
        if (err.code === 'TOTAL_CHANGED' && typeof detail?.total_paisa === 'number') {
          setQuoteOverride({ key, total: detail.total_paisa })
          setError(
            `The total has changed to ${formatPrice(detail.total_paisa)}. Please review and place the order again.`,
          )
        } else if (err.code === 'CHECKOUT_INVALID') {
          setError('Some items are no longer available in that quantity. Please review your cart.')
        } else if (err.code === 'NOT_DELIVERABLE') {
          setError('We currently deliver only within Lahore.')
        } else if (err.status === 422 || err.status === 404) {
          setError('Please check your details and try again.')
        } else {
          setError('Could not place your order. Please try again.')
        }
      } else {
        setError('Could not place your order. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/cart" className="text-terracotta underline">
        ← Back to cart
      </Link>
      <h1 className="mt-2 font-serif text-4xl">Checkout</h1>

      {!current && (
        <p role="status" className="mt-6">
          Loading…
        </p>
      )}
      {current && !quote && (
        <p role="alert" className="mt-6 text-danger">
          Could not load your order. Please try again.
        </p>
      )}
      {quote && !quote.can_checkout && (
        <p role="alert" className="mt-6 text-danger">
          Some items in your cart are unavailable.{' '}
          <Link to="/cart" className="underline">
            Review your cart
          </Link>
        </p>
      )}

      {quote && quote.can_checkout && (
        // key resets the uncontrolled fields when the profile arrives
        <form
          key={profile ? 'with-profile' : 'no-profile'}
          onSubmit={onSubmit}
          className="mt-6 flex flex-col gap-6"
        >
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-2 text-xl font-semibold">Contact</legend>
            <Field
              id="name"
              name="name"
              label="Full name"
              defaultValue={profile?.name ?? ''}
              maxLength={100}
              required
            />
            <Field
              id="email"
              name="email"
              label="Email"
              type="email"
              defaultValue={profile?.email ?? ''}
              required
            />
            <Field
              id="phone"
              name="phone"
              label="Phone"
              type="tel"
              defaultValue={profile?.phone ?? ''}
              maxLength={20}
            />
          </fieldset>

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-2 text-xl font-semibold">Delivery (Lahore only)</legend>
            <Field
              id="recipient_name"
              name="recipient_name"
              label="Recipient name (if different)"
              maxLength={100}
            />
            {addresses.length > 0 && (
              <div className="flex flex-col gap-2" role="radiogroup" aria-label="Saved addresses">
                {addresses.map((a) => (
                  <label key={a.address_id} className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="address_choice"
                      checked={addressChoice === a.address_id}
                      onChange={() => setAddressChoice(a.address_id)}
                    />
                    <span>
                      {[a.label, a.house_no, a.street_number, a.city, a.postal_code]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </label>
                ))}
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="address_choice"
                    checked={addressChoice === NEW_ADDRESS}
                    onChange={() => setAddressChoice(NEW_ADDRESS)}
                  />
                  Use a different address
                </label>
              </div>
            )}
            {addressChoice === NEW_ADDRESS && (
              <>
                <Field
                  id="house_no"
                  name="house_no"
                  label="House number"
                  maxLength={100}
                  required
                />
                <Field
                  id="street_number"
                  name="street_number"
                  label="Street number"
                  maxLength={100}
                />
                <Field
                  id="city"
                  name="city"
                  label="City"
                  defaultValue="Lahore"
                  maxLength={100}
                  required
                />
                <Field
                  id="province"
                  name="province"
                  label="Province"
                  defaultValue="Punjab"
                  maxLength={100}
                />
                <Field
                  id="postal_code"
                  name="postal_code"
                  label="Postal code"
                  maxLength={20}
                  required
                />
                <Field
                  id="country"
                  name="country"
                  label="Country"
                  defaultValue="Pakistan"
                  maxLength={100}
                  required
                />
              </>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-xl font-semibold">Payment</legend>
            {quote.payment_methods.map((m) => (
              <label key={m} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="payment_method"
                  checked={method === m}
                  onChange={() => setMethod(m)}
                />
                {m === 'COD' ? 'Cash on delivery' : 'Pay online'}
              </label>
            ))}
          </fieldset>

          <dl className="grid grid-cols-2 gap-1 text-right">
            <dt className="text-left">Subtotal</dt>
            <dd>{formatPrice(quote.subtotal_paisa)}</dd>
            <dt className="text-left">Delivery</dt>
            <dd>{formatPrice(quote.delivery_fee_paisa)}</dd>
            <dt className="text-left font-semibold">Total</dt>
            <dd className="font-semibold">{formatPrice(total ?? quote.total_paisa)}</dd>
          </dl>

          <FormError message={error} />
          <button type="submit" className={buttonClass} disabled={busy}>
            {busy ? 'Placing order…' : 'Place order'}
          </button>
        </form>
      )}
    </main>
  )
}
