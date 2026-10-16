import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { PageHeader } from './PageHeader'
import { buttonClass, Field, FormError } from './ui'

export default function RegisterPage() {
  const { session, signUp } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [confirmEmail, setConfirmEmail] = useState(false)
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to="/account" replace />

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const name = String(form.get('name')).trim()
    if (!name) return setError('Please enter your name.')
    setBusy(true)
    setError(null)
    try {
      const signedIn = await signUp(name, String(form.get('email')), String(form.get('password')))
      if (signedIn) navigate('/account', { replace: true })
      else setConfirmEmail(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.')
    } finally {
      setBusy(false)
    }
  }

  if (confirmEmail) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-4 px-4 py-10">
        <PageHeader eyebrow="Almost there" title="Check your email" />
        <p role="status" className="rounded-[18px] border border-sand bg-paper p-6 text-bark">
          We sent you a confirmation link. Open it, then{' '}
          <Link to="/login" className="text-terracotta underline">
            log in
          </Link>
          .
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-5 px-4 py-10">
      <PageHeader eyebrow="Join us" title="Create account" />
      <form
        onSubmit={onSubmit}
        aria-label="Create account"
        className="flex flex-col gap-4 rounded-[18px] border border-sand bg-paper p-6"
      >
        <Field id="name" name="name" label="Name" autoComplete="name" maxLength={100} required />
        <Field id="email" name="email" label="Email" type="email" autoComplete="email" required />
        <Field
          id="password"
          name="password"
          label="Password (at least 8 characters)"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <FormError message={error} />
        <button type="submit" className={`${buttonClass} w-full`} disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p className="text-bark">
        Already registered?{' '}
        <Link to="/login" className="text-terracotta underline">
          Log in
        </Link>
      </p>
    </main>
  )
}
