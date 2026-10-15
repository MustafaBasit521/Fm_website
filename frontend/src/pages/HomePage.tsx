import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getProducts, type ProductSummary } from '../lib/api'
import { ArrowIcon } from '../shop/icons'
import { ProductCard } from './ProductCard'

const TRUST = [
  'Every piece made by hand, never mass-produced',
  'Delivered across Lahore',
  'Cash on Delivery or secure online payment',
]

type Featured = { items: ProductSummary[]; isFeatured: boolean }

async function loadFeatured(signal: AbortSignal): Promise<Featured> {
  const featured = await getProducts(
    new URLSearchParams({ featured: 'true', page_size: '4' }),
    signal,
  )
  if (featured.items.length > 0) return { items: featured.items, isFeatured: true }
  // nothing is marked as featured yet: show the newest pieces instead of an empty home page
  const newest = await getProducts(new URLSearchParams({ page_size: '4' }), signal)
  return { items: newest.items, isFeatured: false }
}

export default function HomePage() {
  const [featured, setFeatured] = useState<Featured | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    loadFeatured(controller.signal)
      .then(setFeatured)
      .catch(() => {}) // the home page works without the product row
    return () => controller.abort()
  }, [])

  return (
    <main>
      <section className="mx-auto max-w-6xl px-4 pb-10 pt-12 md:pt-20">
        <p className="text-sm font-medium uppercase tracking-widest text-bark">
          Handmade crochet studio · Lahore
        </p>
        <h1 className="mt-4 font-serif text-6xl leading-none md:text-8xl">
          Your idea,
          <br />
          <em className="text-terracotta">our crochet.</em>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-bark">
          Flowers that never wilt, little companions for your car, keychains with your name on them
          — hand-crocheted in Lahore, one piece at a time.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/shop"
            className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 font-semibold text-cream hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta"
          >
            Shop collection <ArrowIcon />
          </Link>
          <Link
            to="/custom-order"
            className="inline-flex items-center gap-2 rounded-full border border-ink px-6 py-3 font-semibold hover:bg-cream-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta"
          >
            Request a custom piece
          </Link>
        </div>
      </section>

      <section aria-label="Why shop here" className="mx-auto max-w-6xl px-4">
        <ul className="grid gap-3 border-y border-dashed border-sand py-5 text-bark md:grid-cols-3">
          {TRUST.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>

      {featured && featured.items.length > 0 && (
        <section aria-labelledby="featured-heading" className="mx-auto max-w-6xl px-4 pt-14">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium uppercase tracking-widest text-bark">
                {featured.isFeatured ? 'Featured collection' : 'New in the shop'}
              </p>
              <h2 id="featured-heading" className="font-serif text-4xl md:text-5xl">
                Fresh off the <em>hook</em>
              </h2>
            </div>
            <Link
              to="/shop"
              className="inline-flex items-center gap-2 underline underline-offset-4"
            >
              View all pieces <ArrowIcon />
            </Link>
          </div>
          <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
            {featured.items.map((p) => (
              <li key={p.product_id}>
                <ProductCard product={p} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
