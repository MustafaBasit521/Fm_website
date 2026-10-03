import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './context'

/** UX only: hides pages from signed-out users. The backend is the real security boundary. */
export function ProtectedRoute() {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) return <p role="status">Loading…</p>
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}
