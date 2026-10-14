import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { buttonClass, Field, FormError } from '../pages/ui'

/** Admin login. There is deliberately no "create account" here: the admin account is created
 *  by the shop owner and given its role on the server. */
export default function AdminLoginPage() {
  const { session, signIn } = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
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
    } catch {
      // Generic on purpose: do not reveal whether the email exists.
      setError('Incorrect email or password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="font-serif text-4xl">Shop admin</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field
          id="email"
          name="email"
          label="Email"
          type="email"
          autoComplete="username"
          required
        />
        <Field
          id="password"
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
        />
        <FormError message={error} />
        <button type="submit" className={buttonClass} disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </main>
  )
}
