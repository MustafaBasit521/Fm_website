import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getAdminCategories, getAdminProducts, updateProduct } from '../lib/adminApi'
import { formatPrice } from '../lib/money'
import { buttonClass } from '../pages/ui'
import { inputClass } from './styles'
import { PlusIcon } from './icons'
import { Badge, PageTitle, Pager, State, Switch, cardClass } from './ui'
import { useLoad } from './useLoad'

export default function ProductsAdminPage() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const categories = useLoad((s) => getAdminCategories(s), [])
  const [error, setError] = useState<string | null>(null)
  const { data, loading, failed, reload } = useLoad(
    (s) => getAdminProducts({ search, category_id: category, page }, s),
    [search, category, page],
  )

  return (
    <>
      <PageTitle
        eyebrow={data ? `${data.total} ${data.total === 1 ? 'product' : 'products'}` : undefined}
        title="Products"
        actions={
          <Link to="/products/new" className={buttonClass}>
            <PlusIcon /> Add product
          </Link>
        }
      />
      <form
        role="search"
        className="mt-5 grid gap-3 sm:grid-cols-2"
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
              {error && (
                <p role="alert" className="mb-3 text-danger">
                  {error}
                </p>
              )}
              <ul className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
                {data.items.map((p) => (
                  <li key={p.product_id} className={`${cardClass} flex flex-col overflow-hidden`}>
                    <Link to={`/products/${p.product_id}`} className="relative block">
                      {p.image ? (
                        <img
                          src={p.image.url}
                          alt=""
                          className="aspect-[4/3] w-full bg-cream-200 object-cover"
                        />
                      ) : (
                        <span className="flex aspect-[4/3] w-full items-center justify-center bg-cream-200 text-sm text-bark">
                          No photo
                        </span>
                      )}
                      {!p.is_visible && (
                        <span className="absolute left-2 top-2 rounded-md bg-ink px-2 py-0.5 text-xs font-semibold text-cream">
                          Hidden
                        </span>
                      )}
                    </Link>
                    <div className="flex flex-1 flex-col gap-1 p-3">
                      <div className="flex flex-nowrap justify-between gap-2">
                        <Link
                          to={`/products/${p.product_id}`}
                          className="font-semibold hover:underline"
                        >
                          {p.name}
                        </Link>
                        <span className="whitespace-nowrap text-sm">
                          {formatPrice(p.price_paisa)}
                        </span>
                      </div>
                      <span className="text-sm text-muted">{p.category.name}</span>
                      <span className="text-sm text-bark">
                        {p.availability_type === 'MADE_TO_ORDER'
                          ? `Capacity ${p.max_active_units}`
                          : `${p.stock_quantity} in stock`}
                      </span>
                      {p.is_featured && (
                        <span>
                          <Badge>Featured</Badge>
                        </span>
                      )}
                      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-sand pt-3">
                        <Switch
                          checked={p.is_visible}
                          label="In shop"
                          hiddenLabel={`${p.name} is shown in the shop`}
                          onChange={async (next) => {
                            setError(null)
                            try {
                              await updateProduct(p.product_id, { is_visible: next })
                              reload()
                            } catch {
                              setError('Could not change that product. Please try again.')
                            }
                          }}
                        />
                        <Link
                          to={`/products/${p.product_id}`}
                          className="rounded-full border border-linen px-4 py-1 text-sm hover:bg-cream-100"
                        >
                          Edit
                        </Link>
                      </div>
                    </div>
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
