import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { saveCart } from '../lib/cart'
import { fakeSession, makeAuth } from '../test/auth'
import ShopLayout from './ShopLayout'

const getPublicSettings = vi.fn()
const getUnreadCount = vi.fn()
const getQuote = vi.fn()
const getProducts = vi.fn()
const getWishlist = vi.fn()
const getWishlistIds = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getPublicSettings: (...a: unknown[]) => getPublicSettings(...a),
  getUnreadCount: (...a: unknown[]) => getUnreadCount(...a),
  getQuote: (...a: unknown[]) => getQuote(...a),
  getProducts: (...a: unknown[]) => getProducts(...a),
  getWishlist: (...a: unknown[]) => getWishlist(...a),
  getWishlistIds: (...a: unknown[]) => getWishlistIds(...a),
}))

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}
const renderLayout = (auth = {}, path = '/shop') => {
  const view = makeAuth(auth)
  render(
    view.wrap(
      <Routes>
        <Route element={<ShopLayout />}>
          <Route path="*" element={<Where />} />
        </Route>
      </Routes>,
      path,
    ),
  )
  return view.ctx
}

beforeEach(() => {
  getPublicSettings.mockReset().mockResolvedValue({
    business_name: 'Bundle of Loops',
    email: 'hi@example.com',
    phone: '042 111',
    whatsapp: '+92 300 1234567',
    address: null,
    delivery_information: null,
    delivery_fee_paisa: 20000,
    social_links: { instagram: 'https://instagram.com/bol' },
  })
  getUnreadCount.mockReset().mockResolvedValue({ unread: 0 })
  getQuote.mockReset()
  getProducts.mockReset()
  getWishlist.mockReset()
  getWishlistIds.mockReset().mockResolvedValue([])
})

const product = (n: number) => ({
  product_id: `p${n}`,
  name: `Piece ${n}`,
  price_paisa: 150000,
  category: { category_id: 'c', name: 'Flowers' },
  availability_type: 'READY_TO_SHIP',
  is_available: true,
  is_featured: false,
  image: null,
})

it('shows the shop name from the settings in the header and footer, with contact details', async () => {
  renderLayout()
  const logo = await screen.findByRole('link', { name: 'Bundle of Loops, home' })
  expect(logo).toHaveAttribute('href', '/')
  expect(within(logo).getByText('of').tagName).toBe('EM') // the italic accent from the mockup
  const footer = screen.getByRole('contentinfo')
  expect(within(footer).getAllByText(/Loops/, { selector: 'p' }).length).toBeGreaterThan(0)
  expect(footer.querySelector('em')).toHaveTextContent('of')
  expect(within(footer).getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
    'href',
    'https://wa.me/923001234567',
  )
  expect(within(footer).getByText('042 111')).toBeInTheDocument()
  expect(within(footer).getByRole('link', { name: 'Instagram' })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  )
})

it('still works with a default name when the settings cannot be loaded', async () => {
  getPublicSettings.mockRejectedValue(new Error('x'))
  renderLayout()
  expect(await screen.findByRole('link', { name: 'Bundle of Loops, home' })).toBeInTheDocument()
  expect(screen.getByText(/Delivering across Lahore/)).toBeInTheDocument()
})

it('has the main links, a skip-to-content link and the page content', async () => {
  renderLayout()
  const nav = screen.getByRole('navigation', { name: 'Main' })
  for (const name of ['Shop', 'Custom order', 'Contact'])
    expect(within(nav).getByRole('link', { name })).toBeInTheDocument()
  // the gallery lives on the home page; the nav stays short
  expect(within(nav).queryByRole('link', { name: 'Gallery' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
    'href',
    '#main-content',
  )
  expect(screen.getByTestId('where')).toHaveTextContent('/shop')
})

it('shows the bag count in the header and opens the bag as a panel', async () => {
  saveCart([
    { product_id: 'a', quantity: 2 },
    { product_id: 'b', quantity: 1 },
  ])
  getQuote.mockResolvedValue({
    lines: [
      {
        product_id: 'a',
        name: 'Rose',
        quantity: 2,
        unit_price_paisa: 50000,
        line_total_paisa: 100000,
        image: null,
        issue: null,
        max_quantity: null,
      },
    ],
    subtotal_paisa: 100000,
    delivery_fee_paisa: 20000,
    total_paisa: 120000,
    can_checkout: true,
  })
  renderLayout()
  await userEvent.click(screen.getByRole('button', { name: 'Bag, 3 items' }))
  const bag = screen.getByRole('dialog', { name: 'Your bag' })
  expect(await within(bag).findByText('Rose')).toBeInTheDocument()
  expect(within(bag).getByRole('link', { name: 'Checkout' })).toHaveAttribute('href', '/checkout')
  expect(within(bag).getByRole('link', { name: 'View full bag' })).toHaveAttribute('href', '/cart')
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('the empty bag panel invites shoppers to browse', async () => {
  renderLayout()
  await userEvent.click(screen.getByRole('button', { name: 'Bag' }))
  const bag = screen.getByRole('dialog', { name: 'Your bag' })
  expect(within(bag).getByText('Your bag is empty')).toBeInTheDocument()
  expect(getQuote).not.toHaveBeenCalled()
})

it('opens the search sheet, shows live results with pictures and searches the shop', async () => {
  getProducts.mockResolvedValue({ items: [product(1)], total: 1, page: 1, page_size: 6 })
  renderLayout({}, '/gallery')
  expect(screen.queryByRole('search')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  const field = screen.getByLabelText('Search the shop')
  expect(field).toHaveFocus()
  await userEvent.type(field, 'rose')
  const result = await screen.findByRole('link', { name: /Piece 1/ })
  expect(result).toHaveAttribute('href', '/shop/p1')
  expect((getProducts.mock.calls.at(-1)![0] as URLSearchParams).get('search')).toBe('rose')
  await userEvent.type(field, ' & co{Enter}')
  expect(screen.getByTestId('where')).toHaveTextContent('/shop?search=rose%20%26%20co')
  expect(screen.queryByRole('search')).not.toBeInTheDocument() // closed after searching
})

it('does not search for a single letter, and says so when nothing matches', async () => {
  getProducts.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 6 })
  renderLayout({}, '/gallery')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await userEvent.type(screen.getByLabelText('Search the shop'), 'r')
  expect(getProducts).not.toHaveBeenCalled()
  await userEvent.type(screen.getByLabelText('Search the shop'), 'x')
  expect(await screen.findByText(/No pieces match/)).toBeInTheDocument()
})

it('an empty search just opens the shop, and Escape closes the sheet', async () => {
  renderLayout({}, '/gallery')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('search')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await userEvent.type(screen.getByLabelText('Search the shop'), '   {Enter}')
  expect(screen.getByTestId('where')).toHaveTextContent(/^\/shop$/)
})

it('signed out, the wishlist panel asks to log in', async () => {
  renderLayout()
  await userEvent.click(screen.getByRole('button', { name: 'Wishlist' }))
  const panel = screen.getByRole('dialog', { name: 'Wishlist' })
  expect(within(panel).getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
  expect(getWishlist).not.toHaveBeenCalled()
})

it('signed in, the wishlist panel lists saved pieces and the heart shows how many', async () => {
  getWishlistIds.mockResolvedValue(['p1', 'p2'])
  getWishlist.mockResolvedValue({
    items: [product(1), product(2)],
    total: 2,
    page: 1,
    page_size: 12,
  })
  renderLayout({ session: fakeSession })
  await userEvent.click(await screen.findByRole('button', { name: 'Wishlist, 2 saved' }))
  const panel = screen.getByRole('dialog', { name: 'Wishlist' })
  expect(await within(panel).findByText('Piece 2')).toBeInTheDocument()
  expect(within(panel).getByRole('link', { name: 'See all saved pieces' })).toHaveAttribute(
    'href',
    '/wishlist',
  )
})

it('has the dark footer with the gallery link and the newsletter sign-up above it', async () => {
  renderLayout()
  const footer = screen.getByRole('contentinfo')
  expect(within(footer).getByRole('link', { name: 'Gallery' })).toHaveAttribute('href', '/gallery')
  expect(screen.getByRole('heading', { name: /Join the circle/ })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Your email address' })).toBeInTheDocument()
})

it('signed out: a log-in icon and a menu with log in / create account', async () => {
  renderLayout()
  expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
  await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))
  const menu = screen.getByRole('dialog', { name: 'Menu' })
  expect(within(menu).getByRole('link', { name: 'Create account' })).toHaveAttribute(
    'href',
    '/register',
  )
  await userEvent.click(within(menu).getByRole('link', { name: 'Contact' }))
  expect(screen.getByTestId('where')).toHaveTextContent('/contact')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument() // closes after navigating
})

it('signed in: account and wishlist icons, and a menu with orders, notifications and log out', async () => {
  getUnreadCount.mockResolvedValue({ unread: 2 })
  const ctx = renderLayout({ session: fakeSession })
  expect(screen.getByRole('link', { name: 'My account' })).toHaveAttribute('href', '/account')
  expect(screen.getByRole('button', { name: 'Wishlist' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))
  const menu = screen.getByRole('dialog', { name: 'Menu' })
  expect(within(menu).getByRole('link', { name: 'My orders' })).toHaveAttribute('href', '/orders')
  expect(await within(menu).findByRole('link', { name: 'Notifications (2)' })).toBeInTheDocument()
  await userEvent.click(within(menu).getByRole('button', { name: 'Log out' }))
  expect(ctx.signOut).toHaveBeenCalled()
})

it('has a floating WhatsApp button that opens a chat with a ready-typed message', async () => {
  renderLayout()
  const chat = await screen.findByRole('link', { name: /Chat on WhatsApp/ })
  expect(chat.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/923001234567\?text=Hi!/)
  expect(chat).toHaveAttribute('target', '_blank')
  expect(chat).toHaveAttribute('rel', 'noopener noreferrer')
})

it('has no WhatsApp button when the shop has not set a number', async () => {
  getPublicSettings.mockResolvedValue({
    business_name: 'Bundle of Loops',
    whatsapp: null,
    social_links: {},
  })
  renderLayout()
  await screen.findByRole('link', { name: 'Bundle of Loops, home' })
  expect(screen.queryByRole('link', { name: /WhatsApp/ })).not.toBeInTheDocument()
})
