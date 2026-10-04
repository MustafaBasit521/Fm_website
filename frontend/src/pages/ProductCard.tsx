import { Link } from 'react-router-dom'
import type { ProductSummary } from '../lib/api'
import { formatPrice } from '../lib/money'

export function ProductCard({ product }: { product: ProductSummary }) {
  return (
    <li className="overflow-hidden rounded-xl border border-sand bg-white">
      <Link
        to={`/shop/${product.product_id}`}
        className="block focus-visible:outline-2 focus-visible:outline-terracotta"
      >
        {product.image ? (
          <img
            src={product.image.url}
            alt={product.image.alt_text ?? product.name}
            loading="lazy"
            className="aspect-square w-full object-cover"
          />
        ) : (
          <div className="flex aspect-square items-center justify-center bg-cream-200 text-muted">
            No image
          </div>
        )}
        <div className="flex flex-col gap-1 p-3">
          <span className="text-sm text-muted">{product.category.name}</span>
          <h2 className="font-semibold">{product.name}</h2>
          <span>{formatPrice(product.price_paisa)}</span>
          <span className={product.is_available ? 'text-moss-dark' : 'text-danger'}>
            {product.is_available
              ? product.availability_type === 'MADE_TO_ORDER'
                ? 'Made to order'
                : 'In stock'
              : 'Currently unavailable'}
          </span>
        </div>
      </Link>
    </li>
  )
}
