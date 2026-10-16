import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { useCart } from '../cart/context'
import { getPublicSettings, type BusinessSettings } from '../lib/api'
import { NotificationsLink } from '../pages/NotificationsLink'
import { useWishlist } from '../wishlist/context'
import { useShopWhatsapp, waDigits, waLink } from '../lib/whatsapp'
import { BagDrawer } from './BagDrawer'
import { Drawer } from './Drawer'
import { NewsletterSignup } from './NewsletterSignup'
import { SearchSheet } from './SearchSheet'
import { WishlistDrawer } from './WishlistDrawer'
import { ShopName } from './ShopName'
import { BagIcon, ChatIcon, HeartIcon, MenuIcon, SearchIcon, UserIcon } from './icons'

const NAV: [string, string][] = [
  ['/shop', 'Shop'],
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

function SiteHeader({ name }: { name: string }) {
  const { session, signOut } = useAuth()
  const { units } = useCart()
  const wl = useWishlist()
  const saved = wl.ids?.size ?? 0
  const [searching, setSearching] = useState(false)
  const [bagOpen, setBagOpen] = useState(false)
  const [wishOpen, setWishOpen] = useState(false)
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
            aria-haspopup="dialog"
            onClick={() => setSearching(true)}
          >
            <SearchIcon />
          </button>
          <button
            type="button"
            className={`${iconButton} hidden sm:inline-flex`}
            aria-label={saved > 0 ? `Wishlist, ${saved} saved` : 'Wishlist'}
            aria-haspopup="dialog"
            onClick={() => setWishOpen(true)}
          >
            <HeartIcon />
            {saved > 0 && (
              <span
                aria-hidden="true"
                className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-terracotta px-1 text-xs font-semibold text-white"
              >
                {saved}
              </span>
            )}
          </button>
          <Link
            to={signedIn ? '/account' : '/login'}
            className={`${iconButton} hidden sm:inline-flex`}
            aria-label={signedIn ? 'My account' : 'Log in'}
          >
            <UserIcon />
          </Link>
          <button
            type="button"
            className={iconButton}
            aria-label={units > 0 ? `Bag, ${units} items` : 'Bag'}
            aria-haspopup="dialog"
            onClick={() => setBagOpen(true)}
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
          </button>
        </div>
      </div>
      <SearchSheet open={searching} onClose={() => setSearching(false)} />
      <BagDrawer open={bagOpen} onClose={() => setBagOpen(false)} />
      <WishlistDrawer open={wishOpen} onClose={() => setWishOpen(false)} />

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
  const wa = waDigits(settings?.whatsapp)
  const social = Object.entries(settings?.social_links ?? {})
  const link =
    'underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-linen'
  return (
    <footer className="mt-16 bg-ink text-cream">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="font-serif text-3xl">
            <ShopName name={name} />
          </p>
          <p className="mt-2 max-w-sm text-linen">
            Handmade crochet, made with care in Lahore. Your idea, our crochet.
          </p>
          {(wa || social.length > 0) && (
            <p className="mt-5 flex flex-wrap gap-2">
              {wa && (
                <a
                  href={waLink(wa)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-10 items-center rounded-full bg-paper px-4 text-sm font-semibold text-ink hover:opacity-90"
                >
                  WhatsApp
                </a>
              )}
              {social.map(([key, url]) => (
                <a
                  key={key}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-10 items-center rounded-full border border-linen px-4 text-sm font-semibold text-cream hover:bg-bark"
                >
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                </a>
              ))}
            </p>
          )}
        </div>
        <nav aria-label="Footer">
          <p className="font-semibold">Explore</p>
          <ul className="mt-3 flex flex-col gap-2 text-linen">
            {[...NAV, ['/gallery', 'Gallery']].map(([to, label]) => (
              <li key={to}>
                <Link to={to} className={link}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {(settings?.phone || settings?.email || settings?.address) && (
          <div>
            <p className="font-semibold">Get in touch</p>
            <ul className="mt-3 flex flex-col gap-2 text-linen">
              {settings?.phone && <li>{settings.phone}</li>}
              {settings?.email && <li>{settings.email}</li>}
              {settings?.address && <li>{settings.address}</li>}
            </ul>
          </div>
        )}
      </div>
      <p className="mx-auto max-w-6xl border-t border-dashed border-bark px-4 py-4 text-center text-sm text-linen">
        © {new Date().getFullYear()} {name}
      </p>
    </footer>
  )
}

/** A round WhatsApp button fixed to the corner of every page (hidden until a number is set). */
function FloatingWhatsApp() {
  const digits = useShopWhatsapp()
  if (!digits) return null
  return (
    <a
      href={waLink(digits, 'Hi! I have a question about Bundle of Loops.')}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat on WhatsApp (opens in a new tab)"
      className="fixed bottom-4 right-4 z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-moss-dark text-white shadow-lg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dashed focus-visible:outline-bark"
    >
      <ChatIcon width={26} height={26} />
    </a>
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
      <NewsletterSignup />
      <SiteFooter settings={settings} name={name} />
      <FloatingWhatsApp />
    </div>
  )
}
