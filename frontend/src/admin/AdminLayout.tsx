import { useEffect, useState, type ComponentType, type SVGProps } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { getDashboard } from '../lib/adminApi'
import { getPublicSettings } from '../lib/api'
import { Drawer } from '../shop/Drawer'
import { MenuIcon } from '../shop/icons'
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

function NavGroups({ counts }: { counts: Record<Badge, number> }) {
  return (
    <div className="flex flex-col gap-5">
      {GROUPS.map((group) => (
        <div key={group.title ?? 'main'} className="flex flex-col gap-1">
          {group.title && (
            <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-widest text-bark">
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
                  `flex flex-nowrap items-center gap-2.5 whitespace-nowrap rounded-[10px] px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-dashed focus-visible:outline-bark ${isActive ? 'bg-paper font-semibold text-ink shadow-sm' : 'text-bark hover:bg-cream-100'}`
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
  )
}

function AccountLinks({ signOut }: { signOut: () => Promise<void> }) {
  return (
    <div className="flex flex-col gap-3">
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
  )
}

/** The phone header: the logo and a button that slides the whole menu in from the left. The menu
 *  closes by itself on every page change (this component is keyed by the address). */
function MobileHeader({
  name,
  counts,
  signOut,
}: {
  name: string
  counts: Record<Badge, number>
  signOut: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const waiting = counts.orders + counts.messages + counts.custom
  return (
    <header className="flex items-center justify-between border-b border-sand bg-cream-200 px-4 py-3 md:hidden">
      <Logo name={name} />
      <button
        type="button"
        aria-label={waiting > 0 ? `Open menu, ${waiting} new` : 'Open menu'}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-cream-100 focus-visible:outline-2 focus-visible:outline-dashed focus-visible:outline-bark"
      >
        <MenuIcon />
        {waiting > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 h-3 w-3 rounded-full bg-terracotta"
          />
        )}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Menu" side="left">
        <nav aria-label="Admin menu" className="flex flex-col gap-6">
          <NavGroups counts={counts} />
          <AccountLinks signOut={signOut} />
        </nav>
      </Drawer>
    </header>
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
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-paper focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <MobileHeader key={pathname} name={name} counts={counts} signOut={signOut} />
      <nav
        aria-label="Admin"
        className="hidden border-r border-sand bg-cream-200 p-4 md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:overflow-y-auto"
      >
        <Logo name={name} />
        <div className="mt-6">
          <NavGroups counts={counts} />
        </div>
        <div className="mt-auto pt-6">
          <AccountLinks signOut={signOut} />
        </div>
      </nav>
      <main id="main-content" className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
        <Outlet />
      </main>
    </div>
  )
}
