import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  getCategories,
  getProducts,
  type Category,
  type Page,
  type ProductSummary,
} from '../lib/api'
import { formatPrice, paisaToRupeesInput, parseRupeesToPaisa } from '../lib/money'
import { Drawer } from '../shop/Drawer'
import { CloseIcon, FilterIcon } from '../shop/icons'
import { ProductCard } from './ProductCard'
import { useWishlist } from '../wishlist/context'
import { buttonClass } from './ui'

const PAGE_SIZE = 12
const SORTS: [string, string][] = [
  ['newest', 'Newest'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['name', 'Name'],
]
const TYPES: [string, string][] = [
  ['', 'All'],
  ['READY_TO_SHIP', 'Ready to ship'],
  ['MADE_TO_ORDER', 'Made to order'],
]
const FILTER_KEYS = ['availability', 'available_only', 'sort', 'min_price', 'max_price'] as const

const pill = (active: boolean) =>
  `whitespace-nowrap rounded-full border px-4 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta ${
    active ? 'border-ink bg-ink text-cream' : 'border-sand bg-paper hover:bg-cream-200'
  }`

export default function ShopPage() {
  const [params, setParams] = useSearchParams()
  const wl = useWishlist()
  const [categories, setCategories] = useState<Category[]>([])
  // Each response is tagged with the query it answers; "loading" is derived, never set.
  const [loaded, setLoaded] = useState<{ query: string; data: Page<ProductSummary> | null } | null>(
    null,
  )
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [priceError, setPriceError] = useState<string | null>(null)

  // The URL is the single source of truth for filters, so pages are shareable and back works.
  const query = params.toString()
  const page = Number(params.get('page') ?? '1') || 1
  const search = params.get('search') ?? ''
  const categoryId = params.get('category_id') ?? ''
  const activeFilterCount = FILTER_KEYS.filter((k) => params.get(k)).length

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

  function update(changes: Record<string, string>, keepPage = false) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    if (!keepPage) next.delete('page') // any filter change returns to page 1
    setParams(next)
  }

  function clearAll() {
    const next = new URLSearchParams()
    if (categoryId) next.set('category_id', categoryId)
    if (search) next.set('search', search)
    setParams(next)
  }

  function applyDrawer(form: HTMLFormElement) {
    const fd = new FormData(form)
    const text = (k: string) => String(fd.get(k) ?? '').trim()
    const min = text('min') ? parseRupeesToPaisa(text('min')) : null
    const max = text('max') ? parseRupeesToPaisa(text('max')) : null
    if ((text('min') && min === null) || (text('max') && max === null))
      return setPriceError('Enter prices in Rs, like 500 or 1250.50.')
    if (min !== null && max !== null && min > max)
      return setPriceError('The lowest price cannot be higher than the highest.')
    setPriceError(null)
    const sort = text('sort')
    update({
      sort: sort === 'newest' ? '' : sort,
      availability: text('type'),
      available_only: fd.get('available_only') ? 'true' : '',
      min_price: min === null ? '' : String(min),
      max_price: max === null ? '' : String(max),
    })
    setDrawerOpen(false)
  }

  const current = loaded?.query === query ? loaded : null
  const result = current?.data ?? null
  const error = current !== null && current.data === null
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.page_size)) : 1
  const categoryName = categories.find((c) => c.category_id === categoryId)?.name

  const chips: { key: string; label: string; clear: Record<string, string> }[] = []
  if (search) chips.push({ key: 'search', label: `Search: ${search}`, clear: { search: '' } })
  if (params.get('availability'))
    chips.push({
      key: 'availability',
      label: TYPES.find(([v]) => v === params.get('availability'))?.[1] ?? 'Type',
      clear: { availability: '' },
    })
  if (params.get('available_only'))
    chips.push({ key: 'available_only', label: 'Available only', clear: { available_only: '' } })
  if (params.get('min_price') || params.get('max_price')) {
    const lo = params.get('min_price')
    const hi = params.get('max_price')
    chips.push({
      key: 'price',
      label: `Price: ${lo ? formatPrice(Number(lo)) : 'any'} – ${hi ? formatPrice(Number(hi)) : 'any'}`,
      clear: { min_price: '', max_price: '' },
    })
  }
  if (params.get('sort'))
    chips.push({
      key: 'sort',
      label: `Sorted: ${SORTS.find(([v]) => v === params.get('sort'))?.[1] ?? ''}`,
      clear: { sort: '' },
    })

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="font-serif text-5xl md:text-5xl">{categoryName ?? 'Shop'}</h1>

      <nav
        aria-label="Categories"
        className="-mx-4 mt-5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ul className="flex gap-2">
          <li>
            <button
              type="button"
              aria-pressed={!categoryId}
              className={pill(!categoryId)}
              onClick={() => update({ category_id: '' })}
            >
              All
            </button>
          </li>
          {categories.map((c) => (
            <li key={c.category_id}>
              <button
                type="button"
                aria-pressed={categoryId === c.category_id}
                className={pill(categoryId === c.category_id)}
                onClick={() => update({ category_id: c.category_id })}
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-4 flex flex-nowrap items-center justify-between gap-3">
        <p className="text-muted" aria-live="polite">
          {result ? `${result.total} ${result.total === 1 ? 'product' : 'products'}` : ' '}
        </p>
        <button
          type="button"
          onClick={() => {
            setPriceError(null)
            setDrawerOpen(true)
          }}
          className="inline-flex items-center gap-2 rounded-full border border-ink px-4 py-2 font-medium hover:bg-cream-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta"
        >
          <FilterIcon />
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
      </div>

      {chips.length > 0 && (
        <ul aria-label="Active filters" className="mt-3 flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                onClick={() => update(c.clear)}
                aria-label={`Remove filter: ${c.label}`}
                className="inline-flex items-center gap-2 rounded-full bg-cream-200 px-3 py-1 text-sm hover:bg-sand"
              >
                {c.label}
                <CloseIcon width={14} height={14} />
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="text-sm text-terracotta underline" onClick={clearAll}>
              Clear all
            </button>
          </li>
        </ul>
      )}

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
            <ul className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4">
              {result.items.map((p) => (
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
            <nav
              aria-label="Pagination"
              className="mt-10 flex flex-wrap items-center justify-center gap-4"
            >
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => update({ page: String(page - 1) }, true)}
                className="rounded-full border border-sand px-4 py-2 disabled:opacity-40"
              >
                Previous
              </button>
              <span>
                Page {result.page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => update({ page: String(page + 1) }, true)}
                className="rounded-full border border-sand px-4 py-2 disabled:opacity-40"
              >
                Next
              </button>
            </nav>
          </>
        )}
      </section>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Filters"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              className="text-terracotta underline"
              onClick={() => {
                clearAll()
                setDrawerOpen(false)
              }}
            >
              Clear all
            </button>
            <button type="submit" form="filters-form" className={buttonClass}>
              Show results
            </button>
          </div>
        }
      >
        <form
          id="filters-form"
          onSubmit={(e) => {
            e.preventDefault()
            applyDrawer(e.currentTarget)
          }}
          className="flex flex-col gap-6"
        >
          <fieldset>
            <legend className="mb-2 font-semibold">Sort by</legend>
            {SORTS.map(([value, label]) => (
              <label key={value} className="flex flex-nowrap items-center gap-3 py-1.5">
                <input
                  type="radio"
                  name="sort"
                  value={value}
                  defaultChecked={(params.get('sort') ?? 'newest') === value}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend className="mb-2 font-semibold">Type</legend>
            {TYPES.map(([value, label]) => (
              <label key={value} className="flex flex-nowrap items-center gap-3 py-1.5">
                <input
                  type="radio"
                  name="type"
                  value={value}
                  defaultChecked={(params.get('availability') ?? '') === value}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend className="mb-2 font-semibold">Availability</legend>
            <label className="flex flex-nowrap items-center gap-3 py-1.5">
              <input
                type="checkbox"
                name="available_only"
                defaultChecked={params.get('available_only') === 'true'}
              />
              Only show available
            </label>
          </fieldset>
          <fieldset>
            <legend className="mb-2 font-semibold">Price (Rs)</legend>
            <div className="flex flex-nowrap items-center gap-3">
              <div className="flex-1">
                <label htmlFor="price-min" className="text-sm text-bark">
                  Lowest
                </label>
                <input
                  id="price-min"
                  name="min"
                  inputMode="decimal"
                  defaultValue={
                    params.get('min_price')
                      ? paisaToRupeesInput(Number(params.get('min_price')))
                      : ''
                  }
                  className="mt-1 w-full rounded-[10px] border border-linen bg-paper px-4 py-3"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="price-max" className="text-sm text-bark">
                  Highest
                </label>
                <input
                  id="price-max"
                  name="max"
                  inputMode="decimal"
                  defaultValue={
                    params.get('max_price')
                      ? paisaToRupeesInput(Number(params.get('max_price')))
                      : ''
                  }
                  className="mt-1 w-full rounded-[10px] border border-linen bg-paper px-4 py-3"
                />
              </div>
            </div>
            {priceError && (
              <p role="alert" className="mt-2 text-danger">
                {priceError}
              </p>
            )}
          </fieldset>
        </form>
      </Drawer>
    </main>
  )
}
