import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { PageHeader } from './PageHeader'
import { buttonClass, Field, FormError } from './ui'

export default function LoginPage() {
  const { session, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/account'
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to={from} replace />

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    try {
      await signIn(String(form.get('email')), String(form.get('password')))
      navigate(from, { replace: true })
    } catch {
      // Generic on purpose: do not reveal whether the email exists.
      setError('Incorrect email or password, or the email is not confirmed yet.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-5 px-4 py-10">
      <PageHeader eyebrow="Welcome back" title="Log in" />
      <form
        onSubmit={onSubmit}
        aria-label="Log in"
        className="flex flex-col gap-4 rounded-[18px] border border-sand bg-paper p-6"
      >
        <Field id="email" name="email" label="Email" type="email" autoComplete="email" required />
        <Field
          id="password"
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
        />
        <FormError message={error} />
        <button type="submit" className={`${buttonClass} w-full`} disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="text-bark">
        New here?{' '}
        <Link to="/register" className="text-terracotta underline">
          Create an account
        </Link>
      </p>
    </main>
  )
}
