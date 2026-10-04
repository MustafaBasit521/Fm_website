import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  getCategories,
  getProducts,
  type Category,
  type Page,
  type ProductSummary,
} from '../lib/api'
import { ProductCard } from './ProductCard'

const PAGE_SIZE = 12

export default function ShopPage() {
  const [params, setParams] = useSearchParams()
  const [categories, setCategories] = useState<Category[]>([])
  // Each response is tagged with the query it answers; "loading" is derived, never set.
  const [loaded, setLoaded] = useState<{
    query: string
    data: Page<ProductSummary> | null
  } | null>(null)

  // The URL is the single source of truth for filters, so pages are shareable and back works.
  const query = params.toString()
  const page = Number(params.get('page') ?? '1') || 1

  useEffect(() => {
    const controller = new AbortController()
    getCategories(controller.signal)
      .then(setCategories)
      .catch(() => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const q = new URLSearchParams(query)
    q.set('page_size', String(PAGE_SIZE))
    getProducts(q, controller.signal)
      .then((data) => setLoaded({ query, data }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError'))
          setLoaded({ query, data: null })
      })
    return () => controller.abort()
  }, [query])

  function update(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('page') // any filter change returns to page 1
    setParams(next)
  }

  function goToPage(p: number) {
    const next = new URLSearchParams(params)
    next.set('page', String(p))
    setParams(next)
  }

  const current = loaded?.query === query ? loaded : null
  const result = current?.data ?? null
  const error = current !== null && current.data === null
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.page_size)) : 1

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Link to="/" className="text-terracotta underline">
        ← Home
      </Link>
      <h1 className="mt-2 font-serif text-4xl">Shop</h1>

      <form
        role="search"
        className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="search" className="text-sm font-medium text-bark">
            Search
          </label>
          <input
            id="search"
            type="search"
            maxLength={100}
            defaultValue={params.get('search') ?? ''}
            onKeyDown={(e) => {
              if (e.key === 'Enter') update('search', e.currentTarget.value.trim())
            }}
            onBlur={(e) => {
              if (e.currentTarget.value.trim() !== (params.get('search') ?? ''))
                update('search', e.currentTarget.value.trim())
            }}
            className="rounded-lg border border-sand bg-white px-3 py-2"
          />
        </div>
        <Select
          id="category"
          label="Category"
          value={params.get('category_id') ?? ''}
          onChange={(v) => update('category_id', v)}
          options={[
            ['', 'All categories'],
            ...categories.map((c): [string, string] => [c.category_id, c.name]),
          ]}
        />
        <Select
          id="availability"
          label="Type"
          value={params.get('availability') ?? ''}
          onChange={(v) => update('availability', v)}
          options={[
            ['', 'All'],
            ['READY_TO_SHIP', 'Ready to ship'],
            ['MADE_TO_ORDER', 'Made to order'],
          ]}
        />
        <Select
          id="sort"
          label="Sort by"
          value={params.get('sort') ?? 'newest'}
          onChange={(v) => update('sort', v === 'newest' ? '' : v)}
          options={[
            ['newest', 'Newest'],
            ['price_asc', 'Price: low to high'],
            ['price_desc', 'Price: high to low'],
            ['name', 'Name'],
          ]}
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={params.get('available_only') === 'true'}
            onChange={(e) => update('available_only', e.target.checked ? 'true' : '')}
          />
          Only show available
        </label>
      </form>

      <section className="mt-6" aria-live="polite">
        {error && (
          <p role="alert" className="text-danger">
            Could not load products. Please try again.
          </p>
        )}
        {!error && !result && <p role="status">Loading…</p>}
        {result && result.items.length === 0 && <p>No products match your search.</p>}
        {result && result.items.length > 0 && (
          <>
            <p className="text-muted">{result.total} products</p>
            <ul className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {result.items.map((p) => (
                <ProductCard key={p.product_id} product={p} />
              ))}
            </ul>
            <nav aria-label="Pagination" className="mt-6 flex items-center gap-4">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
                className="rounded-lg border border-sand px-3 py-1 disabled:opacity-40"
              >
                Previous
              </button>
              <span>
                Page {result.page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
                className="rounded-lg border border-sand px-3 py-1 disabled:opacity-40"
              >
                Next
              </button>
            </nav>
          </>
        )}
      </section>
    </main>
  )
}

function Select({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  options: [string, string][]
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-bark">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-sand bg-white px-3 py-2"
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </div>
  )
}
