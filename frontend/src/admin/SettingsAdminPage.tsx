import { useState, type FormEvent } from 'react'
import { getAdminSettings, getPaymentQrUploadTarget, updateAdminSettings } from '../lib/adminApi'
import { ApiError } from '../lib/api'
import { paisaToRupeesInput, parseRupeesToPaisa } from '../lib/money'
import { supabase } from '../lib/supabase'
import { buttonClass, Field, FilePicker, FormError } from '../pages/ui'
import { inputClass } from './styles'
import { State, PageTitle, cardClass } from './ui'
import { useToast } from '../toast/context'
import { useLoad } from './useLoad'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024
const WALLETS = [
  { key: 'easypaisa', name: 'Easypaisa' },
  { key: 'jazzcash', name: 'JazzCash' },
] as const

const SOCIAL: [string, string][] = [
  ['instagram', 'Instagram link'],
  ['facebook', 'Facebook link'],
  ['tiktok', 'TikTok link'],
  ['youtube', 'YouTube link'],
]

export default function SettingsAdminPage() {
  const { data, loading, failed } = useLoad((s) => getAdminSettings(s), [])
  const [saved, setSaved] = useState<typeof data>(null)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const settings = saved ?? data

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const text = (k: string) => String(form.get(k) ?? '').trim()
    const optional = (k: string) => text(k) || null
    const fee = parseRupeesToPaisa(text('fee'))
    if (fee === null) return setError('Enter the delivery fee in Rs, like 200 or 200.50.')
    const links: Record<string, string> = {}
    for (const [key] of SOCIAL) if (text(`social_${key}`)) links[key] = text(`social_${key}`)
    setBusy(true)
    setError(null)
    try {
      // a new QR code is uploaded first (straight to storage); "remove" clears the wallet
      const qr: Record<string, string | null> = {}
      for (const { key, name } of WALLETS) {
        const file = (e.currentTarget.elements.namedItem(`qr_${key}`) as HTMLInputElement | null)
          ?.files?.[0]
        if (file && file.size > 0) {
          if (!IMAGE_TYPES.includes(file.type))
            throw new Error(`${name}: use a JPG, PNG or WebP picture.`)
          if (file.size > MAX_BYTES) throw new Error(`${name}: the picture must be under 5 MB.`)
          const target = await getPaymentQrUploadTarget(file.type)
          const { error: uploadError } = await supabase.storage
            .from(target.bucket)
            .uploadToSignedUrl(target.storage_path, target.token, file)
          if (uploadError) throw new Error(`${name}: the upload failed. Please try again.`)
          qr[`${key}_qr_path`] = target.storage_path
        } else if (form.get(`remove_${key}`)) {
          qr[`${key}_qr_path`] = null
        }
      }
      setSaved(
        await updateAdminSettings({
          business_name: optional('business_name'),
          email: optional('email'),
          phone: optional('phone'),
          whatsapp: optional('whatsapp'),
          address: optional('address'),
          delivery_information: optional('delivery_information'),
          delivery_fee_paisa: fee,
          easypaisa_details: optional('easypaisa_details'),
          jazzcash_details: optional('jazzcash_details'),
          ...qr,
          social_links: links,
        }),
      )
      toast.show('Settings saved')
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 422
          ? 'Please check the fields: links must start with https:// and the email, phone and fee must be valid.'
          : err instanceof Error && !(err instanceof ApiError)
            ? err.message
            : 'Could not save the settings. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageTitle eyebrow="Shop details, delivery and links" title="Settings" />
      <div className="mt-4">
        <State loading={loading && !settings} failed={failed && !settings}>
          {settings && (
            <form
              key={settings.updated_at}
              onSubmit={onSubmit}
              aria-label="Business settings"
              className="flex max-w-3xl flex-col gap-6"
            >
              <section aria-label="Shop details" className={`${cardClass} p-4 md:p-6`}>
                <h2 className="font-serif text-2xl">Shop details</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field
                    id="business_name"
                    name="business_name"
                    label="Business name"
                    defaultValue={settings.business_name ?? ''}
                    maxLength={100}
                  />
                  <Field
                    id="email"
                    name="email"
                    label="Email (shop alerts are sent here)"
                    type="email"
                    defaultValue={settings.email ?? ''}
                  />
                  <Field
                    id="phone"
                    name="phone"
                    label="Phone"
                    type="tel"
                    defaultValue={settings.phone ?? ''}
                    maxLength={20}
                  />
                  <Field
                    id="whatsapp"
                    name="whatsapp"
                    label="WhatsApp number"
                    type="tel"
                    defaultValue={settings.whatsapp ?? ''}
                    maxLength={20}
                  />
                  <Field
                    id="address"
                    name="address"
                    label="Address"
                    defaultValue={settings.address ?? ''}
                    maxLength={300}
                  />
                </div>
              </section>
              <section aria-label="Delivery" className={`${cardClass} p-4 md:p-6`}>
                <h2 className="font-serif text-2xl">Delivery</h2>
                <div className="mt-4 flex flex-col gap-4">
                  <Field
                    id="fee"
                    name="fee"
                    label="Delivery fee (Rs)"
                    inputMode="decimal"
                    defaultValue={paisaToRupeesInput(settings.delivery_fee_paisa)}
                    required
                  />
                  <div className="flex flex-col gap-1">
                    <label htmlFor="delivery_information" className="text-sm font-medium text-bark">
                      Delivery information
                    </label>
                    <textarea
                      id="delivery_information"
                      name="delivery_information"
                      rows={3}
                      maxLength={2000}
                      className={inputClass}
                      defaultValue={settings.delivery_information ?? ''}
                    />
                  </div>
                </div>
              </section>
              <section aria-label="Wallet payments" className={`${cardClass} p-4 md:p-6`}>
                <h2 className="font-serif text-2xl">Easypaisa and JazzCash</h2>
                <p className="mt-1 text-sm text-bark">
                  Upload your merchant QR code for each wallet. A wallet is offered at checkout only
                  while it has a QR code; remove the QR code to switch it off (cash on delivery
                  always stays).
                </p>
                <div className="mt-4 grid gap-6 md:grid-cols-2">
                  {WALLETS.map(({ key, name }) => {
                    const url = settings[`${key}_qr_url`]
                    return (
                      <div key={key} className="flex flex-col gap-3">
                        <h3 className="font-semibold">{name}</h3>
                        {url ? (
                          <img
                            src={url}
                            alt={`Current ${name} QR code`}
                            className="h-40 w-40 rounded-[10px] border border-sand bg-white object-contain p-1"
                          />
                        ) : (
                          <p className="text-sm text-bark">
                            No QR code yet: {name} is switched off.
                          </p>
                        )}
                        <FilePicker
                          id={`qr_${key}`}
                          name={`qr_${key}`}
                          label={url ? `Replace the ${name} QR code` : `Upload the ${name} QR code`}
                          accept={IMAGE_TYPES.join(',')}
                          buttonText="Choose picture"
                        />
                        {url && (
                          <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" name={`remove_${key}`} />
                            Remove the QR code (switch {name} off)
                          </label>
                        )}
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor={`${key}_details`}
                            className="text-sm font-medium text-bark"
                          >
                            Account details shown next to the QR code (optional)
                          </label>
                          <textarea
                            id={`${key}_details`}
                            name={`${key}_details`}
                            rows={2}
                            maxLength={500}
                            className={inputClass}
                            placeholder="Account name and number"
                            defaultValue={settings[`${key}_details`] ?? ''}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
              <fieldset className={`${cardClass} p-4 md:p-6`}>
                <legend className="px-1 font-serif text-2xl">Social links (https:// only)</legend>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  {SOCIAL.map(([key, label]) => (
                    <Field
                      key={key}
                      id={`social_${key}`}
                      name={`social_${key}`}
                      label={label}
                      type="url"
                      defaultValue={settings.social_links[key] ?? ''}
                    />
                  ))}
                </div>
              </fieldset>
              <FormError message={error} />
              <div>
                <button type="submit" className={buttonClass} disabled={busy}>
                  {busy ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          )}
        </State>
      </div>
    </>
  )
}
