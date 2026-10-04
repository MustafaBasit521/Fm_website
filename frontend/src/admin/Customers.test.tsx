import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AdminCustomer, AdminCustomerDetail } from '../lib/adminApi'
import { CustomerAdminPage, CustomersAdminPage } from './CustomersAdminPage'

const api = { getAdminCustomers: vi.fn(), getAdminCustomer: vi.fn() }
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/adminApi', () => ({
  getAdminCustomers: (...a: unknown[]) => api.getAdminCustomers(...a),
  getAdminCustomer: (...a: unknown[]) => api.getAdminCustomer(...a),
}))

const customer = (over: Partial<AdminCustomer> = {}): AdminCustomer => ({
  customer_id: 'c1',
  name: 'Ayesha Khan',
  email: 'a@example.com',
  phone: null,
  subscribed_to_updates: true,
  created_at: '2026-01-10T00:00:00Z',
  order_count: 2,
  ...over,
})

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
})

it('lists and searches customers', async () => {
  api.getAdminCustomers.mockResolvedValue({ items: [customer()], total: 1, page: 1, page_size: 20 })
  render(
    <MemoryRouter>
      <CustomersAdminPage />
    </MemoryRouter>,
  )
  expect(await screen.findByText('Ayesha Khan')).toBeInTheDocument()
  expect(screen.getByText(/2 orders/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Ayesha Khan/ })).toHaveAttribute(
    'href',
    '/admin/customers/c1',
  )
  await userEvent.type(screen.getByLabelText(/Search/), 'ayesha{Enter}')
  expect(api.getAdminCustomers.mock.calls.at(-1)![0]).toMatchObject({ search: 'ayesha', page: 1 })
})

it('shows customer details with recent orders', async () => {
  const detail: AdminCustomerDetail = {
    ...customer(),
    custom_order_count: 1,
    recent_orders: [
      {
        order_id: 'o1',
        status: 'DELIVERED',
        payment_method: 'COD',
        payment_status: 'PAID',
        total_amount_paisa: 270100,
        item_count: 2,
        payment_deadline_at: null,
        created_at: '2026-03-05T10:00:00Z',
        customer_name: 'Ayesha Khan',
        customer_email: 'a@example.com',
      },
    ],
  }
  api.getAdminCustomer.mockResolvedValue(detail)
  render(
    <MemoryRouter initialEntries={['/admin/customers/c1']}>
      <Routes>
        <Route path="/admin/customers/:id" element={<CustomerAdminPage />} />
      </Routes>
    </MemoryRouter>,
  )
  expect(await screen.findByRole('heading', { name: 'Ayesha Khan' })).toBeInTheDocument()
  expect(screen.getByText(/subscribed to shop updates/)).toBeInTheDocument()
  expect(screen.getByText(/1 custom requests/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Delivered/ })).toHaveAttribute(
    'href',
    '/admin/orders/o1',
  )
})

it('shows empty and error states', async () => {
  api.getAdminCustomers.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 })
  const a = render(
    <MemoryRouter>
      <CustomersAdminPage />
    </MemoryRouter>,
  )
  expect(await screen.findByText('No customers match.')).toBeInTheDocument()
  a.unmount()
  api.getAdminCustomer.mockRejectedValue(new Error('x'))
  render(
    <MemoryRouter initialEntries={['/admin/customers/c1']}>
      <Routes>
        <Route path="/admin/customers/:id" element={<CustomerAdminPage />} />
      </Routes>
    </MemoryRouter>,
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
})
