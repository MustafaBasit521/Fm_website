import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { getAdminMe } from '../lib/adminApi'
import { ApiError } from '../lib/api'
import { buttonClass } from '../pages/ui'
import { MfaStep } from './MfaStep'

type Access = 'no-access' | 'error' | 'mfa' | 'ok'

/** The door to the admin site. It asks the server who the user is (admin role) and whether the
 *  second factor is done, and shows the matching screen. This is a convenience: the backend
 *  independently refuses every admin request that lacks the role or the second factor. */
export function AdminRoute() {
  const { session, loading, signOut } = useAuth()
  const location = useLocation()
  const userId = session?.user.id ?? null
  const token = session?.access_token ?? null
  const [attempt, setAttempt] = useState(0)
  // The token changes after the second factor is verified, which re-runs the check.
  const key = `${userId}:${token}:${attempt}`
  const [checked, setChecked] = useState<{ key: string; access: Access } | null>(null)

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    getAdminMe(controller.signal)
      .then((me) => setChecked({ key, access: me.mfa_required && !me.mfa_verified ? 'mfa' : 'ok' }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setChecked({
          key,
          access: e instanceof ApiError && e.status === 403 ? 'no-access' : 'error',
        })
      })
    return () => controller.abort()
  }, [userId, key])

  if (loading)
    return (
      <p role="status" className="p-4">
        Loading…
      </p>
    )
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (checked?.key !== key)
    return (
      <p role="status" className="p-4">
        Checking access…
      </p>
    )

  if (checked.access === 'no-access') {
    return (
      <main className="mx-auto max-w-xl px-4 py-8">
        <h1 className="font-serif text-4xl">No access</h1>
        <p role="alert" className="mt-4">
          This account is not the shop admin.
        </p>
        <button type="button" className={`${buttonClass} mt-4`} onClick={() => void signOut()}>
          Log out
        </button>
      </main>
    )
  }
  if (checked.access === 'error') {
    return (
      <main className="mx-auto max-w-xl px-4 py-8">
        <h1 className="font-serif text-4xl">Could not check your access</h1>
        <p role="alert" className="mt-4 text-danger">
          The server did not answer. Please try again.
        </p>
        <button
          type="button"
          className={`${buttonClass} mt-4`}
          onClick={() => setAttempt((n) => n + 1)}
        >
          Try again
        </button>
      </main>
    )
  }
  if (checked.access === 'mfa') return <MfaStep onDone={() => setAttempt((n) => n + 1)} />
  return <Outlet />
}
