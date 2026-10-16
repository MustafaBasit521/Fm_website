import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getProducts, type ProductSummary } from '../lib/api'
import { formatPrice } from '../lib/money'
import { Drawer } from './Drawer'
import { SearchIcon } from './icons'

const MIN_CHARS = 2

/** Search as a sheet that drops from the top, with live results while you type. */
export function SearchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<{ term: string; items: ProductSummary[] | null } | null>(
    null,
  )
  const trimmed = term.trim()
  const searching = trimmed.length >= MIN_CHARS

  useEffect(() => {
    if (!searching) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      getProducts(new URLSearchParams({ search: trimmed, page_size: '6' }), controller.signal)
        .then((page) => setResults({ term: trimmed, items: page.items }))
        .catch((e: unknown) => {
          if (!(e instanceof DOMException && e.name === 'AbortError'))
            setResults({ term: trimmed, items: null })
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed, searching])

  const current = searching && results?.term === trimmed ? results : null

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    navigate(trimmed ? `/shop?search=${encodeURIComponent(trimmed)}` : '/shop')
    onClose()
  }

  return (
    <Drawer open={open} onClose={onClose} title="Search" side="top">
      <form role="search" onSubmit={onSubmit} className="mx-auto max-w-2xl">
        <label htmlFor="site-search" className="sr-only">
          Search the shop
        </label>
        <div className="flex flex-nowrap items-center gap-3 rounded-full border border-linen bg-paper px-4">
          <SearchIcon className="shrink-0 text-bark" />
          <input
            id="site-search"
            ref={input}
            data-initial-focus
            type="search"
            maxLength={100}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search flowers, keychains, bouquets…"
            className="min-w-0 flex-1 bg-transparent py-3 outline-none placeholder:text-muted"
          />
        </div>

        <div aria-live="polite" className="mt-4">
          {searching && !current && <p role="status">Searching…</p>}
          {current && !current.items && (
            <p role="alert" className="text-danger">
              Could not search right now.
            </p>
          )}
          {current?.items && current.items.length === 0 && <p>No pieces match “{trimmed}”.</p>}
          {current?.items && current.items.length > 0 && (
            <ul className="flex flex-col gap-1">
              {current.items.map((p) => (
                <li key={p.product_id}>
                  <Link
                    to={`/shop/${p.product_id}`}
                    className="flex flex-nowrap items-center gap-3 rounded-[10px] p-2 hover:bg-cream-200"
                  >
                    {p.image ? (
                      <img
                        src={p.image.url}
                        alt=""
                        className="h-14 w-12 shrink-0 rounded-lg bg-cream-200 object-cover"
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        className="h-14 w-12 shrink-0 rounded-lg bg-cream-200"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{p.name}</span>
                      <span className="block text-sm text-bark">{p.category.name}</span>
                    </span>
                    <span className="whitespace-nowrap">{formatPrice(p.price_paisa)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="submit"
          className="mt-4 rounded-full bg-ink px-6 py-2 font-semibold text-cream hover:opacity-90"
        >
          {searching ? 'See all results' : 'Browse the shop'}
        </button>
      </form>
    </Drawer>
  )
}
