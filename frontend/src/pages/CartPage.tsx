import { Link } from 'react-router-dom'
import { useCart } from '../cart/context'
import { useQuote } from '../cart/useQuote'
import type { QuoteLine } from '../lib/api'
import { formatPrice } from '../lib/money'
import { QuantityStepper } from './QuantityStepper'
import { buttonClass, secondaryButtonClass } from './ui'

function issueText(line: QuoteLine): string | null {
  if (line.issue === 'NOT_FOUND') return 'This product is no longer available.'
  if (line.issue === 'UNAVAILABLE') return 'Currently unavailable.'
  if (line.issue === 'EXCEEDS_AVAILABLE') return `Only ${line.max_quantity} available.`
  return null
}

export default function CartPage() {
  const { items, setQuantity, remove } = useCart()
  const { current, quote } = useQuote(items)

  if (items.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 text-center">
        <h1 className="font-serif text-5xl">Your bag is empty</h1>
        <p className="mt-3 text-bark">
          Nothing here yet — the newest pieces are waiting in the shop.
        </p>
        <p className="mt-6">
          <Link to="/shop" className={secondaryButtonClass}>
            Browse the collection
          </Link>
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="font-serif text-5xl">Your bag</h1>

      {!current && (
        <p role="status" className="mt-6">
          Loading…
        </p>
      )}
      {current && !quote && (
        <p role="alert" className="mt-6 text-danger">
          Could not load your bag. Please try again.
        </p>
      )}

      {quote && (
        <div className="mt-6 grid items-start gap-8 md:grid-cols-[minmax(0,1fr)_20rem]">
          <ul className="flex flex-col gap-4">
            {quote.lines.map((line) => {
              const problem = issueText(line)
              const name = line.name ?? 'product'
              return (
                <li
                  key={line.product_id}
                  className="flex flex-nowrap gap-4 rounded-[18px] border border-sand bg-paper p-4"
                >
                  {line.image ? (
                    <img
                      src={line.image.url}
                      alt=""
                      className="h-24 w-20 shrink-0 rounded-[10px] bg-cream-200 object-cover"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="h-24 w-20 shrink-0 rounded-[10px] bg-cream-200"
                    />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex flex-nowrap justify-between gap-3">
                      <span className="font-semibold">{line.name ?? 'Unavailable product'}</span>
                      {line.line_total_paisa !== null && (
                        <span className="whitespace-nowrap font-semibold">
                          {formatPrice(line.line_total_paisa)}
                        </span>
                      )}
                    </div>
                    {line.unit_price_paisa !== null && (
                      <span className="text-sm text-muted">
                        {formatPrice(line.unit_price_paisa)} each
                      </span>
                    )}
                    {problem && (
                      <p
                        role="alert"
                        className="rounded-[10px] bg-accent-tint px-3 py-2 text-danger"
                      >
                        {problem}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      {line.issue !== 'NOT_FOUND' && (
                        <QuantityStepper
                          value={line.quantity}
                          label={name}
                          onChange={(n) => setQuantity(line.product_id, n)}
                        />
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
                        className="text-sm text-bark underline"
                        aria-label={`Remove ${name} from bag`}
                        onClick={() => remove(line.product_id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>

          <aside
            aria-label="Order summary"
            className="rounded-[18px] border border-sand bg-paper p-5 md:sticky md:top-24"
          >
            <dl className="flex flex-col gap-2">
              <div className="flex flex-nowrap justify-between gap-4">
                <dt>Subtotal</dt>
                <dd>{formatPrice(quote.subtotal_paisa)}</dd>
              </div>
              <div className="flex flex-nowrap justify-between gap-4">
                <dt>Delivery in Lahore</dt>
                <dd>{formatPrice(quote.delivery_fee_paisa)}</dd>
              </div>
              <div className="flex flex-nowrap justify-between gap-4 border-t border-sand pt-3 text-lg font-semibold">
                <dt>Total</dt>
                <dd>{formatPrice(quote.total_paisa)}</dd>
              </div>
            </dl>
            {quote.can_checkout ? (
              <Link to="/checkout" className={`${buttonClass} mt-5 w-full`}>
                Proceed to checkout
              </Link>
            ) : (
              <p className="mt-5 text-bark">Fix the items on the left to continue to checkout.</p>
            )}
            <p className="mt-3 text-sm text-bark">
              Cash on Delivery or online payment · Lahore only
            </p>
            <p className="mt-3">
              <Link to="/shop" className="text-sm text-terracotta underline">
                Continue shopping
              </Link>
            </p>
          </aside>
        </div>
      )}
    </main>
  )
}
