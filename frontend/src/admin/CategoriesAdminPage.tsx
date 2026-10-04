import { useState, type FormEvent } from 'react'
import { createCategory, deleteCategory, getAdminCategories, renameCategory } from '../lib/adminApi'
import { ApiError } from '../lib/api'
import { buttonClass, FormError } from '../pages/ui'
import { inputClass } from './styles'
import { ConfirmButton, State } from './ui'
import { useLoad } from './useLoad'

export default function CategoriesAdminPage() {
  const { data, loading, failed, reload } = useLoad((s) => getAdminCategories(s), [])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

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
      <h1 className="font-serif text-4xl">Categories</h1>
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
              <li
                key={c.category_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sand bg-white p-3"
              >
                {editing === c.category_id ? (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const name = String(new FormData(e.currentTarget).get('rename') ?? '').trim()
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
                    <span>
                      <strong>{c.name}</strong>{' '}
                      <span className="text-sm text-muted">
                        {c.product_count} {c.product_count === 1 ? 'product' : 'products'}
                      </span>
                    </span>
                    <span className="flex gap-4">
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
                          run(() => deleteCategory(c.category_id), 'Could not delete the category.')
                        }
                      />
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </State>
      </div>
    </>
  )
}
