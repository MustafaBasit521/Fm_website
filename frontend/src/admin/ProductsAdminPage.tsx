import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getAdminCategories, getAdminProducts } from '../lib/adminApi'
import { formatPrice } from '../lib/money'
import { inputClass } from './styles'
import { Badge, Pager, State } from './ui'
import { useLoad } from './useLoad'

export default function ProductsAdminPage() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const categories = useLoad((s) => getAdminCategories(s), [])
  const { data, loading, failed } = useLoad(
    (s) => getAdminProducts({ search, category_id: category, page }, s),
    [search, category, page],
  )

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-4xl">Products</h1>
        <Link
          to="/admin/products/new"
          className="rounded-lg bg-terracotta px-4 py-2 font-semibold text-white"
        >
          Add product
        </Link>
      </div>
      <form
        role="search"
        className="mt-4 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="p-search" className="text-sm font-medium text-bark">
            Search
          </label>
          <input
            id="p-search"
            type="search"
            maxLength={100}
            className={inputClass}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setSearch(e.currentTarget.value.trim())
                setPage(1)
              }
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="p-category" className="text-sm font-medium text-bark">
            Category
          </label>
          <select
            id="p-category"
            className={inputClass}
            value={category}
            onChange={(e) => {
              setCategory(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All categories</option>
            {categories.data?.map((c) => (
              <option key={c.category_id} value={c.category_id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </form>

      <div className="mt-6">
        <State
          loading={loading}
          failed={failed}
          empty={data?.items.length === 0}
          emptyText="No products match."
        >
          {data && (
            <>
              <p className="text-muted">{data.total} products</p>
              <ul className="mt-2 flex flex-col gap-2">
                {data.items.map((p) => (
                  <li key={p.product_id} className="rounded-xl border border-sand bg-white p-3">
                    <Link
                      to={`/admin/products/${p.product_id}`}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="flex items-center gap-3">
                        {p.image ? (
                          <img
                            src={p.image.url}
                            alt=""
                            className="h-12 w-12 rounded-lg object-cover"
                          />
                        ) : (
                          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-cream-200 text-xs text-muted">
                            No photo
                          </span>
                        )}
                        <span>
                          <strong>{p.name}</strong>
                          <span className="block text-sm text-muted">{p.category.name}</span>
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-sm">
                        {formatPrice(p.price_paisa)}
                        <span>
                          {p.availability_type === 'MADE_TO_ORDER'
                            ? `Capacity ${p.max_active_units}`
                            : `${p.stock_quantity} in stock`}
                        </span>
                        <Badge>{p.is_visible ? 'In shop' : 'Hidden'}</Badge>
                        {p.is_featured && <Badge>Featured</Badge>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Pager page={page} total={data.total} pageSize={20} onPage={setPage} />
            </>
          )}
        </State>
      </div>
    </>
  )
}
