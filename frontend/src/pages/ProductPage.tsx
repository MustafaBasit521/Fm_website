import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, getProduct, type ProductDetail } from '../lib/api'
import { formatPrice } from '../lib/money'
import { WishlistButton } from './WishlistButton'

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
    <Link to="/shop" className="text-terracotta underline">
      ← Back to shop
    </Link>
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
        <h1 className="font-serif text-4xl">Product not found</h1>
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

  const image = product.images[selected]
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      {back}
      <div className="mt-4 grid gap-8 md:grid-cols-2">
        <div>
          {image ? (
            <img
              src={image.url}
              alt={image.alt_text ?? product.name}
              className="aspect-square w-full rounded-xl object-cover"
            />
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-xl bg-cream-200 text-muted">
              No image
            </div>
          )}
          {product.images.length > 1 && (
            <ul className="mt-3 flex gap-2">
              {product.images.map((img, i) => (
                <li key={img.image_id}>
                  <button
                    type="button"
                    aria-label={`Show image ${i + 1}`}
                    aria-pressed={i === selected}
                    onClick={() => setSelection({ id, index: i })}
                    className={`overflow-hidden rounded-lg border-2 ${i === selected ? 'border-terracotta' : 'border-sand'}`}
                  >
                    <img src={img.url} alt="" className="h-16 w-16 object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <span className="text-sm text-muted">{product.category.name}</span>
          <h1 className="font-serif text-4xl">{product.name}</h1>
          <p className="text-2xl">{formatPrice(product.price_paisa)}</p>
          <p className={product.is_available ? 'text-moss-dark' : 'text-danger'}>
            {product.is_available
              ? product.availability_type === 'MADE_TO_ORDER'
                ? 'Made to order'
                : 'In stock'
              : 'Currently unavailable'}
          </p>
          <WishlistButton productId={product.product_id} />
          {product.description && <p className="whitespace-pre-line">{product.description}</p>}
        </div>
      </div>
    </main>
  )
}
