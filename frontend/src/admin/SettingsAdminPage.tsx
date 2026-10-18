import { useState, type FormEvent } from 'react'
import { getAdminSettings, updateAdminSettings } from '../lib/adminApi'
import { ApiError } from '../lib/api'
import { paisaToRupeesInput, parseRupeesToPaisa } from '../lib/money'
import { buttonClass, Field, FormError } from '../pages/ui'
import { inputClass } from './styles'
import { State, PageTitle, cardClass } from './ui'
import { useToast } from '../toast/context'
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
      setSaved(
        await updateAdminSettings({
          business_name: optional('business_name'),
          email: optional('email'),
          phone: optional('phone'),
          whatsapp: optional('whatsapp'),
          address: optional('address'),
          delivery_information: optional('delivery_information'),
          delivery_fee_paisa: fee,
          transfer_instructions: optional('transfer_instructions'),
          social_links: links,
        }),
      )
      toast.show('Settings saved')
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
              <section aria-label="Payment by transfer" className={`${cardClass} p-4 md:p-6`}>
                <h2 className="font-serif text-2xl">Payment by transfer</h2>
                <div className="mt-3 flex flex-col gap-1">
                  <label htmlFor="transfer_instructions" className="text-sm font-medium text-bark">
                    Where customers send the money
                  </label>
                  <textarea
                    id="transfer_instructions"
                    name="transfer_instructions"
                    rows={4}
                    maxLength={1000}
                    className={inputClass}
                    placeholder={'JazzCash: 0300 1234567 (account name)\nBank: IBAN ...'}
                    defaultValue={settings.transfer_instructions ?? ''}
                  />
                  <p className="text-sm text-bark">
                    Customers see this text when they pay by transfer. Leave it empty to switch
                    transfer payments off (they can still pay cash on delivery).
                  </p>
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
