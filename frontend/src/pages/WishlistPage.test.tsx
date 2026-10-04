import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Page, ProductSummary } from '../lib/api'
import WishlistPage from './WishlistPage'

const getWishlist = vi.fn()
const removeFromWishlist = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getWishlist: (...a: unknown[]) => getWishlist(...a),
  removeFromWishlist: (...a: unknown[]) => removeFromWishlist(...a),
}))

const product = (id: string, name: string): ProductSummary => ({
  product_id: id,
  name,
  price_paisa: 50000,
  category: { category_id: 'c', name: 'Flowers' },
  availability_type: 'READY_TO_SHIP',
  is_available: true,
  is_featured: false,
  image: null,
})
const page = (items: ProductSummary[]): Page<ProductSummary> => ({
  items,
  total: items.length,
  page: 1,
  page_size: 12,
})
const renderPage = () =>
  render(
    <MemoryRouter>
      <WishlistPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  getWishlist.mockReset()
  removeFromWishlist.mockReset()
})

it('lists wishlist products and removes one', async () => {
  getWishlist.mockResolvedValue(page([product('p1', 'Rose'), product('p2', 'Tulip')]))
  removeFromWishlist.mockResolvedValue(undefined)
  renderPage()
  expect(await screen.findByText('Rose')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Remove Rose from wishlist' }))
  expect(removeFromWishlist).toHaveBeenCalledWith('p1')
  await screen.findByText('Tulip')
  expect(screen.queryByText('Rose')).not.toBeInTheDocument()
})

it('shows an empty state', async () => {
  getWishlist.mockResolvedValue(page([]))
  renderPage()
  expect(await screen.findByText(/Your wishlist is empty/)).toBeInTheDocument()
})

it('shows an error state', async () => {
  getWishlist.mockRejectedValue(new Error('x'))
  renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your wishlist')
})

it('keeps the item and shows an error when removal fails', async () => {
  getWishlist.mockResolvedValue(page([product('p1', 'Rose')]))
  removeFromWishlist.mockRejectedValue(new Error('x'))
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Remove Rose from wishlist' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove')
  expect(screen.getByText('Rose')).toBeInTheDocument()
})
