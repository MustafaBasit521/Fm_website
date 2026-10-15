import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ProductSummary } from '../lib/api'
import HomePage from './HomePage'

const getProducts = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getProducts: (...a: unknown[]) => getProducts(...a),
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
const renderHome = () =>
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  )

beforeEach(() => {
  getProducts.mockReset()
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
