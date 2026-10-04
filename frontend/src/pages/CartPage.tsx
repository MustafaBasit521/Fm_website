import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCart } from '../cart/context'
import { getQuote, type Quote, type QuoteLine } from '../lib/api'
import { MAX_LINE_QUANTITY } from '../lib/cart'
import { formatPrice } from '../lib/money'
import { buttonClass } from './ui'

function issueText(line: QuoteLine): string | null {
  if (line.issue === 'NOT_FOUND') return 'This product is no longer available.'
  if (line.issue === 'UNAVAILABLE') return 'Currently unavailable.'
  if (line.issue === 'EXCEEDS_AVAILABLE') return `Only ${line.max_quantity} available.`
  return null
}

export default function CartPage() {
  const { items, setQuantity, remove } = useCart()
  // The quote (prices, availability, totals) always comes from the backend; the cart only holds
  // ids and quantities. Results are tagged with the cart they answer so loading is derived.
  const key = JSON.stringify(items)
  const [loaded, setLoaded] = useState<{ key: string; quote: Quote | null } | null>(null)

  useEffect(() => {
    if (items.length === 0) return
    const controller = new AbortController()
    getQuote(items, controller.signal)
      .then((quote) => setLoaded({ key, quote }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setLoaded({ key, quote: null })
      })
    return () => controller.abort()
    // `key` captures `items`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (items.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="font-serif text-4xl">Your cart</h1>
        <p className="mt-4">Your cart is empty.</p>
        <p className="mt-2">
          <Link to="/shop" className="text-terracotta underline">
            Browse the shop
          </Link>
        </p>
      </main>
    )
  }

  const current = loaded?.key === key ? loaded : null
  const quote = current?.quote ?? null

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link to="/shop" className="text-terracotta underline">
        ← Continue shopping
      </Link>
      <h1 className="mt-2 font-serif text-4xl">Your cart</h1>

      {!current && (
        <p role="status" className="mt-6">
          Loading…
        </p>
      )}
      {current && !quote && (
        <p role="alert" className="mt-6 text-danger">
          Could not load your cart. Please try again.
        </p>
      )}

      {quote && (
        <>
          <ul className="mt-6 flex flex-col gap-4">
            {quote.lines.map((line) => {
              const problem = issueText(line)
              return (
                <li
                  key={line.product_id}
                  className="flex flex-col gap-2 rounded-xl border border-sand bg-white p-4"
                >
                  <div className="flex justify-between gap-4">
                    <span className="font-semibold">{line.name ?? 'Unavailable product'}</span>
                    {line.line_total_paisa !== null && (
                      <span>{formatPrice(line.line_total_paisa)}</span>
                    )}
                  </div>
                  {line.unit_price_paisa !== null && (
                    <span className="text-sm text-muted">
                      {formatPrice(line.unit_price_paisa)} each
                    </span>
                  )}
                  {problem && (
                    <p role="alert" className="text-danger">
                      {problem}
                    </p>
                  )}
                  <div className="flex items-center gap-4">
                    {line.issue !== 'NOT_FOUND' && (
                      <label className="flex items-center gap-2">
                        Quantity
                        <input
                          type="number"
                          min={1}
                          max={MAX_LINE_QUANTITY}
                          value={line.quantity}
                          aria-label={`Quantity for ${line.name ?? 'product'}`}
                          onChange={(e) => {
                            const n = Number(e.target.value)
                            if (Number.isFinite(n)) setQuantity(line.product_id, n)
                          }}
                          className="w-20 rounded-lg border border-sand px-2 py-1"
                        />
                      </label>
                    )}
                    {line.issue === 'EXCEEDS_AVAILABLE' && line.max_quantity && (
                      <button
                        type="button"
                        className="text-terracotta underline"
                        onClick={() => setQuantity(line.product_id, line.max_quantity!)}
                      >
                        Reduce to {line.max_quantity}
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-danger underline"
                      aria-label={`Remove ${line.name ?? 'product'} from cart`}
                      onClick={() => remove(line.product_id)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>

          <dl className="mt-6 grid grid-cols-2 gap-1 text-right">
            <dt className="text-left">Subtotal</dt>
            <dd>{formatPrice(quote.subtotal_paisa)}</dd>
            <dt className="text-left">Delivery (Lahore)</dt>
            <dd>{formatPrice(quote.delivery_fee_paisa)}</dd>
            <dt className="text-left font-semibold">Total</dt>
            <dd className="font-semibold">{formatPrice(quote.total_paisa)}</dd>
          </dl>

          {quote.can_checkout ? (
            <Link to="/checkout" className={`${buttonClass} mt-6 inline-block`}>
              Proceed to checkout
            </Link>
          ) : (
            <p className="mt-6 text-muted">Fix the items above to continue to checkout.</p>
          )}
        </>
      )}
    </main>
  )
}
