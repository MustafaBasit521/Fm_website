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
import { buttonClass, Field, FormError, secondaryButtonClass } from '../pages/ui'
import { inputClass } from './styles'
import { ConfirmButton, PageTitle, State, cardClass } from './ui'
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
        navigate(`/products/${created.product_id}`, { replace: true })
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
      navigate('/products', { replace: true })
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
      <Link
        to="/products"
        className="inline-flex items-center gap-1 text-sm underline underline-offset-4"
      >
        <span aria-hidden="true">←</span> All products
      </Link>
      <div className="mt-3">
        <PageTitle
          eyebrow={
            current ? `${current.category.name} · ${formatPrice(current.price_paisa)}` : undefined
          }
          title={isNew ? 'Add product' : 'Edit product'}
        />
      </div>
      <div className="mt-6">
        <State loading={!ready} failed={categories.failed || (!isNew && product.failed)}>
          <div className="grid items-start gap-6 lg:grid-cols-[1.6fr_1fr]">
            <form
              id="product-form"
              key={current?.product_id ?? 'new'}
              onSubmit={onSubmit}
              aria-label="Product"
              className={`${cardClass} flex flex-col gap-4 p-4 md:p-6`}
            >
              <Field
                id="name"
                name="name"
                label="Product name"
                defaultValue={current?.name ?? ''}
                maxLength={200}
                required
              />
              <div className="grid gap-4 sm:grid-cols-2">
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
                <Field
                  id="price"
                  name="price"
                  label="Price (Rs)"
                  inputMode="decimal"
                  defaultValue={current ? paisaToRupeesInput(current.price_paisa) : ''}
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
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
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="description" className="text-sm font-medium text-bark">
                  Description
                </label>
                <textarea
                  id="description"
                  name="description"
                  rows={6}
                  maxLength={5000}
                  className={inputClass}
                  defaultValue={current?.description ?? ''}
                />
              </div>
            </form>

            <div className="flex flex-col gap-6">
              {!isNew && current && (
                <section aria-label="Pictures" className={`${cardClass} p-4 md:p-5`}>
                  <h2 className="font-serif text-2xl">Pictures</h2>
                  <p className="text-sm text-muted">
                    Current price {formatPrice(current.price_paisa)}. Pictures are stored securely
                    and shown in this order.
                  </p>
                  {current.images.length === 0 && <p className="mt-2">No pictures yet.</p>}
                  <ul className="mt-3 flex flex-col gap-3">
                    {current.images.map((img, i) => (
                      <li
                        key={img.image_id}
                        className="flex flex-col gap-2 rounded-[10px] border border-sand p-2"
                      >
                        <img
                          src={img.url}
                          alt={img.alt_text ?? current.name}
                          className={`w-full rounded-lg bg-cream-200 object-cover ${i === 0 ? 'aspect-[4/3]' : 'h-24'}`}
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
                      className="rounded-[10px] border-2 border-dashed border-linen bg-cream-100 p-3 text-sm text-bark"
                    />
                  </div>
                </section>
              )}
              {isNew && (
                <p className={`${cardClass} p-4 text-bark`}>
                  You can add pictures after the product is created.
                </p>
              )}

              <section aria-label="Visibility" className={`${cardClass} divide-y divide-sand px-4`}>
                <label className="flex flex-nowrap items-center justify-between gap-3 py-3">
                  <span>
                    Show in shop
                    <span className="block text-sm text-bark">Customers can see and buy it</span>
                  </span>
                  <input
                    form="product-form"
                    type="checkbox"
                    name="visible"
                    aria-label="Show in shop"
                    defaultChecked={current?.is_visible ?? false}
                    key={`v-${current?.product_id ?? 'new'}`}
                    className="h-5 w-5 shrink-0"
                  />
                </label>
                <label className="flex flex-nowrap items-center justify-between gap-3 py-3">
                  <span>
                    Feature on the home page
                    <span className="block text-sm text-bark">
                      Appears in &ldquo;Fresh off the hook&rdquo;
                    </span>
                  </span>
                  <input
                    form="product-form"
                    type="checkbox"
                    name="featured"
                    aria-label="Feature on the home page"
                    defaultChecked={current?.is_featured ?? false}
                    key={`f-${current?.product_id ?? 'new'}`}
                    className="h-5 w-5 shrink-0"
                  />
                </label>
              </section>

              <div className="flex flex-col gap-3">
                <FormError message={error} />
                {notice && <p role="status">{notice}</p>}
                <button
                  type="submit"
                  form="product-form"
                  className={`${buttonClass} w-full`}
                  disabled={busy}
                >
                  {isNew ? 'Create product' : 'Save changes'}
                </button>
                <Link to="/products" className={`${secondaryButtonClass} w-full`}>
                  Cancel
                </Link>
                {!isNew && (
                  <p className="text-center">
                    <ConfirmButton
                      label="Delete product"
                      confirmLabel="Yes, delete this product"
                      onConfirm={() => void onDelete()}
                    />
                  </p>
                )}
              </div>
            </div>
          </div>
        </State>
      </div>
    </>
  )
}
