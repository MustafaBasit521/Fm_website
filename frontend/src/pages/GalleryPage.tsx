import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Link to="/" className="text-terracotta underline">
        ← Home
      </Link>
      <h1 className="mt-2 font-serif text-4xl">Gallery</h1>

      <div className="mt-4 flex flex-col gap-1 sm:w-64">
        <label htmlFor="gallery-type" className="text-sm font-medium text-bark">
          Show
        </label>
        <select
          id="gallery-type"
          value={type}
          onChange={(e) => {
            setType(e.target.value as GalleryImageType | '')
            setPage(1)
          }}
          className="rounded-lg border border-sand bg-white px-3 py-2"
        >
          {TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

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
                  <figure className="overflow-hidden rounded-xl border border-sand bg-white">
                    <img
                      src={img.url}
                      alt={img.title ?? 'Gallery photo'}
                      loading="lazy"
                      className="aspect-square w-full object-cover"
                    />
                    {(img.title || img.description) && (
                      <figcaption className="p-3">
                        {img.title && <p className="font-semibold">{img.title}</p>}
                        {img.description && <p className="text-sm text-muted">{img.description}</p>}
                      </figcaption>
                    )}
                  </figure>
                </li>
              ))}
            </ul>
            {totalPages > 1 && (
              <nav aria-label="Pagination" className="mt-6 flex items-center gap-4">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="rounded-lg border border-sand px-3 py-1 disabled:opacity-40"
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
                  className="rounded-lg border border-sand px-3 py-1 disabled:opacity-40"
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
