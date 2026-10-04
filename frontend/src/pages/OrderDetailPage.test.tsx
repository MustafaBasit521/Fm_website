import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError, type Order } from '../lib/api'
import OrderDetailPage from './OrderDetailPage'

const api = { getOrder: vi.fn(), cancelOrder: vi.fn(), changeOrderAddress: vi.fn() }
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getOrder: (...a: unknown[]) => api.getOrder(...a),
  cancelOrder: (...a: unknown[]) => api.cancelOrder(...a),
  changeOrderAddress: (...a: unknown[]) => api.changeOrderAddress(...a),
}))

const order = (over: Partial<Order> = {}): Order => ({
  order_id: 'o1',
  status: 'PENDING',
  payment_method: 'COD',
  payment_status: 'PENDING',
  payment_deadline_at: null,
  customer_name: 'Ayesha',
  customer_email: 'a@example.com',
  customer_phone: null,
  delivery_name: 'Ayesha',
  delivery_house_no: '12-B',
  delivery_street_number: null,
  delivery_city: 'Lahore',
  delivery_province: null,
  delivery_postal_code: '54000',
  delivery_country: 'Pakistan',
  items: [
    {
      product_id: 'p1',
      product_name_snapshot: 'Sunflower',
      quantity: 2,
      unit_price_at_purchase_paisa: 125050,
    },
  ],
  subtotal_paisa: 250100,
  delivery_fee_paisa: 20000,
  total_amount_paisa: 270100,
  created_at: '2026-03-05T10:00:00Z',
  cancelled_at: null,
  cancellation_charge_paisa: 0,
  charge_waived: false,
  refund_due_paisa: 0,
  ...over,
})

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/orders/o1']}>
      <Routes>
        <Route path="/orders/:id" element={<OrderDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
})

it('shows order details from the snapshot', async () => {
  api.getOrder.mockResolvedValue(order())
  renderPage()
  expect(await screen.findByText('2 × Sunflower')).toBeInTheDocument()
  expect(screen.getByText('Rs 2,701')).toBeInTheDocument()
  expect(screen.getByText(/Ayesha, 12-B, Lahore, 54000, Pakistan/)).toBeInTheDocument()
  expect(screen.getByText('Pending')).toBeInTheDocument()
})

it('cancels a pending order after confirmation', async () => {
  api.getOrder.mockResolvedValue(order())
  api.cancelOrder.mockResolvedValue(
    order({ status: 'CANCELLED', cancelled_at: '2026-03-06T10:00:00Z' }),
  )
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel order' }))
  expect(api.cancelOrder).not.toHaveBeenCalled() // needs a second click
  await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel this order' }))
  expect(api.cancelOrder).toHaveBeenCalledWith('o1')
  expect(await screen.findByText(/This order was cancelled on/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument()
})

it('shows charge and refund for a cancelled paid order', async () => {
  api.getOrder.mockResolvedValue(
    order({
      status: 'CANCELLED',
      cancelled_at: '2026-03-06T10:00:00Z',
      payment_method: 'ONLINE',
      payment_status: 'PAID',
      cancellation_charge_paisa: 135050,
      refund_due_paisa: 135050,
    }),
  )
  renderPage()
  expect(await screen.findByText('Cancellation charge: Rs 1,350.50.')).toBeInTheDocument()
  expect(screen.getByText('Refund due to you: Rs 1,350.50.')).toBeInTheDocument()
})

it('tells the customer to contact the shop once the order is processing', async () => {
  api.getOrder.mockResolvedValue(order({ status: 'PROCESSING' }))
  renderPage()
  expect(await screen.findByText(/please contact the shop/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Change address' })).not.toBeInTheDocument()
})

it.each(['SHIPPED', 'DELIVERED'])('offers no actions when %s', async (status) => {
  api.getOrder.mockResolvedValue(order({ status }))
  renderPage()
  expect(await screen.findByText(/can no longer be changed or cancelled/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument()
})

it('explains a refused cancellation', async () => {
  api.getOrder.mockResolvedValue(order())
  api.cancelOrder.mockRejectedValue(new ApiError(409, 'x', { code: 'CONTACT_SHOP' }))
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel order' }))
  await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel this order' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Please contact the shop')
})

it('changes the address', async () => {
  api.getOrder.mockResolvedValue(order())
  api.changeOrderAddress.mockResolvedValue(order({ delivery_house_no: '99' }))
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Change address' }))
  const house = screen.getByLabelText('House number')
  await userEvent.clear(house)
  await userEvent.type(house, '99')
  await userEvent.click(screen.getByRole('button', { name: 'Save address' }))
  expect(api.changeOrderAddress.mock.calls[0][0]).toBe('o1')
  expect(api.changeOrderAddress.mock.calls[0][1].address).toMatchObject({
    house_no: '99',
    city: 'Lahore',
  })
  expect(await screen.findByText(/Ayesha, 99, Lahore/)).toBeInTheDocument()
})

it('shows the Lahore-only message when the address is refused', async () => {
  api.getOrder.mockResolvedValue(order())
  api.changeOrderAddress.mockRejectedValue(new ApiError(422, 'x', { code: 'NOT_DELIVERABLE' }))
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Change address' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save address' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('only within Lahore')
})

it('shows not-found and error states', async () => {
  api.getOrder.mockRejectedValue(new ApiError(404, 'x'))
  const { unmount } = renderPage()
  expect(await screen.findByText('Order not found')).toBeInTheDocument()
  unmount()
  api.getOrder.mockRejectedValue(new ApiError(500, 'x'))
  renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this order')
})
