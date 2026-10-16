import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ProductSummary } from '../lib/api'
import { fakeSession, makeAuth } from '../test/auth'
import HomePage from './HomePage'

const getProducts = vi.fn()
const getWishlistIds = vi.fn()
const addToWishlist = vi.fn()
const removeFromWishlist = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getProducts: (...a: unknown[]) => getProducts(...a),
  getWishlistIds: (...a: unknown[]) => getWishlistIds(...a),
  addToWishlist: (...a: unknown[]) => addToWishlist(...a),
  removeFromWishlist: (...a: unknown[]) => removeFromWishlist(...a),
}))

const item = (n: number): ProductSummary => ({
  product_id: `p${n}`,
  name: `Piece ${n}`,
  price_paisa: 100000,
  category: { category_id: 'c', name: 'Flowers' },
  availability_type: 'READY_TO_SHIP',
  is_available: true,
  is_featured: true,
  image: null,
})
const page = (items: ProductSummary[]) => ({ items, total: items.length, page: 1, page_size: 4 })
const renderHome = (auth = {}) => render(makeAuth(auth).wrap(<HomePage />))

beforeEach(() => {
  getProducts.mockReset()
  getWishlistIds.mockReset().mockResolvedValue([])
  addToWishlist.mockReset().mockResolvedValue({})
  removeFromWishlist.mockReset().mockResolvedValue(undefined)
})

it('shows the hero, the promises and the featured pieces', async () => {
  getProducts.mockResolvedValue(page([item(1), item(2)]))
  renderHome()
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Your idea,\s*our crochet\./)
  expect(screen.getByRole('link', { name: /Shop collection/ })).toHaveAttribute('href', '/shop')
  expect(screen.getByRole('link', { name: 'Request a custom piece' })).toHaveAttribute(
    'href',
    '/custom-order',
  )
  expect(screen.getByText('Delivered across Lahore')).toBeInTheDocument()
  expect(await screen.findByText('Piece 1')).toBeInTheDocument()
  expect(screen.getByText('Featured collection')).toBeInTheDocument()
  expect((getProducts.mock.calls[0][0] as URLSearchParams).get('featured')).toBe('true')
})

it('falls back to the newest pieces when nothing is featured', async () => {
  getProducts.mockResolvedValueOnce(page([])).mockResolvedValueOnce(page([item(7)]))
  renderHome()
  expect(await screen.findByText('Piece 7')).toBeInTheDocument()
  expect(screen.getByText('New in the shop')).toBeInTheDocument()
  expect((getProducts.mock.calls[1][0] as URLSearchParams).get('featured')).toBeNull()
})

it('still shows the hero when products cannot be loaded or there are none', async () => {
  getProducts.mockRejectedValue(new Error('x'))
  const a = renderHome()
  expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  await vi.waitFor(() => expect(getProducts).toHaveBeenCalled())
  expect(screen.queryByText('Fresh off the')).not.toBeInTheDocument()
  a.unmount()
  getProducts.mockReset().mockResolvedValue(page([]))
  renderHome()
  await vi.waitFor(() => expect(getProducts).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
})

it('shows no hearts when signed out, and does not ask for the wishlist', async () => {
  getProducts.mockResolvedValue(page([item(1)]))
  renderHome()
  await screen.findByText('Piece 1')
  expect(screen.queryByRole('button', { name: /wishlist/ })).not.toBeInTheDocument()
  expect(getWishlistIds).not.toHaveBeenCalled()
})

it('shows hearts for signed-in shoppers and saves and removes with them', async () => {
  getProducts.mockResolvedValue(page([item(1), item(2)]))
  getWishlistIds.mockResolvedValue(['p2'])
  renderHome({ session: fakeSession })
  const save = await screen.findByRole('button', { name: 'Save Piece 1 to wishlist' })
  expect(screen.getByRole('button', { name: 'Remove Piece 2 from wishlist' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await userEvent.click(save)
  expect(addToWishlist).toHaveBeenCalledWith('p1')
  expect(
    await screen.findByRole('button', { name: 'Remove Piece 1 from wishlist' }),
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Remove Piece 2 from wishlist' }))
  expect(removeFromWishlist).toHaveBeenCalledWith('p2')
  expect(
    await screen.findByRole('button', { name: 'Save Piece 2 to wishlist' }),
  ).toBeInTheDocument()
})
