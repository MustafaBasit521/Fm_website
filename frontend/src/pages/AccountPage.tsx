import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { ApiError, getMe, updateMe, type Customer } from '../lib/api'
import { buttonClass, Field, FormError, secondaryButtonClass } from './ui'

export default function AccountPage() {
  const { signOut } = useAuth()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getMe(controller.signal)
      .then(setCustomer)
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setLoadError(true)
      })
    return () => controller.abort()
  }, [])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setSaveState('saving')
    setError(null)
    try {
      setCustomer(
        await updateMe({
          name: String(form.get('name')),
          phone: String(form.get('phone')),
          subscribed_to_updates: form.get('subscribed') === 'on',
        }),
      )
      setSaveState('saved')
    } catch (err) {
      setSaveState('idle')
      setError(
        err instanceof ApiError && err.status === 422
          ? 'Please check your name and phone number.'
          : 'Could not save your changes. Please try again.',
      )
    }
  }

  if (loadError)
    return (
      <p role="alert" className="p-4 text-danger">
        Could not load your account.
      </p>
    )
  if (!customer)
    return (
      <p role="status" className="p-4">
        Loading…
      </p>
    )

  const firstName = customer.name.split(' ')[0]
  const TILES: [string, string, string][] = [
    ['/orders', 'My orders', 'Track and manage your orders'],
    ['/wishlist', 'Wishlist', 'Pieces you have saved'],
    ['/account/addresses', 'Saved addresses', 'Where we deliver in Lahore'],
    ['/custom-orders', 'Custom orders', 'Your custom piece requests'],
    ['/notifications', 'Notifications', 'Updates about your orders'],
  ]

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-serif text-5xl">Hi, {firstName}</h1>
      <p className="mt-1 text-muted">{customer.email}</p>

      <nav aria-label="My account" className="mt-6">
        <ul className="grid gap-3 sm:grid-cols-2">
          {TILES.map(([to, title, text]) => (
            <li key={to}>
              <Link
                to={to}
                className="block rounded-[18px] border border-sand bg-paper p-5 hover:border-ink focus-visible:outline-2 focus-visible:outline-dashed focus-visible:outline-bark"
              >
                <span className="block text-lg font-semibold">{title}</span>
                <span className="text-sm text-bark">{text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <h2 className="mt-10 font-serif text-3xl">My details</h2>
      <form
        onSubmit={onSubmit}
        className="mt-3 flex flex-col gap-4 rounded-[18px] border border-sand bg-paper p-5"
      >
        <Field
          id="name"
          name="name"
          label="Name"
          defaultValue={customer.name}
          maxLength={100}
          required
        />
        <Field
          id="phone"
          name="phone"
          label="Phone"
          type="tel"
          autoComplete="tel"
          defaultValue={customer.phone ?? ''}
          maxLength={20}
        />
        <label className="flex flex-nowrap items-center gap-3">
          <input
            type="checkbox"
            name="subscribed"
            defaultChecked={customer.subscribed_to_updates}
          />
          Send me shop updates
        </label>
        <FormError message={error} />
        {saveState === 'saved' && <p role="status">Saved.</p>}
        <div>
          <button type="submit" className={buttonClass} disabled={saveState === 'saving'}>
            {saveState === 'saving' ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
      <p className="mt-6">
        <button type="button" onClick={() => void signOut()} className={secondaryButtonClass}>
          Log out
        </button>
      </p>
    </main>
  )
}
