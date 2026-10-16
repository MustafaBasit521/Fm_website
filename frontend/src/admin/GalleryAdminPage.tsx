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
import { buttonClass, Field, FilePicker, FormError } from '../pages/ui'
import { inputClass } from './styles'
import { ConfirmButton, Pager, State, PageTitle, Switch, cardClass } from './ui'
import { useToast } from '../toast/context'
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
  const toast = useToast()

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
        show_in_hero: fd.get('hero') === 'on',
      })
      form.reset()
      toast.show('Picture added')
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
      toast.show('Saved')
      reload()
    } catch {
      setError('Could not save that change.')
    }
  }

  return (
    <>
      <PageTitle
        eyebrow={data ? `${data.total} ${data.total === 1 ? 'picture' : 'pictures'}` : undefined}
        title="Gallery"
      />
      <p className="mt-1 max-w-xl text-bark">
        Pictures shown publicly fill the gallery on the home page. Tick &ldquo;Top of the home
        page&rdquo; on up to two shown pictures to make them the big photos next to the headline
        (the first is large, the second sits in front of it; the title and description become the
        caption). With none ticked, photos of the featured pieces are used.
      </p>
      <form
        onSubmit={onUpload}
        aria-label="Add a gallery picture"
        className={`${cardClass} mt-5 flex max-w-xl flex-col gap-3 p-4 md:p-5`}
      >
        <FilePicker
          id="g-file"
          name="file"
          label="Picture (JPG, PNG or WebP, under 5 MB)"
          accept={IMAGE_TYPES.join(',')}
          buttonText="Choose picture"
        />
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
        <label className="flex items-center gap-2">
          <input type="checkbox" name="hero" /> Show big at the top of the home page
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
                  <li key={img.gallery_image_id} className={`${cardClass} flex flex-col gap-2 p-3`}>
                    <img
                      src={img.url}
                      alt={img.title ?? 'Gallery photo'}
                      className="aspect-square w-full rounded-lg object-cover"
                    />
                    <p className="font-semibold">{img.title ?? 'Untitled'}</p>
                    <Switch
                      checked={img.is_visible}
                      label="Shown publicly"
                      hiddenLabel={`Show ${img.title ?? 'picture'} in the gallery`}
                      onChange={(next) => void change(img.gallery_image_id, { is_visible: next })}
                    />
                    <Switch
                      checked={img.show_in_hero}
                      label="Top of the home page"
                      hiddenLabel={`Show ${img.title ?? 'picture'} at the top of the home page`}
                      onChange={(next) => void change(img.gallery_image_id, { show_in_hero: next })}
                    />
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
