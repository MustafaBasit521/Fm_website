import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { getAdminMe } from '../lib/adminApi'

/** A link to the admin area, shown only to the admin. The server decides who is admin; a failed
 *  check just means no link (never an error message). */
export function AdminLink() {
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const [adminFor, setAdminFor] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    getAdminMe(controller.signal)
      .then(() => setAdminFor(userId))
      .catch(() => setAdminFor(null))
    return () => controller.abort()
  }, [userId])

  if (!userId || adminFor !== userId) return null
  return (
    <Link to="/admin" className="text-terracotta underline">
      Admin
    </Link>
  )
}
