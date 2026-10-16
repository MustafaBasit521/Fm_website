import { Link } from 'react-router-dom'
import type { ProductSummary } from '../lib/api'
import { formatPrice } from '../lib/money'
import { HeartIcon } from '../shop/icons'
import { stockLabel } from './stock'

export function ProductCard({
  product,
  wishlist,
}: {
  product: ProductSummary
  /** Provide this for signed-in shoppers to show a heart on the picture. */
  wishlist?: { saved: boolean; onToggle: () => void }
}) {
  const stock = stockLabel(product)
  return (
    <div className="relative">
      <Link
        to={`/shop/${product.product_id}`}
        className="group block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-terracotta"
      >
        {product.image ? (
          <img
            src={product.image.url}
            alt={product.image.alt_text ?? product.name}
            loading="lazy"
            className="aspect-[4/5] w-full rounded-2xl bg-cream-200 object-cover transition group-hover:opacity-90"
          />
        ) : (
          <div className="flex aspect-[4/5] items-center justify-center rounded-2xl bg-cream-200 text-bark">
            No image
          </div>
        )}
        <p className="mt-3 text-sm text-muted">{product.category.name}</p>
        <div className="flex flex-nowrap items-baseline justify-between gap-3">
          <h2 className="font-semibold group-hover:underline">{product.name}</h2>
          <span className="whitespace-nowrap">{formatPrice(product.price_paisa)}</span>
        </div>
        <p className="mt-1 flex items-center gap-2 text-sm text-bark">
          <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${stock.dot}`} />
          {stock.text}
        </p>
      </Link>
      {wishlist && (
        <button
          type="button"
          aria-pressed={wishlist.saved}
          aria-label={`${wishlist.saved ? 'Remove' : 'Save'} ${product.name} ${wishlist.saved ? 'from' : 'to'} wishlist`}
          onClick={wishlist.onToggle}
          className={`absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-full shadow focus-visible:outline-2 focus-visible:outline-dashed focus-visible:outline-bark ${wishlist.saved ? 'bg-terracotta text-white' : 'bg-paper text-ink hover:bg-cream-200'}`}
        >
          <HeartIcon fill={wishlist.saved ? 'currentColor' : 'none'} />
        </button>
      )}
    </div>
  )
}
