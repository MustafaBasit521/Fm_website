import type { Order } from '../lib/api'
import { formatPrice } from '../lib/money'

/** The items and totals of an order, as one card (used by the confirmation and order pages). */
export function OrderBreakdown({
  order,
}: {
  order: Pick<Order, 'items' | 'subtotal_paisa' | 'delivery_fee_paisa' | 'total_amount_paisa'>
}) {
  return (
    <section aria-label="Order items" className="rounded-[18px] border border-sand bg-paper p-5">
      <ul className="flex flex-col gap-2">
        {order.items.map((i) => (
          <li
            key={`${i.product_name_snapshot}-${i.unit_price_at_purchase_paisa}`}
            className="flex flex-nowrap justify-between gap-4"
          >
            <span>
              {i.quantity} × {i.product_name_snapshot}
            </span>
            <span className="whitespace-nowrap">
              {formatPrice(i.quantity * i.unit_price_at_purchase_paisa)}
            </span>
          </li>
        ))}
      </ul>
      <dl className="mt-4 flex flex-col gap-2 border-t border-sand pt-4">
        <div className="flex flex-nowrap justify-between gap-4">
          <dt>Subtotal</dt>
          <dd>{formatPrice(order.subtotal_paisa)}</dd>
        </div>
        <div className="flex flex-nowrap justify-between gap-4">
          <dt>Delivery</dt>
          <dd>{formatPrice(order.delivery_fee_paisa)}</dd>
        </div>
        <div className="flex flex-nowrap justify-between gap-4 text-lg font-semibold">
          <dt>Total</dt>
          <dd>{formatPrice(order.total_amount_paisa)}</dd>
        </div>
      </dl>
    </section>
  )
}
