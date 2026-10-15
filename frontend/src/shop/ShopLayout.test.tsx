import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { saveCart } from '../lib/cart'
import { fakeSession, makeAuth } from '../test/auth'
import ShopLayout from './ShopLayout'

const getPublicSettings = vi.fn()
const getUnreadCount = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getPublicSettings: (...a: unknown[]) => getPublicSettings(...a),
  getUnreadCount: (...a: unknown[]) => getUnreadCount(...a),
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
})

it('shows the shop name from the settings in the header and footer, with contact details', async () => {
  renderLayout()
  expect(await screen.findByRole('link', { name: 'Bundle of Loops' })).toHaveAttribute('href', '/')
  const footer = screen.getByRole('contentinfo')
  expect(within(footer).getByText('Bundle of Loops', { selector: 'p' })).toBeInTheDocument()
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
  expect(await screen.findByRole('link', { name: 'Crochet Shop' })).toBeInTheDocument()
  expect(screen.getByText(/Delivering across Lahore/)).toBeInTheDocument()
})

it('has the main links, a skip-to-content link and the page content', async () => {
  renderLayout()
  const nav = screen.getByRole('navigation', { name: 'Main' })
  for (const name of ['Shop', 'Gallery', 'Custom order', 'Contact'])
    expect(within(nav).getByRole('link', { name })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
    'href',
    '#main-content',
  )
  expect(screen.getByTestId('where')).toHaveTextContent('/shop')
})

it('shows the cart count from the cart in the header', async () => {
  saveCart([
    { product_id: 'a', quantity: 2 },
    { product_id: 'b', quantity: 1 },
  ])
  renderLayout()
  expect(screen.getByRole('link', { name: 'Cart, 3 items' })).toHaveAttribute('href', '/cart')
})

it('has an empty-cart link without a count', () => {
  renderLayout()
  expect(screen.getByRole('link', { name: 'Cart' })).toBeInTheDocument()
})

it('opens a search bar from the search icon and searches the shop', async () => {
  renderLayout({}, '/gallery')
  expect(screen.queryByRole('search')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  expect(screen.getByRole('button', { name: 'Search', expanded: true })).toBeInTheDocument()
  const field = screen.getByLabelText('Search the shop')
  expect(field).toHaveFocus()
  await userEvent.type(field, 'red rose & co{Enter}')
  expect(screen.getByTestId('where')).toHaveTextContent('/shop?search=red%20rose%20%26%20co')
  expect(screen.queryByRole('search')).not.toBeInTheDocument() // closed after searching
})

it('closes the search bar with Escape and an empty search just opens the shop', async () => {
  renderLayout({}, '/gallery')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('search')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await userEvent.type(screen.getByLabelText('Search the shop'), '   {Enter}')
  expect(screen.getByTestId('where')).toHaveTextContent(/^\/shop$/)
})

it('signed out: a log-in icon and a menu with log in / create account', async () => {
  renderLayout()
  expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
  expect(screen.queryByRole('link', { name: 'Wishlist' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))
  const menu = screen.getByRole('dialog', { name: 'Menu' })
  expect(within(menu).getByRole('link', { name: 'Create account' })).toHaveAttribute(
    'href',
    '/register',
  )
  await userEvent.click(within(menu).getByRole('link', { name: 'Gallery' }))
  expect(screen.getByTestId('where')).toHaveTextContent('/gallery')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument() // closes after navigating
})

it('signed in: account and wishlist icons, and a menu with orders, notifications and log out', async () => {
  getUnreadCount.mockResolvedValue({ unread: 2 })
  const ctx = renderLayout({ session: fakeSession })
  expect(screen.getByRole('link', { name: 'My account' })).toHaveAttribute('href', '/account')
  expect(screen.getByRole('link', { name: 'Wishlist' })).toHaveAttribute('href', '/wishlist')
  await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))
  const menu = screen.getByRole('dialog', { name: 'Menu' })
  expect(within(menu).getByRole('link', { name: 'My orders' })).toHaveAttribute('href', '/orders')
  expect(await within(menu).findByRole('link', { name: 'Notifications (2)' })).toBeInTheDocument()
  await userEvent.click(within(menu).getByRole('button', { name: 'Log out' }))
  expect(ctx.signOut).toHaveBeenCalled()
})
