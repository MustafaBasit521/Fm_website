import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { useCart } from '../cart/context'
import { getPublicSettings, type BusinessSettings } from '../lib/api'
import { NotificationsLink } from '../pages/NotificationsLink'
import { Drawer } from './Drawer'
import { ShopName } from './ShopName'
import { BagIcon, HeartIcon, MenuIcon, SearchIcon, UserIcon } from './icons'

const NAV: [string, string][] = [
  ['/shop', 'Shop'],
  ['/gallery', 'Gallery'],
  ['/custom-order', 'Custom order'],
  ['/contact', 'Contact'],
]

const iconButton =
  'relative inline-flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-cream-200 focus-visible:outline-2 focus-visible:outline-terracotta'

function useShopSettings() {
  const [settings, setSettings] = useState<BusinessSettings | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    getPublicSettings(controller.signal)
      .then(setSettings)
      .catch(() => {}) // the shop works without these details
    return () => controller.abort()
  }, [])
  return settings
}

function SearchBar({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const term = input.current?.value.trim() ?? ''
    navigate(term ? `/shop?search=${encodeURIComponent(term)}` : '/shop')
    onDone()
  }
  return (
    <form
      role="search"
      onSubmit={onSubmit}
      onKeyDown={(e) => e.key === 'Escape' && onDone()}
      className="border-t border-sand bg-cream-100"
    >
      <div className="mx-auto flex max-w-6xl flex-nowrap items-center gap-3 px-4 py-3">
        <label htmlFor="site-search" className="sr-only">
          Search the shop
        </label>
        <input
          id="site-search"
          ref={input}
          type="search"
          maxLength={100}
          placeholder="Search the shop"
          className="min-w-0 flex-1 rounded-full border border-sand bg-paper px-4 py-2 focus:outline-2 focus:outline-offset-2 focus:outline-terracotta"
        />
        <button type="submit" className="rounded-full bg-ink px-5 py-2 font-semibold text-cream">
          Search
        </button>
      </div>
    </form>
  )
}

function SiteHeader({ name }: { name: string }) {
  const { session, signOut } = useAuth()
  const { units } = useCart()
  const [searching, setSearching] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const signedIn = session !== null

  return (
    <header className="sticky top-0 z-40 border-b border-sand bg-cream-100">
      <div className="mx-auto grid max-w-6xl grid-cols-[1fr_auto_1fr] items-center px-2 py-2 md:px-4">
        <div className="flex items-center">
          <button
            type="button"
            className={`${iconButton} md:hidden`}
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
          >
            <MenuIcon />
          </button>
          <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
            {NAV.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `underline-offset-4 hover:underline ${isActive ? 'font-semibold underline' : ''}`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>

        <Link
          to="/"
          aria-label={`${name}, home`}
          className="px-2 text-center font-serif text-2xl leading-tight md:text-3xl"
        >
          <ShopName name={name} />
        </Link>

        <div className="flex items-center justify-end">
          <button
            type="button"
            className={iconButton}
            aria-label="Search"
            aria-expanded={searching}
            onClick={() => setSearching((s) => !s)}
          >
            <SearchIcon />
          </button>
          {signedIn && (
            <Link
              to="/wishlist"
              className={`${iconButton} hidden sm:inline-flex`}
              aria-label="Wishlist"
            >
              <HeartIcon />
            </Link>
          )}
          <Link
            to={signedIn ? '/account' : '/login'}
            className={`${iconButton} hidden sm:inline-flex`}
            aria-label={signedIn ? 'My account' : 'Log in'}
          >
            <UserIcon />
          </Link>
          <Link
            to="/cart"
            className={iconButton}
            aria-label={units > 0 ? `Bag, ${units} items` : 'Bag'}
          >
            <BagIcon />
            {units > 0 && (
              <span
                aria-hidden="true"
                className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-terracotta px-1 text-xs font-semibold text-white"
              >
                {units}
              </span>
            )}
          </Link>
        </div>
      </div>
      {searching && <SearchBar onDone={() => setSearching(false)} />}

      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" side="left">
        <nav aria-label="Menu" className="flex flex-col gap-1 text-lg">
          {NAV.map(([to, label]) => (
            <Link key={to} to={to} className="rounded-lg px-2 py-3 hover:bg-cream-200">
              {label}
            </Link>
          ))}
          <hr className="my-3 border-sand" />
          {signedIn ? (
            <>
              <Link to="/account" className="rounded-lg px-2 py-3 hover:bg-cream-200">
                My account
              </Link>
              <Link to="/orders" className="rounded-lg px-2 py-3 hover:bg-cream-200">
                My orders
              </Link>
              <Link to="/wishlist" className="rounded-lg px-2 py-3 hover:bg-cream-200">
                Wishlist
              </Link>
              <div className="px-2 py-3">
                <NotificationsLink />
              </div>
              <button
                type="button"
                className="rounded-lg px-2 py-3 text-left text-terracotta hover:bg-cream-200"
                onClick={() => void signOut()}
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="rounded-lg px-2 py-3 hover:bg-cream-200">
                Log in
              </Link>
              <Link to="/register" className="rounded-lg px-2 py-3 hover:bg-cream-200">
                Create account
              </Link>
            </>
          )}
        </nav>
      </Drawer>
    </header>
  )
}

function SiteFooter({ settings, name }: { settings: BusinessSettings | null; name: string }) {
  const wa = settings?.whatsapp?.replace(/[^\d]/g, '')
  const social = Object.entries(settings?.social_links ?? {})
  return (
    <footer className="mt-16 border-t border-sand bg-cream-200">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
        <div>
          <p className="font-serif text-2xl">
            <ShopName name={name} />
          </p>
          <p className="mt-2 text-bark">Handmade crochet, made with care in Lahore.</p>
        </div>
        <nav aria-label="Footer">
          <p className="font-semibold">Shop</p>
          <ul className="mt-2 flex flex-col gap-1">
            {NAV.map(([to, label]) => (
              <li key={to}>
                <Link to={to} className="underline-offset-4 hover:underline">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <p className="font-semibold">Get in touch</p>
          <ul className="mt-2 flex flex-col gap-1">
            {wa && (
              <li>
                <a
                  href={`https://wa.me/${wa}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-4 hover:underline"
                >
                  WhatsApp
                </a>
              </li>
            )}
            {settings?.phone && <li>{settings.phone}</li>}
            {settings?.email && <li>{settings.email}</li>}
            {settings?.address && <li>{settings.address}</li>}
            {social.map(([key, url]) => (
              <li key={key}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-4 hover:underline"
                >
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="border-t border-sand py-4 text-center text-sm text-bark">
        © {new Date().getFullYear()} {name}
      </p>
    </footer>
  )
}

/** The frame around every shop page: announcement bar, header, the page, footer. */
export default function ShopLayout() {
  const location = useLocation()
  const settings = useShopSettings()
  const name = settings?.business_name ?? 'Bundle of Loops'
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-paper focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <p className="bg-ink px-4 py-2 text-center text-sm text-cream">
        Delivering across Lahore · Cash on Delivery available
      </p>
      {/* keyed by the address, so the menu and search bar start closed on every page change */}
      <SiteHeader key={location.pathname + location.search} name={name} />
      <div id="main-content" className="flex-1">
        <Outlet />
      </div>
      <SiteFooter settings={settings} name={name} />
    </div>
  )
}
