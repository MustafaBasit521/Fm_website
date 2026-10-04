import { useState, type FormEvent } from 'react'
import {
  createGalleryImage,
  deleteGalleryImage,
  getAdminGallery,
  getGalleryUpload,
  updateGalleryImage,
} from '../lib/adminApi'
import { ApiError, type GalleryImageType } from '../lib/api'
import { supabase } from '../lib/supabase'
import { buttonClass, Field, FormError } from '../pages/ui'
import { inputClass } from './styles'
import { ConfirmButton, Pager, State } from './ui'
import { useLoad } from './useLoad'

const TYPES: [GalleryImageType, string][] = [
  ['SHOP', 'In the shop'],
  ['DESIGN', 'Designs'],
  ['BEHIND_THE_SCENES', 'Behind the scenes'],
  ['CUSTOMER_PHOTO', 'Customer photos'],
  ['OTHER', 'Other'],
]
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024

export default function GalleryAdminPage() {
  const [page, setPage] = useState(1)
  const { data, loading, failed, reload } = useLoad((s) => getAdminGallery(page, s), [page])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    const input = form.elements.namedItem('file') as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return setError('Please choose a picture.')
    if (!IMAGE_TYPES.includes(file.type)) return setError('Pictures must be JPG, PNG or WebP.')
    if (file.size > MAX_BYTES) return setError('Pictures must be under 5 MB.')
    const text = (k: string) => String(fd.get(k) ?? '').trim()
    setBusy(true)
    setError(null)
    try {
      const target = await getGalleryUpload(file.type)
      const { error: uploadError } = await supabase.storage
        .from(target.bucket)
        .uploadToSignedUrl(target.storage_path, target.token, file)
      if (uploadError) throw new Error('upload failed')
      await createGalleryImage({
        storage_path: target.storage_path,
        title: text('title') || null,
        description: text('description') || null,
        image_type: text('type') as GalleryImageType,
        is_visible: fd.get('visible') === 'on',
      })
      form.reset()
      reload()
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

  async function change(id: string, patch: Parameters<typeof updateGalleryImage>[1]) {
    setError(null)
    try {
      await updateGalleryImage(id, patch)
      reload()
    } catch {
      setError('Could not save that change.')
    }
  }

  return (
    <>
      <h1 className="font-serif text-4xl">Gallery</h1>
      <form
        onSubmit={onUpload}
        aria-label="Add a gallery picture"
        className="mt-4 flex max-w-xl flex-col gap-3 rounded-xl border border-sand bg-white p-4"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="g-file" className="text-sm font-medium text-bark">
            Picture (JPG, PNG or WebP, under 5 MB)
          </label>
          <input id="g-file" name="file" type="file" accept={IMAGE_TYPES.join(',')} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="g-type" className="text-sm font-medium text-bark">
            Type
          </label>
          <select id="g-type" name="type" className={inputClass} defaultValue="SHOP">
            {TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <Field id="g-title" name="title" label="Title (optional)" maxLength={200} />
        <Field id="g-desc" name="description" label="Description (optional)" maxLength={2000} />
        <label className="flex items-center gap-2">
          <input type="checkbox" name="visible" /> Show in the public gallery
        </label>
        <FormError message={error} />
        <div>
          <button type="submit" className={buttonClass} disabled={busy}>
            {busy ? 'Uploading…' : 'Add picture'}
          </button>
        </div>
      </form>

      <div className="mt-6">
        <State
          loading={loading}
          failed={failed}
          empty={data?.items.length === 0}
          emptyText="No gallery pictures yet."
        >
          {data && (
            <>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.items.map((img) => (
                  <li
                    key={img.gallery_image_id}
                    className="flex flex-col gap-2 rounded-xl border border-sand bg-white p-3"
                  >
                    <img
                      src={img.url}
                      alt={img.title ?? 'Gallery photo'}
                      className="aspect-square w-full rounded-lg object-cover"
                    />
                    <p className="font-semibold">{img.title ?? 'Untitled'}</p>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={img.is_visible}
                        aria-label={`Show ${img.title ?? 'picture'} in the gallery`}
                        onChange={(e) =>
                          void change(img.gallery_image_id, { is_visible: e.target.checked })
                        }
                      />
                      Shown publicly
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      Type
                      <select
                        className={inputClass}
                        value={img.image_type}
                        onChange={(e) =>
                          void change(img.gallery_image_id, {
                            image_type: e.target.value as GalleryImageType,
                          })
                        }
                      >
                        {TYPES.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                    <ConfirmButton
                      label="Delete"
                      confirmLabel="Yes, delete"
                      onConfirm={async () => {
                        try {
                          await deleteGalleryImage(img.gallery_image_id)
                          reload()
                        } catch {
                          setError('Could not delete the picture.')
                        }
                      }}
                    />
                  </li>
                ))}
              </ul>
              <Pager page={page} total={data.total} pageSize={24} onPage={setPage} />
            </>
          )}
        </State>
      </div>
    </>
  )
}
