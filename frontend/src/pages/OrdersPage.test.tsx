import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { OrderSummary, Page } from '../lib/api'
import OrdersPage from './OrdersPage'

const getOrders = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getOrders: (...a: unknown[]) => getOrders(...a),
}))

const summary = (over: Partial<OrderSummary> = {}): OrderSummary => ({
  order_id: 'o1',
  status: 'PENDING',
  payment_method: 'COD',
  payment_status: 'PENDING',
  total_amount_paisa: 270100,
  item_count: 2,
  payment_deadline_at: null,
  created_at: '2026-03-05T10:00:00Z',
  ...over,
})
const page = (items: OrderSummary[], total = items.length): Page<OrderSummary> => ({
  items,
  total,
  page: 1,
  page_size: 10,
})
const renderPage = () =>
  render(
    <MemoryRouter>
      <OrdersPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  getOrders.mockReset()
})

it('lists orders with status in words and links to the detail page', async () => {
  getOrders.mockResolvedValue(
    page([summary(), summary({ order_id: 'o2', status: 'CANCELLED', item_count: 1 })]),
  )
  renderPage()
  expect(await screen.findAllByText(/Order placed/)).toHaveLength(2)
  expect(screen.getByText(/2 items · Pending · Cash on delivery/)).toBeInTheDocument()
  expect(screen.getByText(/1 item · Cancelled/)).toBeInTheDocument()
  expect(screen.getAllByText('Rs 2,701')).toHaveLength(2)
  expect(screen.getAllByRole('link', { name: /Order placed/ })[0]).toHaveAttribute(
    'href',
    '/orders/o1',
  )
})

it('shows an empty state, an error state, and paginates', async () => {
  getOrders.mockResolvedValue(page([]))
  const { unmount } = renderPage()
  expect(await screen.findByText(/You have not placed any orders yet/)).toBeInTheDocument()
  unmount()

  getOrders.mockRejectedValue(new Error('x'))
  const second = renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your orders')
  second.unmount()

  getOrders.mockReset().mockResolvedValue(page([summary()], 25))
  renderPage()
  await screen.findByText('Page 1 of 3')
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(getOrders.mock.calls.at(-1)![0]).toBe(2)
})
