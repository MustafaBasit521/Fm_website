import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError, type CustomOrder } from '../lib/api'
import { fakeSession, makeAuth } from '../test/auth'
import CustomOrderDetailPage from './CustomOrderDetailPage'

const api = {
  getCustomOrder: vi.fn(),
  getCustomOrderMessages: vi.fn(),
  sendCustomOrderMessage: vi.fn(),
  confirmCustomOrderPrice: vi.fn(),
  declineCustomOrderPrice: vi.fn(),
  offerCustomOrderPrice: vi.fn(),
}
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getCustomOrder: (...a: unknown[]) => api.getCustomOrder(...a),
  getCustomOrderMessages: (...a: unknown[]) => api.getCustomOrderMessages(...a),
  sendCustomOrderMessage: (...a: unknown[]) => api.sendCustomOrderMessage(...a),
  confirmCustomOrderPrice: (...a: unknown[]) => api.confirmCustomOrderPrice(...a),
  declineCustomOrderPrice: (...a: unknown[]) => api.declineCustomOrderPrice(...a),
  offerCustomOrderPrice: (...a: unknown[]) => api.offerCustomOrderPrice(...a),
}))

const co = (over: Partial<CustomOrder> = {}): CustomOrder => ({
  custom_order_id: 'c1',
  name: 'Sara',
  whatsapp_number: '0300',
  description: 'A jersey with a name',
  budget_paisa: 150000,
  customer_offer_paisa: null,
  proposed_price_paisa: null,
  agreed_price_paisa: null,
  required_date: null,
  status: 'IN_DISCUSSION',
  has_reference_image: false,
  created_at: '2026-03-05T10:00:00Z',
  updated_at: '2026-03-05T10:00:00Z',
  ...over,
})
const message = (n: number, sender: 'CUSTOMER' | 'ADMIN', body: string) => ({
  message_id: `m${n}`,
  sender,
  body,
  created_at: '2026-03-06T10:00:00Z',
})

const open = () => {
  const { wrap } = makeAuth({ session: fakeSession })
  return render(
    wrap(
      <Routes>
        <Route path="/custom-orders/:id" element={<CustomOrderDetailPage />} />
      </Routes>,
      '/custom-orders/c1',
    ),
  )
}

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
  api.getCustomOrder.mockResolvedValue(co())
  api.getCustomOrderMessages.mockResolvedValue([message(1, 'ADMIN', 'What colour would you like?')])
})

it('shows the request and the conversation, and sends a reply', async () => {
  api.sendCustomOrderMessage.mockResolvedValue(message(2, 'CUSTOMER', 'Blush pink please'))
  open()
  expect(await screen.findByText('A jersey with a name')).toBeInTheDocument()
  expect(screen.getByText(/What colour would you like/)).toBeInTheDocument()
  expect(screen.getByText(/The shop proposes it and you confirm it/)).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Write a message'), 'Blush pink please')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(api.sendCustomOrderMessage).toHaveBeenCalledWith('c1', 'Blush pink please')
  expect(await screen.findByText(/Blush pink please/)).toBeInTheDocument()
  expect(screen.getByLabelText('Write a message')).toHaveValue('') // the box is cleared
})

it('does not send an empty message', async () => {
  open()
  await screen.findByLabelText('Write a message')
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
})

it('shows the agreed price once the shop has accepted', async () => {
  api.getCustomOrder.mockResolvedValue(co({ status: 'ACCEPTED', agreed_price_paisa: 200000 }))
  open()
  expect(await screen.findByText('Rs 2,000')).toBeInTheDocument()
  expect(screen.queryByText(/you confirm it here/)).not.toBeInTheDocument()
})

it('closes the box for a finished request but keeps the messages', async () => {
  api.getCustomOrder.mockResolvedValue(co({ status: 'DECLINED' }))
  open()
  expect(await screen.findByText(/What colour would you like/)).toBeInTheDocument()
  expect(screen.getByText(/discussion is closed/)).toBeInTheDocument()
  expect(screen.queryByLabelText('Write a message')).not.toBeInTheDocument()
})

it('explains a failed send and keeps the text', async () => {
  api.sendCustomOrderMessage.mockRejectedValue(new ApiError(409, 'x'))
  open()
  await userEvent.type(await screen.findByLabelText('Write a message'), 'Hello')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not send')
  expect(screen.getByLabelText('Write a message')).toHaveValue('Hello')
})

it('says so when the request is not found', async () => {
  api.getCustomOrder.mockRejectedValue(new ApiError(404, 'x'))
  api.getCustomOrderMessages.mockRejectedValue(new ApiError(404, 'x'))
  open()
  expect(await screen.findByRole('alert')).toHaveTextContent('could not find')
})

it('asks the customer to confirm a proposed price, and accepts only after the pop-up is confirmed', async () => {
  api.getCustomOrder.mockResolvedValue(co({ proposed_price_paisa: 250000 }))
  api.confirmCustomOrderPrice.mockResolvedValue(
    co({ status: 'ACCEPTED', proposed_price_paisa: 250000, agreed_price_paisa: 250000 }),
  )
  open()
  expect(await screen.findByText('Rs 2,500')).toBeInTheDocument()
  expect(screen.getByText(/Nothing is agreed until you confirm/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Accept this price' }))
  const dialog = screen.getByRole('alertdialog', { name: 'Accept this price?' })
  expect(dialog).toHaveTextContent('Rs 2,500')
  expect(api.confirmCustomOrderPrice).not.toHaveBeenCalled() // the pop-up has to be confirmed
  await userEvent.click(screen.getByRole('button', { name: 'Yes, accept' }))
  expect(api.confirmCustomOrderPrice).toHaveBeenCalledWith('c1', 250000)
  expect(await screen.findByText('Agreed price')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Accept this price' })).not.toBeInTheDocument()
})

it('does nothing when the customer says "Not yet" in the pop-up', async () => {
  api.getCustomOrder.mockResolvedValue(co({ proposed_price_paisa: 250000 }))
  open()
  await userEvent.click(await screen.findByRole('button', { name: 'Accept this price' }))
  await userEvent.click(screen.getByRole('button', { name: 'Not yet' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(api.confirmCustomOrderPrice).not.toHaveBeenCalled()
})

it('warns when the shop changed the price while the pop-up was open', async () => {
  api.getCustomOrder.mockResolvedValue(co({ proposed_price_paisa: 250000 }))
  api.confirmCustomOrderPrice.mockRejectedValue(new ApiError(409, 'x', { code: 'PRICE_CHANGED' }))
  open()
  await userEvent.click(await screen.findByRole('button', { name: 'Accept this price' }))
  await userEvent.click(screen.getByRole('button', { name: 'Yes, accept' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('changed the price')
})

it('shows no accept button when nothing has been proposed or the request is not in discussion', async () => {
  open()
  await screen.findByText('A jersey with a name')
  expect(screen.queryByRole('button', { name: 'Accept this price' })).not.toBeInTheDocument()
})

it('lets the customer decline a proposed price after a pop-up', async () => {
  api.getCustomOrder.mockResolvedValue(co({ proposed_price_paisa: 800000 }))
  api.declineCustomOrderPrice.mockImplementation(async () => {
    api.getCustomOrder.mockResolvedValue(co({ proposed_price_paisa: null })) // the reload sees it
    return co({ proposed_price_paisa: null })
  })
  open()
  await userEvent.click(await screen.findByRole('button', { name: 'Decline' }))
  expect(api.declineCustomOrderPrice).not.toHaveBeenCalled() // the pop-up asks first
  expect(screen.getByRole('alertdialog', { name: 'Decline this price?' })).toHaveTextContent(
    'Rs 8,000',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Yes, decline' }))
  expect(api.declineCustomOrderPrice).toHaveBeenCalledWith('c1')
  expect(screen.queryByRole('button', { name: 'Accept this price' })).not.toBeInTheDocument()
})

it('lets the customer offer a different price instead', async () => {
  api.getCustomOrder.mockResolvedValue(co({ proposed_price_paisa: 800000 }))
  api.offerCustomOrderPrice.mockImplementation(async () => {
    const updated = co({ proposed_price_paisa: null, customer_offer_paisa: 600000 })
    api.getCustomOrder.mockResolvedValue(updated) // the reload sees it
    return updated
  })
  open()
  await userEvent.click(await screen.findByRole('button', { name: 'Offer a different price' }))
  await userEvent.type(screen.getByLabelText('Your offer in Rs'), '6000')
  await userEvent.click(screen.getByRole('button', { name: 'Send my offer' }))
  expect(api.offerCustomOrderPrice).toHaveBeenCalledWith('c1', 600000)
  expect(await screen.findByText(/You offered/)).toBeInTheDocument()
  expect(screen.getByText('Rs 6,000')).toBeInTheDocument()
  expect(screen.getByText(/Waiting for the shop/)).toBeInTheDocument()
})

it('rejects an offer that is not a number before calling the server', async () => {
  api.getCustomOrder.mockResolvedValue(co({ proposed_price_paisa: 800000 }))
  open()
  await userEvent.click(await screen.findByRole('button', { name: 'Offer a different price' }))
  await userEvent.type(screen.getByLabelText('Your offer in Rs'), 'lots')
  await userEvent.click(screen.getByRole('button', { name: 'Send my offer' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('like 2500')
  expect(api.offerCustomOrderPrice).not.toHaveBeenCalled()
})

it('shows a waiting offer and lets the customer change it', async () => {
  api.getCustomOrder.mockResolvedValue(co({ customer_offer_paisa: 600000 }))
  open()
  expect(await screen.findByText(/You offered/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Change my offer' }))
  expect(screen.getByLabelText('Your offer in Rs')).toBeInTheDocument()
})
