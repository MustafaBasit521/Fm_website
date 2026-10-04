import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AdminOrder, AdminOrderSummary } from '../lib/adminApi'
import { ApiError, type Page } from '../lib/api'
import OrderAdminPage from './OrderAdminPage'
import OrdersAdminPage from './OrdersAdminPage'

const api = {
  getAdminOrders: vi.fn(),
  getAdminOrder: vi.fn(),
  setOrderStatus: vi.fn(),
  cancelAdminOrder: vi.fn(),
  refundOrder: vi.fn(),
  confirmCodPayment: vi.fn(),
  changeAdminOrderAddress: vi.fn(),
}
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/adminApi', () => ({
  getAdminOrders: (...a: unknown[]) => api.getAdminOrders(...a),
  getAdminOrder: (...a: unknown[]) => api.getAdminOrder(...a),
  setOrderStatus: (...a: unknown[]) => api.setOrderStatus(...a),
  cancelAdminOrder: (...a: unknown[]) => api.cancelAdminOrder(...a),
  refundOrder: (...a: unknown[]) => api.refundOrder(...a),
  confirmCodPayment: (...a: unknown[]) => api.confirmCodPayment(...a),
  changeAdminOrderAddress: (...a: unknown[]) => api.changeAdminOrderAddress(...a),
}))

const summary = (over: Partial<AdminOrderSummary> = {}): AdminOrderSummary => ({
  order_id: 'o1',
  status: 'PENDING',
  payment_method: 'COD',
  payment_status: 'PENDING',
  total_amount_paisa: 270100,
  item_count: 2,
  payment_deadline_at: null,
  created_at: '2026-03-05T10:00:00Z',
  customer_name: 'Ayesha Khan',
  customer_email: 'a@example.com',
  ...over,
})
const order = (over: Partial<AdminOrder> = {}): AdminOrder => ({
  order_id: 'o1',
  status: 'PENDING',
  payment_method: 'COD',
  payment_status: 'PENDING',
  payment_deadline_at: null,
  customer_name: 'Ayesha Khan',
  customer_email: 'a@example.com',
  customer_phone: null,
  delivery_name: 'Ayesha Khan',
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
  customer_id: null,
  updated_at: '2026-03-05T10:00:00Z',
  payments: [
    {
      payment_id: 'pay1',
      method: 'COD',
      status: 'PENDING',
      amount_paisa: 270100,
      refunded_amount_paisa: 0,
      provider_reference: null,
      created_at: '2026-03-05T10:00:00Z',
    },
  ],
  ...over,
})
const page = (items: AdminOrderSummary[], total = items.length): Page<AdminOrderSummary> => ({
  items,
  total,
  page: 1,
  page_size: 20,
})

const renderList = () =>
  render(
    <MemoryRouter>
      <OrdersAdminPage />
    </MemoryRouter>,
  )
const renderDetail = () =>
  render(
    <MemoryRouter initialEntries={['/admin/orders/o1']}>
      <Routes>
        <Route path="/admin/orders/:id" element={<OrderAdminPage />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
})

// ---- list ----------------------------------------------------------------------------------

it('lists orders and sends the filters to the server', async () => {
  api.getAdminOrders.mockResolvedValue(page([summary()], 45))
  renderList()
  expect(await screen.findByText('Ayesha Khan')).toBeInTheDocument()
  expect(screen.getByText(/Rs 2,701 · Cash on delivery/)).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Status'), 'SHIPPED')
  await userEvent.selectOptions(screen.getByLabelText('Payment'), 'ONLINE')
  await userEvent.type(screen.getByLabelText(/Search/), 'zainab{Enter}')
  const last = api.getAdminOrders.mock.calls.at(-1)![0]
  expect(last).toMatchObject({
    status: 'SHIPPED',
    payment_method: 'ONLINE',
    search: 'zainab',
    page: 1,
  })
  await screen.findByText('Page 1 of 3')
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(api.getAdminOrders.mock.calls.at(-1)![0].page).toBe(2)
})

it('shows empty and error states', async () => {
  api.getAdminOrders.mockResolvedValue(page([]))
  const a = renderList()
  expect(await screen.findByText('No orders match.')).toBeInTheDocument()
  a.unmount()
  api.getAdminOrders.mockRejectedValue(new Error('x'))
  renderList()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
})

// ---- detail: status steps ------------------------------------------------------------------

it('shows the order and moves it one step forward', async () => {
  api.getAdminOrder.mockResolvedValue(order())
  api.setOrderStatus.mockResolvedValue(order({ status: 'CONFIRMED' }))
  renderDetail()
  expect(await screen.findByText('2 × Sunflower')).toBeInTheDocument()
  expect(screen.getByText(/Guest order/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Confirm order' }))
  expect(api.setOrderStatus).toHaveBeenCalledWith('o1', 'CONFIRMED')
  expect(await screen.findByRole('button', { name: 'Start preparing' })).toBeInTheDocument()
})

it.each([
  ['CONFIRMED', 'Start preparing', 'PROCESSING'],
  ['PROCESSING', 'Mark as shipped', 'SHIPPED'],
  ['SHIPPED', 'Mark as delivered', 'DELIVERED'],
])('offers the next step for %s', async (status, label, target) => {
  api.getAdminOrder.mockResolvedValue(order({ status }))
  api.setOrderStatus.mockResolvedValue(order({ status: target }))
  renderDetail()
  await userEvent.click(await screen.findByRole('button', { name: label }))
  expect(api.setOrderStatus).toHaveBeenCalledWith('o1', target)
})

it('explains why an unpaid online order cannot be confirmed', async () => {
  api.getAdminOrder.mockResolvedValue(order({ payment_method: 'ONLINE' }))
  api.setOrderStatus.mockRejectedValue(new ApiError(409, 'x', { code: 'PAYMENT_NOT_VERIFIED' }))
  renderDetail()
  await userEvent.click(await screen.findByRole('button', { name: 'Confirm order' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('only after its payment is verified')
})

it('offers no next step once delivered or cancelled', async () => {
  api.getAdminOrder.mockResolvedValue(
    order({ status: 'DELIVERED', payment_method: 'ONLINE', payment_status: 'PAID' }),
  )
  renderDetail()
  await screen.findByText('2 × Sunflower')
  expect(
    screen.queryByRole('button', { name: /Confirm order|Start preparing|Mark as/ }),
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument()
})

// ---- detail: cancel, charge, refund, COD ---------------------------------------------------

it('cancels only after a second click', async () => {
  api.getAdminOrder.mockResolvedValue(order())
  api.cancelAdminOrder.mockResolvedValue(order({ status: 'CANCELLED' }))
  renderDetail()
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel order' }))
  expect(api.cancelAdminOrder).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel this order' }))
  expect(api.cancelAdminOrder).toHaveBeenCalledWith('o1', false)
  expect(await screen.findByText('No actions left.')).toBeInTheDocument()
})

it('lets the admin waive the Processing charge on a paid online order', async () => {
  api.getAdminOrder.mockResolvedValue(
    order({
      status: 'PROCESSING',
      payment_method: 'ONLINE',
      payment_status: 'PAID',
      total_amount_paisa: 270100,
    }),
  )
  api.cancelAdminOrder.mockResolvedValue(
    order({ status: 'CANCELLED', payment_method: 'ONLINE', payment_status: 'PAID' }),
  )
  renderDetail()
  const waive = await screen.findByLabelText(/Waive the cancellation charge/)
  expect(waive.parentElement).toHaveTextContent('Rs 1,350.50')
  await userEvent.click(waive)
  await userEvent.click(screen.getByRole('button', { name: 'Cancel order' }))
  await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel this order' }))
  expect(api.cancelAdminOrder).toHaveBeenCalledWith('o1', true)
})

it('says the charge is waived automatically for cash on delivery', async () => {
  api.getAdminOrder.mockResolvedValue(order({ status: 'PROCESSING' }))
  renderDetail()
  expect(await screen.findByText(/charge is waived automatically/)).toBeInTheDocument()
  expect(screen.queryByLabelText(/Waive the cancellation charge/)).not.toBeInTheDocument()
})

it('refunds what is owed, in full or in part', async () => {
  const cancelled = order({
    status: 'CANCELLED',
    payment_method: 'ONLINE',
    payment_status: 'PAID',
    refund_due_paisa: 135050,
    cancellation_charge_paisa: 100000,
  })
  api.getAdminOrder.mockResolvedValue(cancelled)
  api.refundOrder.mockResolvedValue({
    ...cancelled,
    payment_status: 'PARTIALLY_REFUNDED',
    refund_due_paisa: 35050,
  })
  renderDetail()
  expect(await screen.findByText('Rs 1,350.50')).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText(/Amount in Rs/), '1000')
  await userEvent.click(screen.getByRole('button', { name: 'Refund' }))
  expect(api.refundOrder).toHaveBeenCalledWith('o1', 100000)
  expect(await screen.findByText('Rs 350.50')).toBeInTheDocument()
})

it('refunds everything owed when the amount is left empty and rejects bad amounts', async () => {
  const cancelled = order({
    status: 'CANCELLED',
    payment_method: 'ONLINE',
    payment_status: 'PAID',
    refund_due_paisa: 270100,
  })
  api.getAdminOrder.mockResolvedValue(cancelled)
  api.refundOrder.mockResolvedValue({
    ...cancelled,
    payment_status: 'REFUNDED',
    refund_due_paisa: 0,
  })
  renderDetail()
  await userEvent.type(await screen.findByLabelText(/Amount in Rs/), 'lots')
  await userEvent.click(screen.getByRole('button', { name: 'Refund' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('like 500 or 500.50')
  expect(api.refundOrder).not.toHaveBeenCalled()
  await userEvent.clear(screen.getByLabelText(/Amount in Rs/))
  await userEvent.click(screen.getByRole('button', { name: 'Refund' }))
  expect(api.refundOrder).toHaveBeenCalledWith('o1', null)
  expect(await screen.findByText('No actions left.')).toBeInTheDocument()
})

it('explains a failed refund', async () => {
  api.getAdminOrder.mockResolvedValue(
    order({
      status: 'CANCELLED',
      payment_method: 'ONLINE',
      payment_status: 'PAID',
      refund_due_paisa: 100,
    }),
  )
  api.refundOrder.mockRejectedValue(new ApiError(502, 'x', { code: 'REFUND_FAILED' }))
  renderDetail()
  await userEvent.click(await screen.findByRole('button', { name: 'Refund' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was changed')
})

it('confirms cash received only for delivered cash-on-delivery orders', async () => {
  api.getAdminOrder.mockResolvedValue(order({ status: 'DELIVERED' }))
  api.confirmCodPayment.mockResolvedValue(order({ status: 'DELIVERED', payment_status: 'PAID' }))
  renderDetail()
  await userEvent.click(await screen.findByRole('button', { name: 'Confirm cash received' }))
  expect(api.confirmCodPayment).toHaveBeenCalledWith('o1')
  await screen.findByText(/Paid/)
  expect(screen.queryByRole('button', { name: 'Confirm cash received' })).not.toBeInTheDocument()
})

// ---- detail: address -----------------------------------------------------------------------

it('changes the delivery address while pending or confirmed', async () => {
  api.getAdminOrder.mockResolvedValue(order())
  api.changeAdminOrderAddress.mockResolvedValue(order({ delivery_house_no: '99' }))
  renderDetail()
  await userEvent.click(await screen.findByRole('button', { name: 'Change address' }))
  const house = screen.getByLabelText('House number')
  await userEvent.clear(house)
  await userEvent.type(house, '99')
  await userEvent.click(screen.getByRole('button', { name: 'Save address' }))
  expect(api.changeAdminOrderAddress.mock.calls[0][1].address).toMatchObject({
    house_no: '99',
    city: 'Lahore',
  })
  expect(await screen.findByText(/Ayesha Khan, 99, Lahore/)).toBeInTheDocument()
})

it('hides address changes later on and shows the Lahore-only message when refused', async () => {
  api.getAdminOrder.mockResolvedValue(order({ status: 'SHIPPED' }))
  const a = renderDetail()
  await screen.findByText('2 × Sunflower')
  expect(screen.queryByRole('button', { name: 'Change address' })).not.toBeInTheDocument()
  a.unmount()
  api.getAdminOrder.mockResolvedValue(order())
  api.changeAdminOrderAddress.mockRejectedValue(new ApiError(422, 'x', { code: 'NOT_DELIVERABLE' }))
  renderDetail()
  await userEvent.click(await screen.findByRole('button', { name: 'Change address' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save address' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('only within Lahore')
})

it('lists payment attempts and links registered customers', async () => {
  api.getAdminOrder.mockResolvedValue(
    order({
      customer_id: 'c9',
      payment_method: 'ONLINE',
      payments: [
        {
          payment_id: 'a',
          method: 'ONLINE',
          status: 'FAILED',
          amount_paisa: 270100,
          refunded_amount_paisa: 0,
          provider_reference: 'x',
          created_at: '',
        },
        {
          payment_id: 'b',
          method: 'ONLINE',
          status: 'PAID',
          amount_paisa: 270100,
          refunded_amount_paisa: 0,
          provider_reference: 'y',
          created_at: '',
        },
      ],
    }),
  )
  renderDetail()
  expect(await screen.findAllByText(/Online attempt/)).toHaveLength(2)
  expect(screen.getByRole('link', { name: 'View customer' })).toHaveAttribute(
    'href',
    '/admin/customers/c9',
  )
})

it('shows an error when the order cannot be loaded', async () => {
  api.getAdminOrder.mockRejectedValue(new Error('x'))
  renderDetail()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
})
