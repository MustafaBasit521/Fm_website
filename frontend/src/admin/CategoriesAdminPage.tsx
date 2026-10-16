import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  createCategory,
  deleteCategory,
  getAdminCategories,
  getAdminProducts,
  renameCategory,
} from '../lib/adminApi'
import { ApiError } from '../lib/api'
import { formatPrice } from '../lib/money'
import { buttonClass, FormError } from '../pages/ui'
import { inputClass } from './styles'
import { ChevronRightIcon } from './icons'
import { cardClass, ConfirmButton, PageTitle, State } from './ui'
import { useLoad } from './useLoad'

/** The products of one category, with pictures (loaded when the category is opened). */
function CategoryProducts({ categoryId, count }: { categoryId: string; count: number }) {
  const { data, loading, failed } = useLoad(
    (s) => getAdminProducts({ category_id: categoryId, page: 1 }, s),
    [categoryId],
  )
  if (loading) return <p role="status">Loading…</p>
  if (failed || !data)
    return (
      <p role="alert" className="text-danger">
        Could not load the products.
      </p>
    )
  if (data.items.length === 0) return <p className="text-bark">No products in this category yet.</p>
  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {data.items.map((p) => (
          <li key={p.product_id}>
            <Link
              to={`/products/${p.product_id}`}
              className="block overflow-hidden rounded-[14px] border border-sand bg-cream-100 hover:bg-cream-200"
            >
              {p.image ? (
                <img src={p.image.url} alt="" className="aspect-square w-full object-cover" />
              ) : (
                <span className="flex aspect-square w-full items-center justify-center bg-cream-200 text-sm text-bark">
                  No photo
                </span>
              )}
              <span className="block p-2">
                <span className="block font-semibold">{p.name}</span>
                <span className="block text-sm text-bark">
                  {formatPrice(p.price_paisa)} ·{' '}
                  {p.availability_type === 'MADE_TO_ORDER'
                    ? 'made to order'
                    : `${p.stock_quantity} in stock`}
                  {!p.is_visible && ' · hidden'}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {count > data.items.length && (
        <p className="mt-3 text-sm">
          <Link to={`/products?category=${categoryId}`} className="underline underline-offset-4">
            See all {count} products
          </Link>
        </p>
      )}
    </>
  )
}

export default function CategoriesAdminPage() {
  const { data, loading, failed, reload } = useLoad((s) => getAdminCategories(s), [])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  async function run(fn: () => Promise<unknown>, fallback: string) {
    setError(null)
    try {
      await fn()
      setEditing(null)
      reload()
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409
          ? 'That name is already used, or the category still has products. Move its products first.'
          : fallback,
      )
    }
  }

  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const name = String(new FormData(form).get('name') ?? '').trim()
    if (!name) return setError('Please enter a name.')
    await run(() => createCategory(name), 'Could not add the category.')
    form.reset()
  }

  return (
    <>
      <PageTitle title="Categories" />
      <form
        onSubmit={onAdd}
        aria-label="Add category"
        className="mt-4 flex flex-wrap items-end gap-3"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="new-category" className="text-sm font-medium text-bark">
            New category
          </label>
          <input id="new-category" name="name" maxLength={100} className={inputClass} />
        </div>
        <button type="submit" className={buttonClass}>
          Add
        </button>
      </form>
      <div className="mt-4">
        <FormError message={error} />
      </div>
      <div className="mt-4">
        <State
          loading={loading}
          failed={failed}
          empty={data?.length === 0}
          emptyText="No categories yet."
        >
          <ul className="flex flex-col gap-2">
            {data?.map((c) => (
              <li key={c.category_id} className={`${cardClass} p-3`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {editing === c.category_id ? (
                    <form
                      className="flex flex-wrap items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault()
                        const name = String(
                          new FormData(e.currentTarget).get('rename') ?? '',
                        ).trim()
                        if (name)
                          void run(
                            () => renameCategory(c.category_id, name),
                            'Could not rename the category.',
                          )
                      }}
                    >
                      <label className="sr-only" htmlFor={`rename-${c.category_id}`}>
                        New name for {c.name}
                      </label>
                      <input
                        id={`rename-${c.category_id}`}
                        name="rename"
                        defaultValue={c.name}
                        maxLength={100}
                        className={inputClass}
                      />
                      <button type="submit" className={buttonClass}>
                        Save
                      </button>
                      <button type="button" className="underline" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        aria-expanded={open === c.category_id}
                        aria-controls={`cat-${c.category_id}`}
                        onClick={() => setOpen(open === c.category_id ? null : c.category_id)}
                        className="flex flex-nowrap items-center gap-3 rounded-[10px] text-left focus-visible:outline-2 focus-visible:outline-dashed focus-visible:outline-bark"
                      >
                        <ChevronRightIcon
                          className={`shrink-0 transition-transform ${open === c.category_id ? 'rotate-90' : ''}`}
                        />
                        <span>
                          <strong>{c.name}</strong>{' '}
                          <span className="text-sm text-muted">
                            {c.product_count} {c.product_count === 1 ? 'product' : 'products'}
                          </span>
                        </span>
                      </button>
                      <span className="flex flex-wrap gap-4">
                        <button
                          type="button"
                          className="text-terracotta underline"
                          onClick={() => setEditing(c.category_id)}
                        >
                          Rename
                        </button>
                        <ConfirmButton
                          label="Delete"
                          confirmLabel="Yes, delete"
                          disabled={c.product_count > 0}
                          onConfirm={() =>
                            run(
                              () => deleteCategory(c.category_id),
                              'Could not delete the category.',
                            )
                          }
                        />
                      </span>
                    </>
                  )}
                </div>
                {open === c.category_id && editing !== c.category_id && (
                  <div id={`cat-${c.category_id}`} className="mt-3 border-t border-sand pt-3">
                    {c.product_count === 0 ? (
                      <p className="text-bark">No products in this category yet.</p>
                    ) : (
                      <CategoryProducts categoryId={c.category_id} count={c.product_count} />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </State>
      </div>
    </>
  )
}
