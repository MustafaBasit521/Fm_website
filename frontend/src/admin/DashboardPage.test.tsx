import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Dashboard } from '../lib/adminApi'
import DashboardPage from './DashboardPage'

const getDashboard = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/adminApi', () => ({ getDashboard: (...a: unknown[]) => getDashboard(...a) }))

const data = (over: Partial<Dashboard> = {}): Dashboard => ({
  orders_by_status: {
    PENDING: 2,
    CONFIRMED: 1,
    PROCESSING: 0,
    SHIPPED: 0,
    DELIVERED: 4,
    CANCELLED: 1,
  },
  orders_needing_action: 3,
  new_messages: 1,
  new_custom_orders: 2,
  low_stock_threshold: 3,
  low_stock_products: [{ product_id: 'p1', name: 'Sunflower', stock_quantity: 1 }],
  recent_orders: [
    {
      order_id: 'o1',
      status: 'PENDING',
      payment_method: 'COD',
      payment_status: 'PENDING',
      total_amount_paisa: 270100,
      item_count: 2,
      payment_deadline_at: null,
      created_at: '2026-03-05T10:00:00Z',
      customer_name: 'Ayesha',
      customer_email: 'a@example.com',
    },
  ],
  ...over,
})
const renderPage = () =>
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  getDashboard.mockReset()
})

it('shows what needs attention, status counts, low stock and recent orders', async () => {
  getDashboard.mockResolvedValue(data())
  renderPage()
  expect(await screen.findByText('orders to process')).toBeInTheDocument()
  expect(screen.getByText('new message')).toBeInTheDocument()
  expect(screen.getByText('new custom requests')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Sunflower' })).toHaveAttribute(
    'href',
    '/admin/products/p1',
  )
  expect(screen.getByText(/1 left/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Ayesha/ })).toHaveAttribute('href', '/admin/orders/o1')
  expect(screen.getByText(/Delivered:/)).toBeInTheDocument()
})

it('shows friendly empty states and an error state', async () => {
  getDashboard.mockResolvedValue(
    data({ low_stock_products: [], recent_orders: [], orders_needing_action: 0 }),
  )
  const first = renderPage()
  expect(await screen.findByText('Everything is well stocked.')).toBeInTheDocument()
  expect(screen.getByText('No orders yet.')).toBeInTheDocument()
  first.unmount()
  getDashboard.mockRejectedValue(new Error('x'))
  renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
})
