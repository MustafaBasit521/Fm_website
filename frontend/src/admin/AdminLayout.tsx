import { useEffect, useState, type ComponentType, type SVGProps } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { getDashboard } from '../lib/adminApi'
import { getPublicSettings } from '../lib/api'
import {
  ArrowUpRightIcon,
  BagIcon,
  BoxIcon,
  ChatIcon,
  HomeIcon,
  ImageIcon,
  ListIcon,
  ScissorsIcon,
  SlidersIcon,
  StarIcon,
  TagIcon,
  UsersIcon,
} from './icons'

const SHOP_URL = (import.meta.env.VITE_SHOP_URL as string | undefined) ?? 'http://localhost:5173'

type Badge = 'orders' | 'messages' | 'custom'
type Item = {
  to: string
  label: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  badge?: Badge
}
const GROUPS: { title: string | null; items: Item[] }[] = [
  { title: null, items: [{ to: '/', label: 'Overview', Icon: HomeIcon }] },
  {
    title: 'Shop',
    items: [
      { to: '/orders', label: 'Orders', Icon: BoxIcon, badge: 'orders' },
      { to: '/products', label: 'Products', Icon: BagIcon },
      { to: '/categories', label: 'Categories', Icon: TagIcon },
    ],
  },
  {
    title: 'Content',
    items: [
      { to: '/gallery', label: 'Gallery', Icon: ImageIcon },
      { to: '/custom-orders', label: 'Custom orders', Icon: ScissorsIcon, badge: 'custom' },
      { to: '/reviews', label: 'Reviews', Icon: StarIcon },
    ],
  },
  {
    title: 'Customers',
    items: [
      { to: '/customers', label: 'Customers', Icon: UsersIcon },
      { to: '/messages', label: 'Messages', Icon: ChatIcon, badge: 'messages' },
    ],
  },
  {
    title: 'Studio',
    items: [
      { to: '/activity', label: 'Activity log', Icon: ListIcon },
      { to: '/settings', label: 'Settings', Icon: SlidersIcon },
    ],
  },
]

/** The shop name as a logo (the italic "of"), taken from the public settings. */
function Logo({ name }: { name: string }) {
  const m = /^(.+?)\s+(of)\s+(.+)$/i.exec(name)
  return (
    <p className="font-serif text-2xl leading-tight">
      {m ? (
        <>
          {m[1]} <em className="text-terracotta">{m[2]}</em> {m[3]}
        </>
      ) : (
        name
      )}
      <span className="block font-sans text-[10px] font-medium uppercase tracking-widest text-bark">
        Studio admin
      </span>
    </p>
  )
}

export default function AdminLayout() {
  const { signOut } = useAuth()
  const { pathname } = useLocation()
  const [name, setName] = useState('Bundle of Loops')
  const [counts, setCounts] = useState<Record<Badge, number>>({ orders: 0, messages: 0, custom: 0 })

  useEffect(() => {
    getPublicSettings()
      .then((s) => s.business_name && setName(s.business_name))
      .catch(() => {}) // the default name is fine
  }, [])

  // the number badges are refreshed whenever the admin moves to another page
  useEffect(() => {
    const controller = new AbortController()
    getDashboard(controller.signal)
      .then((d) =>
        setCounts({
          orders: d.orders_needing_action,
          messages: d.new_messages,
          custom: d.new_custom_orders,
        }),
      )
      .catch(() => {}) // badges are a convenience
    return () => controller.abort()
  }, [pathname])

  return (
    <div className="min-h-screen md:flex">
      <nav
        aria-label="Admin"
        className="border-b border-sand bg-cream-200 p-4 md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r"
      >
        <Logo name={name} />
        <div className="mt-4 flex flex-nowrap gap-x-5 overflow-x-auto pb-1 md:mt-6 md:flex-col md:gap-y-5 md:overflow-visible">
          {GROUPS.map((group) => (
            <div key={group.title ?? 'main'} className="flex flex-nowrap gap-1 md:flex-col">
              {group.title && (
                <p className="hidden px-3 pb-1 text-[11px] font-medium uppercase tracking-widest text-bark md:block">
                  {group.title}
                </p>
              )}
              {group.items.map(({ to, label, Icon, badge }) => {
                const count = badge ? counts[badge] : 0
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) =>
                      `flex shrink-0 flex-nowrap items-center gap-2.5 whitespace-nowrap rounded-[10px] px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-dashed focus-visible:outline-bark ${isActive ? 'bg-paper font-semibold text-ink shadow-sm' : 'text-bark hover:bg-cream-100'}`
                    }
                  >
                    <Icon />
                    {label}
                    {count > 0 && (
                      <span
                        aria-label={`${count} new`}
                        className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold text-white ${badge === 'orders' ? 'bg-terracotta' : 'bg-ink'}`}
                      >
                        {count}
                      </span>
                    )}
                  </NavLink>
                )
              })}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-3 md:mt-auto md:flex-col md:pt-6">
          <a
            href={SHOP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-between gap-2 rounded-[10px] border border-dashed border-linen px-3 py-2 text-sm hover:bg-cream-100"
          >
            View shop <ArrowUpRightIcon />
          </a>
          <button
            type="button"
            className="px-3 py-1 text-left text-sm text-terracotta underline"
            onClick={() => void signOut()}
          >
            Log out
          </button>
        </div>
      </nav>
      <div className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
        <Outlet />
      </div>
    </div>
  )
}
