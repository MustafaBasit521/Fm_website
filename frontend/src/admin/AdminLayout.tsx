import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/context'

const LINKS: [string, string][] = [
  ['/admin', 'Dashboard'],
  ['/admin/orders', 'Orders'],
  ['/admin/products', 'Products'],
  ['/admin/categories', 'Categories'],
  ['/admin/customers', 'Customers'],
  ['/admin/gallery', 'Gallery'],
  ['/admin/custom-orders', 'Custom orders'],
  ['/admin/messages', 'Messages'],
  ['/admin/reviews', 'Reviews'],
  ['/admin/settings', 'Settings'],
]

export function AdminLayout() {
  const { signOut } = useAuth()
  return (
    <div className="min-h-screen md:flex">
      <nav
        aria-label="Admin"
        className="border-b border-sand bg-cream-100 p-4 md:w-56 md:border-b-0 md:border-r"
      >
        <p className="font-serif text-2xl">Shop admin</p>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 md:flex-col md:gap-y-2">
          {LINKS.map(([to, label]) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/admin'}
                className={({ isActive }) =>
                  `underline-offset-4 ${isActive ? 'font-semibold text-terracotta underline' : 'text-bark hover:underline'}`
                }
              >
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
        <p className="mt-4 flex flex-wrap gap-4 text-sm md:flex-col md:gap-1">
          <Link to="/" className="text-terracotta underline">
            View shop
          </Link>
          <button
            type="button"
            className="text-left text-terracotta underline"
            onClick={() => void signOut()}
          >
            Log out
          </button>
        </p>
      </nav>
      <div className="flex-1 px-4 py-6 md:px-8">
        <Outlet />
      </div>
    </div>
  )
}
