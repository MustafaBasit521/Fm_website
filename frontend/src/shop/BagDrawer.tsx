import { Link } from 'react-router-dom'
import { useCart } from '../cart/context'
import { useQuote } from '../cart/useQuote'
import { formatPrice } from '../lib/money'
import { QuantityStepper } from '../pages/QuantityStepper'
import { buttonClass, secondaryButtonClass } from '../pages/ui'
import { Drawer } from './Drawer'

/** The bag as a panel that slides in from the right. The full page (/cart) stays available. */
export function BagDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { items, setQuantity, remove } = useCart()
  const { current, quote } = useQuote(items, open)

  const footer =
    items.length > 0 && quote ? (
      <div className="flex flex-col gap-3">
        <div className="flex flex-nowrap justify-between gap-4 font-semibold">
          <span>Subtotal</span>
          <span>{formatPrice(quote.subtotal_paisa)}</span>
        </div>
        <p className="text-sm text-bark">Delivery is added at checkout.</p>
        {quote.can_checkout ? (
          <Link to="/checkout" className={`${buttonClass} w-full`}>
            Checkout
          </Link>
        ) : (
          <p className="text-bark">Fix the items above to continue to checkout.</p>
        )}
        <Link to="/cart" className={`${secondaryButtonClass} w-full`}>
          View full bag
        </Link>
      </div>
    ) : undefined

  return (
    <Drawer open={open} onClose={onClose} title="Your bag" side="right" footer={footer}>
      {items.length === 0 && (
        <div className="py-8 text-center">
          <p className="font-serif text-3xl">Your bag is empty</p>
          <p className="mt-2 text-bark">The newest pieces are waiting in the shop.</p>
          <p className="mt-5">
            <Link to="/shop" className={secondaryButtonClass}>
              Browse the collection
            </Link>
          </p>
        </div>
      )}
      {items.length > 0 && !current && <p role="status">Loading…</p>}
      {items.length > 0 && current && !quote && (
        <p role="alert" className="text-danger">
          Could not load your bag. Please try again.
        </p>
      )}
      {quote && (
        <ul className="flex flex-col gap-4">
          {quote.lines.map((line) => {
            const name = line.name ?? 'Unavailable product'
            return (
              <li key={line.product_id} className="flex flex-nowrap gap-3">
                {line.image ? (
                  <img
                    src={line.image.url}
                    alt=""
                    className="h-20 w-16 shrink-0 rounded-[10px] bg-cream-200 object-cover"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="h-20 w-16 shrink-0 rounded-[10px] bg-cream-200"
                  />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-nowrap justify-between gap-2">
                    <span className="font-semibold">{name}</span>
                    {line.line_total_paisa !== null && (
                      <span className="whitespace-nowrap">
                        {formatPrice(line.line_total_paisa)}
                      </span>
                    )}
                  </div>
                  {line.issue && (
                    <p role="alert" className="text-sm text-danger">
                      {line.issue === 'EXCEEDS_AVAILABLE'
                        ? `Only ${line.max_quantity} available.`
                        : 'Not available right now.'}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {line.issue !== 'NOT_FOUND' && (
                      <QuantityStepper
                        value={line.quantity}
                        label={name}
                        onChange={(n) => setQuantity(line.product_id, n)}
                      />
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
      )}
    </Drawer>
  )
}
