import { useEffect, useState } from 'react'
import { PageHeader } from './PageHeader'
import { getGallery, type GalleryImage, type GalleryImageType, type Page } from '../lib/api'

const TYPES: [GalleryImageType | '', string][] = [
  ['', 'All'],
  ['SHOP', 'In the shop'],
  ['DESIGN', 'Designs'],
  ['BEHIND_THE_SCENES', 'Behind the scenes'],
  ['CUSTOMER_PHOTO', 'Customer photos'],
  ['OTHER', 'Other'],
]

export default function GalleryPage() {
  const [type, setType] = useState<GalleryImageType | ''>('')
  const [page, setPage] = useState(1)
  const key = `${type}:${page}`
  const [loaded, setLoaded] = useState<{ key: string; data: Page<GalleryImage> | null } | null>(
    null,
  )

  useEffect(() => {
    const controller = new AbortController()
    getGallery(type, page, controller.signal)
      .then((data) => setLoaded({ key, data }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setLoaded({ key, data: null })
      })
    return () => controller.abort()
  }, [type, page, key])

  const current = loaded?.key === key ? loaded : null
  const data = current?.data ?? null
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        eyebrow="Gallery"
        title={
          <>
            From the <em>studio table</em>
          </>
        }
      >
        Pieces in the shop, designs, and the making of them.
      </PageHeader>

      <nav
        aria-label="Gallery types"
        className="-mx-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ul className="flex gap-2">
          {TYPES.map(([value, label]) => (
            <li key={value || 'all'}>
              <button
                type="button"
                aria-pressed={type === value}
                onClick={() => {
                  setType(value)
                  setPage(1)
                }}
                className={`whitespace-nowrap rounded-full border px-4 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dashed focus-visible:outline-bark ${type === value ? 'border-ink bg-ink text-cream' : 'border-linen bg-paper hover:bg-cream-200'}`}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <section className="mt-6" aria-live="polite">
        {!current && <p role="status">Loading…</p>}
        {current && !data && (
          <p role="alert" className="text-danger">
            Could not load the gallery.
          </p>
        )}
        {data && data.items.length === 0 && <p>Nothing here yet.</p>}
        {data && data.items.length > 0 && (
          <>
            <ul className="grid grid-cols-2 gap-4 md:grid-cols-3">
              {data.items.map((img) => (
                <li key={img.gallery_image_id}>
                  <figure>
                    <img
                      src={img.url}
                      alt={img.title ?? 'Gallery photo'}
                      loading="lazy"
                      className="aspect-square w-full rounded-[18px] bg-cream-200 object-cover"
                    />
                    {(img.title || img.description) && (
                      <figcaption className="mt-2">
                        {img.title && <p className="font-semibold">{img.title}</p>}
                        {img.description && <p className="text-sm text-bark">{img.description}</p>}
                      </figcaption>
                    )}
                  </figure>
                </li>
              ))}
            </ul>
            {totalPages > 1 && (
              <nav
                aria-label="Pagination"
                className="mt-8 flex flex-wrap items-center justify-center gap-4"
              >
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="min-h-11 rounded-full border border-linen px-5 py-2 disabled:opacity-40"
                >
                  Previous
                </button>
                <span>
                  Page {data.page} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                  className="min-h-11 rounded-full border border-linen px-5 py-2 disabled:opacity-40"
                >
                  Next
                </button>
              </nav>
            )}
          </>
        )}
      </section>
    </main>
  )
}
