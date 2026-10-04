import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  createAddress,
  deleteAddress,
  getAddresses,
  updateAddress,
  type Address,
  type AddressInput,
} from '../lib/api'
import { buttonClass, Field, FormError } from './ui'

type Editing = { mode: 'new' } | { mode: 'edit'; address: Address } | null

function readForm(form: FormData): AddressInput {
  const text = (k: string) => String(form.get(k) ?? '').trim()
  const optional = (k: string) => text(k) || null
  return {
    label: optional('label'),
    house_no: text('house_no'),
    street_number: optional('street_number'),
    city: text('city'),
    province: optional('province'),
    postal_code: text('postal_code'),
    country: text('country'),
  }
}

export default function AddressesPage() {
  const [addresses, setAddresses] = useState<Address[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [editing, setEditing] = useState<Editing>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getAddresses(controller.signal)
      .then(setAddresses)
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setLoadError(true)
      })
    return () => controller.abort()
  }, [])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editing || !addresses) return
    const data = readForm(new FormData(e.currentTarget))
    setBusy(true)
    setError(null)
    try {
      if (editing.mode === 'new') {
        const created = await createAddress(data)
        setAddresses([...addresses, created])
      } else {
        const updated = await updateAddress(editing.address.address_id, data)
        setAddresses(addresses.map((a) => (a.address_id === updated.address_id ? updated : a)))
      }
      setEditing(null)
    } catch {
      setError('Could not save the address. Please check the fields and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(id: string) {
    if (!addresses) return
    setError(null)
    try {
      await deleteAddress(id)
      setAddresses(addresses.filter((a) => a.address_id !== id))
      setConfirmDelete(null)
    } catch {
      setError('Could not delete the address. Please try again.')
    }
  }

  if (loadError)
    return (
      <p role="alert" className="p-4 text-danger">
        Could not load your addresses.
      </p>
    )
  if (!addresses)
    return (
      <p role="status" className="p-4">
        Loading…
      </p>
    )

  const initial = editing?.mode === 'edit' ? editing.address : null

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/account" className="text-terracotta underline">
        ← My account
      </Link>
      <h1 className="mt-2 font-serif text-4xl">Saved addresses</h1>
      <p className="mt-1 text-muted">We currently deliver only within Lahore.</p>

      {addresses.length === 0 && !editing && (
        <p className="mt-6">You have no saved addresses yet.</p>
      )}
      <ul className="mt-6 flex flex-col gap-3">
        {addresses.map((a) => (
          <li key={a.address_id} className="rounded-xl border border-sand bg-white p-4">
            {a.label && <p className="font-semibold">{a.label}</p>}
            <p>
              {[a.house_no, a.street_number, a.city, a.province, a.postal_code, a.country]
                .filter(Boolean)
                .join(', ')}
            </p>
            <div className="mt-2 flex gap-4">
              <button
                type="button"
                className="text-terracotta underline"
                onClick={() => {
                  setError(null)
                  setEditing({ mode: 'edit', address: a })
                }}
              >
                Edit
              </button>
              {confirmDelete === a.address_id ? (
                <>
                  <button
                    type="button"
                    className="text-danger underline"
                    onClick={() => void onDelete(a.address_id)}
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setConfirmDelete(null)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="text-danger underline"
                  onClick={() => setConfirmDelete(a.address_id)}
                >
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!editing && (
        <button
          type="button"
          className={`${buttonClass} mt-6`}
          onClick={() => {
            setError(null)
            setEditing({ mode: 'new' })
          }}
        >
          Add address
        </button>
      )}
      {!editing && <FormError message={error} />}

      {editing && (
        <form
          key={initial?.address_id ?? 'new'}
          onSubmit={onSubmit}
          className="mt-6 flex flex-col gap-4 rounded-xl border border-sand bg-white p-4"
          aria-label={editing.mode === 'new' ? 'New address' : 'Edit address'}
        >
          <Field
            id="label"
            name="label"
            label="Label (e.g. Home)"
            defaultValue={initial?.label ?? ''}
            maxLength={50}
          />
          <Field
            id="house_no"
            name="house_no"
            label="House number"
            defaultValue={initial?.house_no ?? ''}
            maxLength={100}
            required
          />
          <Field
            id="street_number"
            name="street_number"
            label="Street number"
            defaultValue={initial?.street_number ?? ''}
            maxLength={100}
          />
          <Field
            id="city"
            name="city"
            label="City"
            defaultValue={initial?.city ?? 'Lahore'}
            maxLength={100}
            required
          />
          <Field
            id="province"
            name="province"
            label="Province"
            defaultValue={initial?.province ?? ''}
            maxLength={100}
          />
          <Field
            id="postal_code"
            name="postal_code"
            label="Postal code"
            defaultValue={initial?.postal_code ?? ''}
            maxLength={20}
            required
          />
          <Field
            id="country"
            name="country"
            label="Country"
            defaultValue={initial?.country ?? 'Pakistan'}
            maxLength={100}
            required
          />
          <FormError message={error} />
          <div className="flex gap-3">
            <button type="submit" className={buttonClass} disabled={busy}>
              {busy ? 'Saving…' : 'Save address'}
            </button>
            <button type="button" className="underline" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </main>
  )
}
