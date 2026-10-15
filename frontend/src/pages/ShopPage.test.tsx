import { render, screen, waitFor, within } from '@testing-library/react'
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
const lastQuery = () => getProducts.mock.calls.at(-1)![0] as URLSearchParams

beforeEach(() => {
  getProducts.mockReset()
  getCategories.mockReset().mockResolvedValue([
    { category_id: 'c1', name: 'Flowers' },
    { category_id: 'c2', name: 'Keys' },
  ])
})

it('lists products with price and availability in words', async () => {
  getProducts.mockResolvedValue(
    page([
      product(),
      product({ product_id: 'p2', name: 'Bunny', is_available: false }),
      product({ product_id: 'p3', name: 'Cup', availability_type: 'MADE_TO_ORDER' }),
    ]),
  )
  renderShop()
  expect(await screen.findByText('Sunflower')).toBeInTheDocument()
  expect(screen.getAllByText('Rs 1,250.50')).toHaveLength(3)
  expect(screen.getByText('In stock')).toBeInTheDocument()
  expect(screen.getByText('Currently unavailable')).toBeInTheDocument()
  expect(screen.getByText('Made to order')).toBeInTheDocument()
  expect(screen.getByText('3 products')).toBeInTheDocument()
})

it('filters by category with the pills, and the pill shows which one is selected', async () => {
  getProducts.mockResolvedValue(page([product()], 30))
  renderShop('/shop?page=2')
  const nav = await screen.findByRole('navigation', { name: 'Categories' })
  await within(nav).findByRole('button', { name: 'Keys' })
  expect(within(nav).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(within(nav).getByRole('button', { name: 'Keys' }))
  await waitFor(() => expect(lastQuery().get('category_id')).toBe('c2'))
  expect(lastQuery().get('page')).toBeNull() // a filter change returns to page 1
  expect(await screen.findByRole('heading', { name: 'Keys' })).toBeInTheDocument()
  expect(within(nav).getByRole('button', { name: 'Keys' })).toHaveAttribute('aria-pressed', 'true')
})

it('keeps all the filters inside a drawer that opens from the Filters button', async () => {
  getProducts.mockResolvedValue(page([product()]))
  renderShop()
  await screen.findByText('Sunflower')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Lowest')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
  const dialog = screen.getByRole('dialog', { name: 'Filters' })
  expect(within(dialog).getByRole('radio', { name: 'Price: low to high' })).toBeInTheDocument()
  expect(within(dialog).getByRole('radio', { name: 'Made to order' })).toBeInTheDocument()
  expect(within(dialog).getByLabelText('Only show available')).toBeInTheDocument()
})

it('applies drawer choices to the URL (prices converted to paisa) and shows them as chips', async () => {
  getProducts.mockResolvedValue(page([product()]))
  renderShop()
  await screen.findByText('Sunflower')
  await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
  const dialog = screen.getByRole('dialog')
  await userEvent.click(within(dialog).getByRole('radio', { name: 'Price: low to high' }))
  await userEvent.click(within(dialog).getByRole('radio', { name: 'Made to order' }))
  await userEvent.click(within(dialog).getByLabelText('Only show available'))
  await userEvent.type(within(dialog).getByLabelText('Lowest'), '500')
  await userEvent.type(within(dialog).getByLabelText('Highest'), '1250.50')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Show results' }))

  await waitFor(() => expect(lastQuery().get('sort')).toBe('price_asc'))
  const q = lastQuery()
  expect(q.get('availability')).toBe('MADE_TO_ORDER')
  expect(q.get('available_only')).toBe('true')
  expect(q.get('min_price')).toBe('50000')
  expect(q.get('max_price')).toBe('125050')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument() // the drawer closed
  const chips = screen.getByRole('list', { name: 'Active filters' })
  expect(within(chips).getByText(/Price: Rs 500 – Rs 1,250.50/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Filters (5)' })).toBeInTheDocument()
})

it('removes one filter with its chip and all of them with Clear all (keeping category and search)', async () => {
  getProducts.mockResolvedValue(page([product()]))
  renderShop('/shop?category_id=c1&search=rose&sort=price_desc&available_only=true')
  await screen.findByText('Sunflower')
  await userEvent.click(screen.getByRole('button', { name: 'Remove filter: Available only' }))
  await waitFor(() => expect(lastQuery().get('available_only')).toBeNull())
  expect(lastQuery().get('sort')).toBe('price_desc')
  await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))
  await waitFor(() => expect(lastQuery().get('sort')).toBeNull())
  expect(lastQuery().get('category_id')).toBe('c1')
  expect(lastQuery().get('search')).toBe('rose')
})

it('shows the search term as a removable chip', async () => {
  getProducts.mockResolvedValue(page([product()]))
  renderShop('/shop?search=rose')
  await userEvent.click(await screen.findByRole('button', { name: 'Remove filter: Search: rose' }))
  await waitFor(() => expect(lastQuery().get('search')).toBeNull())
})

it('rejects a bad or reversed price range and keeps the drawer open', async () => {
  getProducts.mockResolvedValue(page([product()]))
  renderShop()
  await screen.findByText('Sunflower')
  await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
  const dialog = screen.getByRole('dialog')
  await userEvent.type(within(dialog).getByLabelText('Lowest'), 'cheap')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Show results' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('like 500 or 1250.50')
  await userEvent.clear(within(dialog).getByLabelText('Lowest'))
  await userEvent.type(within(dialog).getByLabelText('Lowest'), '900')
  await userEvent.type(within(dialog).getByLabelText('Highest'), '100')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Show results' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('cannot be higher')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('pre-fills the drawer from the URL', async () => {
  getProducts.mockResolvedValue(page([product()]))
  renderShop('/shop?sort=name&availability=READY_TO_SHIP&min_price=50000')
  await screen.findByText('Sunflower')
  await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
  expect(screen.getByRole('radio', { name: 'Name' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Ready to ship' })).toBeChecked()
  expect(screen.getByLabelText('Lowest')).toHaveValue('500')
})

it('shows empty and error states', async () => {
  getProducts.mockResolvedValue(page([]))
  const a = renderShop()
  expect(await screen.findByText('No products match your search.')).toBeInTheDocument()
  a.unmount()
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
  await waitFor(() => expect(lastQuery().get('page')).toBe('2'))
})
