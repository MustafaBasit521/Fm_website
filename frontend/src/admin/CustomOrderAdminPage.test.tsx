import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AdminCustomOrder } from '../lib/adminApi'
import { ApiError } from '../lib/api'
import { ToastProvider } from '../toast/ToastProvider'
import CustomOrderAdminPage from './CustomOrderAdminPage'

const api = {
  getAdminCustomOrder: vi.fn(),
  getAdminCustomOrderMessages: vi.fn(),
  sendAdminCustomOrderMessage: vi.fn(),
  acceptCustomOrder: vi.fn(),
  proposeCustomOrderPrice: vi.fn(),
  setCustomOrderStatus: vi.fn(),
}
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/adminApi', () => ({
  getAdminCustomOrder: (...a: unknown[]) => api.getAdminCustomOrder(...a),
  getAdminCustomOrderMessages: (...a: unknown[]) => api.getAdminCustomOrderMessages(...a),
  sendAdminCustomOrderMessage: (...a: unknown[]) => api.sendAdminCustomOrderMessage(...a),
  acceptCustomOrder: (...a: unknown[]) => api.acceptCustomOrder(...a),
  proposeCustomOrderPrice: (...a: unknown[]) => api.proposeCustomOrderPrice(...a),
  setCustomOrderStatus: (...a: unknown[]) => api.setCustomOrderStatus(...a),
}))

const co = (over: Partial<AdminCustomOrder> = {}): AdminCustomOrder => ({
  custom_order_id: 'c1',
  name: 'Sara',
  whatsapp_number: '0300 1234567',
  description: 'A jersey with a name',
  budget_paisa: 150000,
  proposed_price_paisa: null,
  agreed_price_paisa: null,
  required_date: null,
  status: 'IN_DISCUSSION',
  has_reference_image: false,
  created_at: '2026-03-05T10:00:00Z',
  updated_at: '2026-03-05T10:00:00Z',
  customer_id: 'u1',
  reference_image_url: null,
  ...over,
})
const message = (n: number, sender: 'CUSTOMER' | 'ADMIN', body: string) => ({
  message_id: `m${n}`,
  sender,
  body,
  created_at: '2026-03-06T10:00:00Z',
})

const open = () =>
  render(
    <MemoryRouter initialEntries={['/custom-orders/c1']}>
      <ToastProvider>
        <Routes>
          <Route path="/custom-orders/:id" element={<CustomOrderAdminPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
  api.getAdminCustomOrder.mockResolvedValue(co())
  api.getAdminCustomOrderMessages.mockResolvedValue([
    message(1, 'CUSTOMER', 'Can you do blush pink?'),
  ])
})

it('shows the request, the customer budget and the conversation', async () => {
  open()
  expect(await screen.findByText('A jersey with a name')).toBeInTheDocument()
  expect(screen.getByText('Rs 1,500')).toBeInTheDocument()
  expect(screen.getByText('Not accepted yet')).toBeInTheDocument()
  expect(screen.getByText(/Can you do blush pink/)).toBeInTheDocument()
})

it('replies to the customer in the discussion', async () => {
  api.sendAdminCustomOrderMessage.mockResolvedValue(message(2, 'ADMIN', 'Yes, blush pink is fine'))
  open()
  await userEvent.type(await screen.findByLabelText('Write a message'), 'Yes, blush pink is fine')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(api.sendAdminCustomOrderMessage).toHaveBeenCalledWith('c1', 'Yes, blush pink is fine')
  expect(await screen.findByText(/Yes, blush pink is fine/)).toBeInTheDocument()
})

it('proposes a price, starting from the customer budget; the request is not accepted by this', async () => {
  api.proposeCustomOrderPrice.mockResolvedValue(co({ proposed_price_paisa: 200000 }))
  open()
  const price = await screen.findByLabelText('Price to propose in Rs')
  expect(price).toHaveValue('1500')
  await userEvent.clear(price)
  await userEvent.type(price, '2000')
  await userEvent.click(screen.getByRole('button', { name: 'Propose this price' }))
  expect(api.proposeCustomOrderPrice).toHaveBeenCalledWith('c1', 200000)
  expect(api.acceptCustomOrder).not.toHaveBeenCalled()
  expect(await screen.findByText(/Waiting for the customer to confirm/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Change the proposed price' })).toBeInTheDocument()
  expect(screen.getByText('Not accepted yet')).toBeInTheDocument()
})

it('shows the agreed price once the customer has confirmed, with nothing left to propose', async () => {
  api.getAdminCustomOrder.mockResolvedValue(
    co({ status: 'ACCEPTED', proposed_price_paisa: 200000, agreed_price_paisa: 200000 }),
  )
  open()
  expect(await screen.findByText('Rs 2,000')).toBeInTheDocument()
  expect(screen.queryByLabelText('Price to propose in Rs')).not.toBeInTheDocument()
  expect(screen.queryByText(/Waiting for the customer/)).not.toBeInTheDocument()
})

it('rejects a price that is not a number before calling the server', async () => {
  open()
  const price = await screen.findByLabelText('Price to propose in Rs')
  await userEvent.clear(price)
  await userEvent.type(price, 'lots')
  await userEvent.click(screen.getByRole('button', { name: 'Propose this price' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('like 2500')
  expect(api.proposeCustomOrderPrice).not.toHaveBeenCalled()
})

it('explains a refused proposal', async () => {
  api.proposeCustomOrderPrice.mockRejectedValue(
    new ApiError(409, 'x', { code: 'INVALID_TRANSITION' }),
  )
  open()
  await userEvent.click(await screen.findByRole('button', { name: 'Propose this price' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('not allowed from the current status')
})

it('lets the admin record the price a guest agreed on WhatsApp (guests cannot confirm in the system)', async () => {
  api.getAdminCustomOrder.mockResolvedValue(co({ customer_id: null }))
  api.getAdminCustomOrderMessages.mockResolvedValue([])
  api.acceptCustomOrder.mockResolvedValue(
    co({ customer_id: null, status: 'ACCEPTED', agreed_price_paisa: 150000 }),
  )
  open()
  await userEvent.click(await screen.findByRole('button', { name: 'Accept at this price' }))
  expect(api.acceptCustomOrder).toHaveBeenCalledWith('c1', 150000)
  expect(api.proposeCustomOrderPrice).not.toHaveBeenCalled()
  expect(await screen.findByText('Accepted at Rs 1,500')).toBeInTheDocument()
})

it('offers no acceptance form before the discussion starts, and starts it with a button', async () => {
  api.getAdminCustomOrder.mockResolvedValue(co({ status: 'NEW' }))
  api.setCustomOrderStatus.mockResolvedValue(co({ status: 'IN_DISCUSSION' }))
  open()
  expect(await screen.findByText(/Start the discussion first/)).toBeInTheDocument()
  expect(screen.queryByLabelText('Price to propose in Rs')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Start discussion' }))
  expect(api.setCustomOrderStatus).toHaveBeenCalledWith('c1', 'IN_DISCUSSION')
  expect(await screen.findByLabelText('Price to propose in Rs')).toBeInTheDocument()
})

it('says that a guest request has no discussion in the system', async () => {
  api.getAdminCustomOrder.mockResolvedValue(co({ customer_id: null, status: 'NEW' }))
  api.getAdminCustomOrderMessages.mockResolvedValue([])
  open()
  expect(await screen.findByText(/came from a guest/)).toBeInTheDocument()
  expect(screen.queryByLabelText('Write a message')).not.toBeInTheDocument()
})

it('closes the discussion once the request is finished but keeps the messages readable', async () => {
  api.getAdminCustomOrder.mockResolvedValue(co({ status: 'COMPLETED' }))
  open()
  expect(await screen.findByText(/Can you do blush pink/)).toBeInTheDocument()
  expect(screen.getByText(/discussion is closed/)).toBeInTheDocument()
  expect(screen.queryByLabelText('Write a message')).not.toBeInTheDocument()
})
