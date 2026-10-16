import { useEffect, useMemo, useState, type FormEvent } from 'react'
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
import {
  BackLink,
  buttonClass,
  Field,
  FilePicker,
  FormError,
  secondaryButtonClass,
} from '../pages/ui'
import { inputClass } from './styles'
import { ConfirmButton, PageTitle, State, cardClass } from './ui'
import { useToast } from '../toast/context'
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
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  // pictures chosen while creating a new product; they are uploaded right after it is saved
  const [pending, setPending] = useState<File[]>([])
  const previews = useMemo(() => pending.map((f) => URL.createObjectURL(f)), [pending])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])

  const current = override?.product_id === id ? override : product.data
  const effectiveType = type ?? current?.availability_type ?? 'READY_TO_SHIP'
  const ready = !categories.loading && (isNew || !product.loading)

  function explain(e: unknown): string {
    if (e instanceof ApiError && e.code === 'ACTIVE_ORDERS')
      return 'The availability type cannot change while orders containing this product are still active.'
    if (e instanceof ApiError && e.status === 422) return 'Please check the fields and try again.'
    return 'That did not work. Please try again.'
  }

  /** Checks a chosen picture; returns the reason it cannot be used, or null. */
  function pictureProblem(file: File): string | null {
    if (!IMAGE_TYPES.includes(file.type)) return 'Pictures must be JPG, PNG or WebP.'
    if (file.size > MAX_BYTES) return 'Pictures must be under 5 MB.'
    return null
  }

  async function uploadPicture(productId: string, file: File, sortOrder: number) {
    const target = await getProductImageUpload(productId, file.type)
    const { error: uploadError } = await supabase.storage
      .from(target.bucket)
      .uploadToSignedUrl(target.storage_path, target.token, file)
    if (uploadError) throw new Error('upload failed')
    await registerProductImage(productId, {
      storage_path: target.storage_path,
      alt_text: null,
      sort_order: sortOrder,
    })
  }

  function choosePictures(files: File[]) {
    const bad = files.map(pictureProblem).find(Boolean)
    if (bad) setError(bad)
    else setError(null)
    setPending((list) => [...list, ...files.filter((f) => !pictureProblem(f))])
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
    try {
      if (isNew) {
        const created = await createProduct(body)
        let failed = 0
        for (const [i, file] of pending.entries()) {
          try {
            await uploadPicture(created.product_id, file, i)
          } catch {
            failed += 1
          }
        }
        toast.show(
          failed === 0
            ? 'Product created'
            : `Product created, but ${failed} ${failed === 1 ? 'picture' : 'pictures'} could not be uploaded. Add them here.`,
        )
        navigate(`/products/${created.product_id}`, { replace: true })
      } else {
        setOverride(await updateProduct(id, body))
        toast.show('Product saved')
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

  async function addPictures(files: File[]) {
    if (isNew || files.length === 0) return
    const bad = files.map(pictureProblem).find(Boolean)
    if (bad) return setError(bad)
    setBusy(true)
    setError(null)
    try {
      let count = current?.images.length ?? 0
      for (const file of files) await uploadPicture(id, file, count++)
      setOverride(await getAdminProduct(id))
      toast.show(files.length === 1 ? 'Picture added' : `${files.length} pictures added`)
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
      toast.show('Picture description saved')
    } catch {
      setError('Could not save the picture description.')
    }
  }

  return (
    <>
      <BackLink to="/products">All products</BackLink>
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
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
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
                  <div className="mt-3">
                    <FilePicker
                      id="add-photo"
                      label="Add pictures (JPG, PNG or WebP, under 5 MB each)"
                      accept={IMAGE_TYPES.join(',')}
                      multiple
                      disabled={busy}
                      buttonText="Choose pictures"
                      showNames={false}
                      onFiles={(files) => void addPictures(files)}
                    />
                  </div>
                </section>
              )}
              {isNew && (
                <section aria-label="Pictures" className={`${cardClass} p-4 md:p-5`}>
                  <h2 className="font-serif text-2xl">Pictures</h2>
                  <p className="text-sm text-muted">
                    The first picture is the main one. They are uploaded when you create the
                    product.
                  </p>
                  {pending.length > 0 && (
                    <ul className="mt-3 grid grid-cols-3 gap-2">
                      {pending.map((file, i) => (
                        <li key={`${file.name}-${i}`} className="relative">
                          <img
                            src={previews[i]}
                            alt={`Chosen picture ${i + 1}: ${file.name}`}
                            className="aspect-square w-full rounded-lg bg-cream-200 object-cover"
                          />
                          <button
                            type="button"
                            aria-label={`Remove ${file.name}`}
                            onClick={() => setPending((list) => list.filter((_, j) => j !== i))}
                            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink text-cream"
                          >
                            <span aria-hidden="true">×</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3">
                    <FilePicker
                      id="new-photos"
                      label="Add pictures (JPG, PNG or WebP, under 5 MB each)"
                      accept={IMAGE_TYPES.join(',')}
                      multiple
                      disabled={busy}
                      buttonText="Choose pictures"
                      showNames={false}
                      onFiles={choosePictures}
                    />
                  </div>
                </section>
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
