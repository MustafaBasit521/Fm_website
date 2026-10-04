import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Page, ProductSummary } from '../lib/api'
import { makeAuth } from '../test/auth'
import ShopPage from './ShopPage'

const getProducts = vi.fn()
const getCategories = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getProducts: (...a: unknown[]) => getProducts(...a),
  getCategories: (...a: unknown[]) => getCategories(...a),
}))

const product = (over: Partial<ProductSummary> = {}): ProductSummary => ({
  product_id: 'p1',
  name: 'Sunflower',
  price_paisa: 125050,
  category: { category_id: 'c1', name: 'Flowers' },
  availability_type: 'READY_TO_SHIP',
  is_available: true,
  is_featured: false,
  image: null,
  ...over,
})
const page = (items: ProductSummary[], total = items.length): Page<ProductSummary> => ({
  items,
  total,
  page: 1,
  page_size: 12,
})

const renderShop = (path = '/shop') => render(makeAuth().wrap(<ShopPage />, path))

beforeEach(() => {
  getProducts.mockReset()
  getCategories.mockReset().mockResolvedValue([{ category_id: 'c1', name: 'Flowers' }])
})

it('lists products with formatted price and availability', async () => {
  getProducts.mockResolvedValue(
    page([product(), product({ product_id: 'p2', name: 'Bunny', is_available: false })]),
  )
  renderShop()
  expect(await screen.findByText('Sunflower')).toBeInTheDocument()
  expect(screen.getAllByText('Rs 1,250.50')).toHaveLength(2)
  expect(screen.getByText('In stock')).toBeInTheDocument()
  expect(screen.getByText('Currently unavailable')).toBeInTheDocument()
})

it('passes URL filters to the API and resets to page 1 when a filter changes', async () => {
  getProducts.mockResolvedValue(page([product()], 30))
  renderShop('/shop?page=2&sort=price_asc')
  await screen.findByText('Sunflower')
  let q = getProducts.mock.calls.at(-1)![0] as URLSearchParams
  expect(q.get('page')).toBe('2')
  expect(q.get('sort')).toBe('price_asc')
  expect(q.get('page_size')).toBe('12')

  await userEvent.selectOptions(screen.getByLabelText('Type'), 'MADE_TO_ORDER')
  await waitFor(() => {
    q = getProducts.mock.calls.at(-1)![0] as URLSearchParams
    expect(q.get('availability')).toBe('MADE_TO_ORDER')
  })
  expect(q.get('page')).toBeNull()
})

it('searches on Enter', async () => {
  getProducts.mockResolvedValue(page([product()]))
  renderShop()
  await screen.findByText('Sunflower')
  await userEvent.type(screen.getByLabelText('Search'), 'rose{Enter}')
  await waitFor(() =>
    expect((getProducts.mock.calls.at(-1)![0] as URLSearchParams).get('search')).toBe('rose'),
  )
})

it('shows an empty state', async () => {
  getProducts.mockResolvedValue(page([]))
  renderShop()
  expect(await screen.findByText('No products match your search.')).toBeInTheDocument()
})

it('shows an error state', async () => {
  getProducts.mockRejectedValue(new Error('boom'))
  renderShop()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load products')
})

it('paginates', async () => {
  getProducts.mockResolvedValue(page([product()], 30))
  renderShop()
  await screen.findByText('Page 1 of 3')
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  await waitFor(() =>
    expect((getProducts.mock.calls.at(-1)![0] as URLSearchParams).get('page')).toBe('2'),
  )
})
