import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/context'
import { supabase } from '../lib/supabase'
import { buttonClass, Field, FormError } from '../pages/ui'

type Phase =
  | { name: 'loading' }
  | { name: 'error' }
  | { name: 'verify'; factorId: string }
  | { name: 'enroll'; factorId: string; qr: string; secret: string }

/** The second login step for the admin (authenticator-app code). First time: scan the QR code to
 *  set the app up. Afterwards: type the current 6-digit code. */
export function MfaStep({ onDone }: { onDone: () => void }) {
  const { signOut } = useAuth()
  const [phase, setPhase] = useState<Phase>({ name: 'loading' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function start() {
      const { data, error: listError } = await supabase.auth.mfa.listFactors()
      if (cancelled) return
      if (listError || !data) return setPhase({ name: 'error' })
      const verified = data.totp[0] // `totp` holds only verified authenticator factors
      if (verified) return setPhase({ name: 'verify', factorId: verified.id })

      // An earlier, never-finished setup would block a new one: remove it first.
      for (const stale of data.all.filter(
        (f) => f.factor_type === 'totp' && f.status === 'unverified',
      ))
        await supabase.auth.mfa.unenroll({ factorId: stale.id })
      const enrolled = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Shop admin',
      })
      if (cancelled) return
      if (enrolled.error || !enrolled.data) return setPhase({ name: 'error' })
      setPhase({
        name: 'enroll',
        factorId: enrolled.data.id,
        qr: enrolled.data.totp.qr_code,
        secret: enrolled.data.totp.secret,
      })
    }
    void start()
    return () => {
      cancelled = true
    }
  }, [])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (phase.name !== 'verify' && phase.name !== 'enroll') return
    const code = String(new FormData(e.currentTarget).get('code') ?? '').replace(/\s/g, '')
    if (!/^\d{6}$/.test(code))
      return setError('Enter the 6-digit code from your authenticator app.')
    setBusy(true)
    setError(null)
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: phase.factorId,
      code,
    })
    setBusy(false)
    if (verifyError)
      return setError('That code did not work. Check your authenticator app and try again.')
    onDone()
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="font-serif text-4xl">
        {phase.name === 'enroll' ? 'Set up two-factor login' : 'Two-factor login'}
      </h1>
      {phase.name === 'loading' && <p role="status">Loading…</p>}
      {phase.name === 'error' && (
        <p role="alert" className="text-danger">
          Could not start two-factor login. Please reload the page and try again.
        </p>
      )}
      {(phase.name === 'verify' || phase.name === 'enroll') && (
        <>
          {phase.name === 'enroll' ? (
            <>
              <p>
                The admin area needs a second step. Open an authenticator app (Google Authenticator,
                Microsoft Authenticator, Authy…) and scan this code:
              </p>
              <img
                src={phase.qr}
                alt="QR code to scan with your authenticator app"
                className="mx-auto h-48 w-48 bg-paper p-2"
              />
              <p className="text-sm text-muted">
                Cannot scan? Enter this key in the app instead:{' '}
                <code className="break-all">{phase.secret}</code>
              </p>
              <p>Then type the 6-digit code the app shows.</p>
            </>
          ) : (
            <p>Enter the 6-digit code from your authenticator app.</p>
          )}
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <Field
              id="code"
              name="code"
              label="6-digit code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              required
            />
            <FormError message={error} />
            <button type="submit" className={buttonClass} disabled={busy}>
              {busy ? 'Checking…' : 'Verify'}
            </button>
          </form>
        </>
      )}
      <button
        type="button"
        className="text-left text-terracotta underline"
        onClick={() => void signOut()}
      >
        Log out
      </button>
    </main>
  )
}
