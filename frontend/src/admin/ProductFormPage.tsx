import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  createProduct,
  deleteProduct,
  deleteProductImage,
  getAdminCategories,
  getAdminProduct,
  getProductImageUpload,
  registerProductImage,
  updateProduct,
  updateProductImage,
  type AdminProduct,
  type ProductWrite,
} from '../lib/adminApi'
import { ApiError } from '../lib/api'
import { formatPrice, paisaToRupeesInput, parseRupeesToPaisa } from '../lib/money'
import { supabase } from '../lib/supabase'
import { buttonClass, Field, FormError } from '../pages/ui'
import { inputClass } from './styles'
import { ConfirmButton, State } from './ui'
import { useLoad } from './useLoad'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024

const intOrNull = (v: string) => (/^\d{1,9}$/.test(v.trim()) ? Number(v.trim()) : null)

export default function ProductFormPage() {
  const { id } = useParams()
  const isNew = id === undefined
  const navigate = useNavigate()
  const categories = useLoad((s) => getAdminCategories(s), [])
  const product = useLoad(
    (s) => (isNew ? Promise.resolve<AdminProduct | null>(null) : getAdminProduct(id, s)),
    [id],
  )
  const [override, setOverride] = useState<AdminProduct | null>(null)
  const [type, setType] = useState<'READY_TO_SHIP' | 'MADE_TO_ORDER' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const current = override?.product_id === id ? override : product.data
  const effectiveType = type ?? current?.availability_type ?? 'READY_TO_SHIP'
  const ready = !categories.loading && (isNew || !product.loading)

  function explain(e: unknown): string {
    if (e instanceof ApiError && e.code === 'ACTIVE_ORDERS')
      return 'The availability type cannot change while orders containing this product are still active.'
    if (e instanceof ApiError && e.status === 422) return 'Please check the fields and try again.'
    return 'That did not work. Please try again.'
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const text = (k: string) => String(form.get(k) ?? '').trim()
    const price = parseRupeesToPaisa(text('price'))
    if (price === null) return setError('Enter the price in Rs, like 1250 or 1250.50.')
    const stock = effectiveType === 'READY_TO_SHIP' ? intOrNull(text('stock')) : 0
    const capacity = effectiveType === 'MADE_TO_ORDER' ? intOrNull(text('capacity')) : 0
    if (stock === null || capacity === null)
      return setError('Stock and capacity must be whole numbers.')
    const body: ProductWrite = {
      category_id: text('category'),
      name: text('name'),
      description: text('description') || null,
      price_paisa: price,
      availability_type: effectiveType,
      stock_quantity: stock,
      max_active_units: capacity,
      is_visible: form.get('visible') === 'on',
      is_featured: form.get('featured') === 'on',
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (isNew) {
        const created = await createProduct(body)
        navigate(`/admin/products/${created.product_id}`, { replace: true })
      } else {
        setOverride(await updateProduct(id, body))
        setNotice('Saved.')
      }
    } catch (err) {
      setError(explain(err))
    } finally {
      setBusy(false)
    }
  }

  async function onDelete() {
    if (isNew) return
    try {
      await deleteProduct(id)
      navigate('/admin/products', { replace: true })
    } catch {
      setError('Could not delete the product. Please try again.')
    }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || isNew) return
    if (!IMAGE_TYPES.includes(file.type)) return setError('Pictures must be JPG, PNG or WebP.')
    if (file.size > MAX_BYTES) return setError('Pictures must be under 5 MB.')
    setBusy(true)
    setError(null)
    try {
      const target = await getProductImageUpload(id, file.type)
      const { error: uploadError } = await supabase.storage
        .from(target.bucket)
        .uploadToSignedUrl(target.storage_path, target.token, file)
      if (uploadError) throw new Error('upload failed')
      await registerProductImage(id, {
        storage_path: target.storage_path,
        alt_text: null,
        sort_order: current?.images.length ?? 0,
      })
      setOverride(await getAdminProduct(id))
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 503
          ? 'Picture upload is not set up yet (storage key missing).'
          : 'Could not upload the picture. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function onDeleteImage(imageId: string) {
    try {
      await deleteProductImage(id!, imageId)
      setOverride(await getAdminProduct(id!))
    } catch {
      setError('Could not remove the picture. Please try again.')
    }
  }

  async function onAlt(imageId: string, alt: string) {
    try {
      await updateProductImage(id!, imageId, { alt_text: alt.trim() || null })
      setNotice('Picture description saved.')
    } catch {
      setError('Could not save the picture description.')
    }
  }

  return (
    <>
      <Link to="/admin/products" className="text-terracotta underline">
        ← All products
      </Link>
      <h1 className="mt-2 font-serif text-4xl">{isNew ? 'Add product' : 'Edit product'}</h1>
      <div className="mt-4">
        <State loading={!ready} failed={categories.failed || (!isNew && product.failed)}>
          <form
            key={current?.product_id ?? 'new'}
            onSubmit={onSubmit}
            aria-label="Product"
            className="flex max-w-xl flex-col gap-4"
          >
            <Field
              id="name"
              name="name"
              label="Product name"
              defaultValue={current?.name ?? ''}
              maxLength={200}
              required
            />
            <div className="flex flex-col gap-1">
              <label htmlFor="category" className="text-sm font-medium text-bark">
                Category
              </label>
              <select
                id="category"
                name="category"
                className={inputClass}
                defaultValue={current?.category_id ?? ''}
                required
              >
                <option value="" disabled>
                  Choose a category
                </option>
                {categories.data?.map((c) => (
                  <option key={c.category_id} value={c.category_id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="description" className="text-sm font-medium text-bark">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                rows={4}
                maxLength={5000}
                className={inputClass}
                defaultValue={current?.description ?? ''}
              />
            </div>
            <Field
              id="price"
              name="price"
              label="Price (Rs)"
              inputMode="decimal"
              defaultValue={current ? paisaToRupeesInput(current.price_paisa) : ''}
              required
            />
            <div className="flex flex-col gap-1">
              <label htmlFor="type" className="text-sm font-medium text-bark">
                Availability
              </label>
              <select
                id="type"
                className={inputClass}
                value={effectiveType}
                onChange={(e) => setType(e.target.value as 'READY_TO_SHIP' | 'MADE_TO_ORDER')}
              >
                <option value="READY_TO_SHIP">Ready to ship (tracked stock)</option>
                <option value="MADE_TO_ORDER">Made to order (limited capacity)</option>
              </select>
            </div>
            {effectiveType === 'READY_TO_SHIP' ? (
              <Field
                id="stock"
                name="stock"
                label="Pieces in stock"
                inputMode="numeric"
                defaultValue={String(current?.stock_quantity ?? 0)}
                required
              />
            ) : (
              <Field
                id="capacity"
                name="capacity"
                label="Most units in progress at once"
                inputMode="numeric"
                defaultValue={String(current?.max_active_units ?? 0)}
                required
              />
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" name="visible" defaultChecked={current?.is_visible ?? false} />{' '}
              Show in shop
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="featured"
                defaultChecked={current?.is_featured ?? false}
              />{' '}
              Feature on the home page
            </label>
            <FormError message={error} />
            {notice && <p role="status">{notice}</p>}
            <div className="flex flex-wrap items-center gap-4">
              <button type="submit" className={buttonClass} disabled={busy}>
                {isNew ? 'Create product' : 'Save changes'}
              </button>
              {!isNew && (
                <ConfirmButton
                  label="Delete product"
                  confirmLabel="Yes, delete this product"
                  onConfirm={() => void onDelete()}
                />
              )}
            </div>
          </form>

          {!isNew && current && (
            <section aria-label="Pictures" className="mt-10 max-w-xl">
              <h2 className="text-xl font-semibold">Pictures</h2>
              <p className="text-sm text-muted">
                Current price {formatPrice(current.price_paisa)}. Pictures are stored securely and
                shown in this order.
              </p>
              {current.images.length === 0 && <p className="mt-2">No pictures yet.</p>}
              <ul className="mt-3 flex flex-col gap-3">
                {current.images.map((img) => (
                  <li
                    key={img.image_id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-sand bg-white p-3"
                  >
                    <img
                      src={img.url}
                      alt={img.alt_text ?? current.name}
                      className="h-16 w-16 rounded-lg object-cover"
                    />
                    <label className="flex flex-col gap-1 text-sm">
                      Description (for screen readers)
                      <input
                        className={inputClass}
                        defaultValue={img.alt_text ?? ''}
                        maxLength={200}
                        onBlur={(e) => {
                          if (e.target.value.trim() !== (img.alt_text ?? ''))
                            void onAlt(img.image_id, e.target.value)
                        }}
                      />
                    </label>
                    <ConfirmButton
                      label="Remove"
                      confirmLabel="Yes, remove"
                      onConfirm={() => void onDeleteImage(img.image_id)}
                    />
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-col gap-1">
                <label htmlFor="add-photo" className="text-sm font-medium text-bark">
                  Add a picture (JPG, PNG or WebP, under 5 MB)
                </label>
                <input
                  id="add-photo"
                  type="file"
                  accept={IMAGE_TYPES.join(',')}
                  disabled={busy}
                  onChange={(e) => void onUpload(e)}
                />
              </div>
            </section>
          )}
        </State>
      </div>
    </>
  )
}
