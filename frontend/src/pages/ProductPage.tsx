import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ApiError, getProduct, type ProductDetail } from '../lib/api'
import { formatPrice } from '../lib/money'
import { AddToCartButton } from './AddToCartButton'
import { QuantityStepper } from './QuantityStepper'
import { stockLabel } from './stock'
import { ReviewsSection } from './ReviewsSection'
import { WishlistButton } from './WishlistButton'
import { WhatsAppButton } from '../shop/WhatsAppButton'
import { secondaryButtonClass, BackLink } from './ui'

export default function ProductPage() {
  const { id = '' } = useParams()
  const [loaded, setLoaded] = useState<{
    id: string
    product: ProductDetail | null
    notFound: boolean
  } | null>(null)
  const [selection, setSelection] = useState<{ id: string; index: number }>({ id, index: 0 })

  useEffect(() => {
    const controller = new AbortController()
    getProduct(id, controller.signal)
      .then((product) => setLoaded({ id, product, notFound: false }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        // 404 (hidden/unknown) and 422 (malformed id) both mean "no such product" to a shopper.
        const notFound = e instanceof ApiError && (e.status === 404 || e.status === 422)
        setLoaded({ id, product: null, notFound })
      })
    return () => controller.abort()
  }, [id])

  const current = loaded?.id === id ? loaded : null
  const product = current?.product ?? null
  const state = !current ? 'loading' : product ? 'ready' : current.notFound ? 'notfound' : 'error'
  const selected = selection.id === id ? selection.index : 0

  const back = (
    <span className="flex justify-between">
      <BackLink to="/shop">Back to shop</BackLink>
    </span>
  )

  if (state === 'loading')
    return (
      <p role="status" className="p-4">
        Loading…
      </p>
    )
  if (state === 'notfound')
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="font-serif text-5xl">Product not found</h1>
        <p className="mt-2">{back}</p>
      </main>
    )
  if (state === 'error' || !product)
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p role="alert" className="text-danger">
          Could not load this product. Please try again.
        </p>
        <p className="mt-2">{back}</p>
      </main>
    )

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      {back}
      <ProductDetailView
        key={product.product_id}
        product={product}
        selected={selected}
        onSelect={(i) => setSelection({ id, index: i })}
      />
      <ReviewsSection productId={product.product_id} />
    </main>
  )
}

function ProductDetailView({
  product,
  selected,
  onSelect,
}: {
  product: ProductDetail
  selected: number
  onSelect: (index: number) => void
}) {
  const [quantity, setQuantity] = useState(1)
  const image = product.images[selected]
  const stock = stockLabel(product)
  const total = product.price_paisa * quantity // shown for convenience; the server recalculates at checkout

  return (
    <div className="mt-6 grid gap-8 md:grid-cols-2 md:gap-12">
      <div>
        {image ? (
          <img
            src={image.url}
            alt={image.alt_text ?? product.name}
            className="aspect-[4/5] w-full rounded-[18px] bg-cream-200 object-cover"
          />
        ) : (
          <div className="flex aspect-[4/5] items-center justify-center rounded-[18px] bg-cream-200 text-bark">
            No image
          </div>
        )}
        {product.images.length > 1 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {product.images.map((img, i) => (
              <li key={img.image_id}>
                <button
                  type="button"
                  aria-label={`Show image ${i + 1}`}
                  aria-pressed={i === selected}
                  onClick={() => onSelect(i)}
                  className={`overflow-hidden rounded-[10px] border-2 focus-visible:outline-2 focus-visible:outline-dashed focus-visible:outline-bark ${i === selected ? 'border-ink' : 'border-linen'}`}
                >
                  <img src={img.url} alt="" className="h-16 w-16 object-cover" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium uppercase tracking-widest text-bark">
          {product.category.name}
        </p>
        <h1 className="font-serif text-5xl leading-tight">{product.name}</h1>
        <p className="text-2xl font-semibold">{formatPrice(product.price_paisa)}</p>
        <p className="flex items-center gap-2 text-bark">
          <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${stock.dot}`} />
          {stock.text}
        </p>
        {product.description && (
          <p className="whitespace-pre-line text-bark">{product.description}</p>
        )}

        {product.is_available && (
          <div className="flex flex-nowrap items-center justify-between gap-4">
            <span className="font-medium">Quantity</span>
            <QuantityStepper value={quantity} onChange={setQuantity} label={product.name} />
          </div>
        )}
        <AddToCartButton
          productId={product.product_id}
          productName={product.name}
          disabled={!product.is_available}
          quantity={quantity}
          label={`Add to bag · ${formatPrice(total)}`}
        />
        <WishlistButton productId={product.product_id} />
        <WhatsAppButton
          className={`${secondaryButtonClass} w-full`}
          message={`Hi! I'm interested in ${product.name} (${formatPrice(product.price_paisa)}): ${window.location.origin}/shop/${product.product_id}`}
        >
          Ask about this on WhatsApp
        </WhatsAppButton>
        <p className="text-sm text-bark">
          Cash on Delivery or secure online payment · Delivered across Lahore
        </p>
      </div>
    </div>
  )
}
