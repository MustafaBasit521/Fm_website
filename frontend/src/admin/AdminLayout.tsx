import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/context'

const SHOP_URL = (import.meta.env.VITE_SHOP_URL as string | undefined) ?? 'http://localhost:5173'

const LINKS: [string, string][] = [
  ['/', 'Dashboard'],
  ['/orders', 'Orders'],
  ['/products', 'Products'],
  ['/categories', 'Categories'],
  ['/customers', 'Customers'],
  ['/gallery', 'Gallery'],
  ['/custom-orders', 'Custom orders'],
  ['/messages', 'Messages'],
  ['/reviews', 'Reviews'],
  ['/activity', 'Activity log'],
  ['/settings', 'Settings'],
]

export default function AdminLayout() {
  const { signOut } = useAuth()
  return (
    <div className="min-h-screen md:flex">
      <nav
        aria-label="Admin"
        className="border-b border-sand bg-paper p-4 md:w-56 md:border-b-0 md:border-r"
      >
        <p className="font-serif text-2xl">Shop admin</p>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 md:flex-col md:gap-y-2">
          {LINKS.map(([to, label]) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
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
          <a
            href={SHOP_URL}
            className="text-terracotta underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            View shop
          </a>
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
