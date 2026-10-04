import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { getUnreadCount } from '../lib/api'

/** "Notifications (n)" for signed-in customers; renders nothing when signed out. */
export function NotificationsLink() {
  const { session } = useAuth()
  const signedIn = session !== null
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (!signedIn) return
    const controller = new AbortController()
    getUnreadCount(controller.signal)
      .then((r) => setUnread(r.unread))
      .catch(() => {})
    return () => controller.abort()
  }, [signedIn])

  if (!signedIn) return null
  return (
    <Link to="/notifications" className="text-terracotta underline">
      Notifications{unread > 0 ? ` (${unread})` : ''}
    </Link>
  )
}
