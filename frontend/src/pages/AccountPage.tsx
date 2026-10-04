import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { ApiError, getMe, updateMe, type Customer } from '../lib/api'
import { buttonClass, Field, FormError } from './ui'

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

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="font-serif text-4xl">My account</h1>
      <p className="text-muted">{customer.email}</p>
      <nav className="flex gap-4 text-terracotta underline">
        <Link to="/account/addresses">Saved addresses</Link>
        <Link to="/wishlist">Wishlist</Link>
      </nav>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="subscribed"
            defaultChecked={customer.subscribed_to_updates}
          />
          Send me shop updates
        </label>
        <FormError message={error} />
        {saveState === 'saved' && <p role="status">Saved.</p>}
        <button type="submit" className={buttonClass} disabled={saveState === 'saving'}>
          {saveState === 'saving' ? 'Saving…' : 'Save changes'}
        </button>
      </form>
      <button
        type="button"
        onClick={() => void signOut()}
        className="text-left text-terracotta underline"
      >
        Log out
      </button>
    </main>
  )
}
