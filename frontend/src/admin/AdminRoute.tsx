import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { getAdminMe } from '../lib/adminApi'

/** Sends signed-out visitors to the login page and tells non-admins they have no access.
 *  UX only: every admin API call is authorized by the backend. */
export function AdminRoute() {
  const { session, loading } = useAuth()
  const location = useLocation()
  const userId = session?.user.id ?? null
  const [checked, setChecked] = useState<{ userId: string; admin: boolean } | null>(null)

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    getAdminMe(controller.signal)
      .then(() => setChecked({ userId, admin: true }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        // 403 = not an admin; any other failure also shows no admin access
        setChecked({ userId, admin: false })
      })
    return () => controller.abort()
  }, [userId])

  if (loading)
    return (
      <p role="status" className="p-4">
        Loading…
      </p>
    )
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (checked?.userId !== userId)
    return (
      <p role="status" className="p-4">
        Checking access…
      </p>
    )
  if (!checked.admin) {
    return (
      <main className="mx-auto max-w-xl px-4 py-8">
        <h1 className="font-serif text-4xl">No access</h1>
        <p role="alert" className="mt-4">
          This area is only for the shop admin.
        </p>
      </main>
    )
  }
  return <Outlet />
}
