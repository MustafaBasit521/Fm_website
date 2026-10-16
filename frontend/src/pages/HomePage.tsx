import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getGallery, getProducts, type GalleryImage, type ProductSummary } from '../lib/api'
import { ArrowIcon } from '../shop/icons'
import { ProductCard } from './ProductCard'
import { useWishlist } from '../wishlist/context'
import { primaryButtonClass, secondaryButtonClass } from './ui'

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
  const [gallery, setGallery] = useState<GalleryImage[]>([])
  const wl = useWishlist()

  useEffect(() => {
    const controller = new AbortController()
    getGallery('', 1, controller.signal)
      .then((page) => setGallery(page.items.slice(0, 6)))
      .catch(() => {}) // the home page works without the gallery row
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    loadFeatured(controller.signal)
      .then(setFeatured)
      .catch(() => {}) // the home page works without the product row
    return () => controller.abort()
  }, [])

  // real photos of the featured pieces fill the hero; with no photos yet the text stands alone
  const heroPictures = (featured?.items ?? []).filter((p) => p.image).slice(0, 3)

  return (
    <main>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-10 pt-12 md:grid-cols-[1.1fr_1fr] md:pt-20">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-bark">
            Handmade crochet studio · Lahore
          </p>
          <h1 className="mt-4 font-serif text-6xl leading-none md:text-8xl">
            Your idea,
            <br />
            <em className="text-terracotta">our crochet.</em>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-bark">
            Flowers that never wilt, little companions for your car, keychains with your name on
            them — hand-crocheted in Lahore, one piece at a time.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/shop" className={primaryButtonClass}>
              Shop collection <ArrowIcon />
            </Link>
            <Link to="/custom-order" className={secondaryButtonClass}>
              Request a custom piece
            </Link>
          </div>
        </div>
        {heroPictures.length > 0 && (
          <ul aria-label="From the shop" className="grid grid-cols-2 gap-3">
            {heroPictures.map((p, i) => (
              <li key={p.product_id} className={i === 0 ? 'row-span-2' : ''}>
                <Link
                  to={`/shop/${p.product_id}`}
                  aria-label={p.name}
                  className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta"
                >
                  <img
                    src={p.image!.url}
                    alt={p.image!.alt_text ?? p.name}
                    className={`w-full rounded-[18px] bg-cream-200 object-cover ${i === 0 ? 'h-full min-h-72' : 'aspect-square'}`}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
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
                <ProductCard
                  product={p}
                  wishlist={
                    wl.enabled
                      ? {
                          saved: wl.ids!.has(p.product_id),
                          onToggle: () => void wl.toggle(p.product_id),
                        }
                      : undefined
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {gallery.length > 0 && (
        <section aria-labelledby="gallery-heading" className="mx-auto max-w-6xl px-4 pt-16">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium uppercase tracking-widest text-bark">Gallery</p>
              <h2 id="gallery-heading" className="font-serif text-4xl md:text-5xl">
                From the <em>studio table</em>
              </h2>
            </div>
            <Link to="/gallery" className={secondaryButtonClass}>
              Open the gallery <ArrowIcon />
            </Link>
          </div>
          <ul className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
            {gallery.map((img) => (
              <li key={img.gallery_image_id}>
                <img
                  src={img.url}
                  alt={img.title ?? 'Gallery photo'}
                  loading="lazy"
                  className="aspect-square w-full rounded-[18px] bg-cream-200 object-cover"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="custom-heading" className="mx-auto max-w-6xl px-4 pt-16">
        <div className="flex flex-wrap items-center justify-between gap-6 rounded-[18px] bg-ink p-6 text-cream md:p-10">
          <div className="max-w-xl">
            <h2 id="custom-heading" className="font-serif text-4xl md:text-5xl">
              Don&apos;t see it? <em>Customize anything.</em>
            </h2>
            <p className="mt-2 text-linen">
              Your colours, your name, your idea — tell us and we&apos;ll stitch it.
            </p>
          </div>
          <Link
            to="/custom-order"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-paper px-6 py-2 font-semibold text-ink hover:opacity-90"
          >
            Start a custom order <ArrowIcon />
          </Link>
        </div>
      </section>
    </main>
  )
}
