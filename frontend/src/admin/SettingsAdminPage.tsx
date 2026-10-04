import { useState, type FormEvent } from 'react'
import { getAdminSettings, updateAdminSettings } from '../lib/adminApi'
import { ApiError } from '../lib/api'
import { paisaToRupeesInput, parseRupeesToPaisa } from '../lib/money'
import { buttonClass, Field, FormError } from '../pages/ui'
import { inputClass } from './styles'
import { State } from './ui'
import { useLoad } from './useLoad'

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
  const [notice, setNotice] = useState<string | null>(null)
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
    setNotice(null)
    try {
      setSaved(
        await updateAdminSettings({
          business_name: optional('business_name'),
          email: optional('email'),
          phone: optional('phone'),
          whatsapp: optional('whatsapp'),
          address: optional('address'),
          delivery_information: optional('delivery_information'),
          delivery_fee_paisa: fee,
          social_links: links,
        }),
      )
      setNotice('Settings saved.')
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 422
          ? 'Please check the fields: links must start with https:// and the email, phone and fee must be valid.'
          : 'Could not save the settings. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1 className="font-serif text-4xl">Settings</h1>
      <div className="mt-4">
        <State loading={loading && !settings} failed={failed && !settings}>
          {settings && (
            <form
              key={settings.updated_at}
              onSubmit={onSubmit}
              aria-label="Business settings"
              className="flex max-w-xl flex-col gap-4"
            >
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
              <Field
                id="fee"
                name="fee"
                label="Delivery fee (Rs)"
                inputMode="decimal"
                defaultValue={paisaToRupeesInput(settings.delivery_fee_paisa)}
                required
              />
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-1 font-medium text-bark">Social links (https:// only)</legend>
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
              </fieldset>
              <FormError message={error} />
              {notice && <p role="status">{notice}</p>}
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
