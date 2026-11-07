import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AdminPaymentAttempt } from '../lib/adminApi'
import { ApiError, type Page } from '../lib/api'
import { ToastProvider } from '../toast/ToastProvider'
import PaymentsAdminPage from './PaymentsAdminPage'

const api = {
  getAdminPayments: vi.fn(),
  getPaymentReceipt: vi.fn(),
  verifyPayment: vi.fn(),
  rejectPayment: vi.fn(),
}
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/adminApi', () => ({
  getAdminPayments: (...a: unknown[]) => api.getAdminPayments(...a),
  getPaymentReceipt: (...a: unknown[]) => api.getPaymentReceipt(...a),
  verifyPayment: (...a: unknown[]) => api.verifyPayment(...a),
  rejectPayment: (...a: unknown[]) => api.rejectPayment(...a),
}))

const row = (over: Partial<AdminPaymentAttempt> = {}): AdminPaymentAttempt => ({
  attempt_id: 'a1',
  status: 'SUBMITTED',
  transaction_reference: 'TX-998877',
  amount_paisa: 270100,
  created_at: '2026-03-05T10:05:00Z',
  rejection_reason: null,
  rejection_note: null,
  reviewed_at: null,
  reviewed_by: null,
  payment_id: 'p1',
  order_id: 'abcdef12-0000-0000-0000-000000000000',
  order_status: 'PENDING',
  method: 'JAZZCASH',
  order_total_paisa: 270100,
  customer_name: 'Ayesha Khan',
  customer_email: 'a@example.com',
  customer_phone: '+923001234567',
  ...over,
})
const page = (items: AdminPaymentAttempt[]): Page<AdminPaymentAttempt> => ({
  items,
  total: items.length,
  page: 1,
  page_size: 20,
})
const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <PaymentsAdminPage />
      </ToastProvider>
    </MemoryRouter>,
  )

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
  api.getAdminPayments.mockResolvedValue(page([row()]))
})

it('lists what is waiting for a check, with everything the admin needs', async () => {
  renderPage()
  expect(await screen.findByRole('link', { name: 'Order ABCDEF12' })).toHaveAttribute(
    'href',
    '/orders/abcdef12-0000-0000-0000-000000000000',
  )
  expect(screen.getByText('TX-998877')).toBeInTheDocument()
  expect(screen.getByText(/Ayesha Khan · a@example.com/)).toBeInTheDocument()
  expect(screen.getByText(/JazzCash · sent/)).toBeInTheDocument()
  expect(screen.getByText('Rs 2,701')).toBeInTheDocument()
  expect(api.getAdminPayments).toHaveBeenCalledWith(
    { status: 'SUBMITTED', page: 1 },
    expect.anything(),
  )
})

it('filters by status', async () => {
  renderPage()
  await screen.findByText('TX-998877')
  api.getAdminPayments.mockResolvedValue(
    page([
      row({
        status: 'REJECTED',
        rejection_reason: 'NOT_RECEIVED',
        reviewed_at: '2026-03-05T11:00:00Z',
      }),
    ]),
  )
  await userEvent.selectOptions(screen.getByLabelText('Show'), 'REJECTED')
  expect(api.getAdminPayments).toHaveBeenLastCalledWith(
    { status: 'REJECTED', page: 1 },
    expect.anything(),
  )
  expect(await screen.findByText(/Payment not received/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Verify payment' })).not.toBeInTheDocument()
})

it('shows the receipt only when asked', async () => {
  api.getPaymentReceipt.mockResolvedValue({ url: 'https://down.example/r.png?sig=1' })
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'View receipt' }))
  expect(await screen.findByRole('img', { name: /Receipt screenshot/ })).toHaveAttribute(
    'src',
    'https://down.example/r.png?sig=1',
  )
  expect(api.getPaymentReceipt).toHaveBeenCalledWith('a1')
})

it('says so when the receipt cannot be loaded', async () => {
  api.getPaymentReceipt.mockRejectedValue(new Error('x'))
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'View receipt' }))
  expect(await screen.findByText('The receipt could not be loaded.')).toBeInTheDocument()
})

it('verifies only after the admin confirms they checked their own account', async () => {
  api.verifyPayment.mockResolvedValue(row({ status: 'PAID' }))
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Verify payment' }))
  const dialog = screen.getByRole('alertdialog', { name: 'Is the money in your account?' })
  expect(dialog).toHaveTextContent('JazzCash merchant account')
  expect(dialog).toHaveTextContent('TX-998877')
  expect(api.verifyPayment).not.toHaveBeenCalled() // nothing happens before the confirmation
  api.getAdminPayments.mockResolvedValue(page([]))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Yes, verify the payment' }))
  expect(api.verifyPayment).toHaveBeenCalledWith('a1')
  expect(await screen.findByText('No payments here.')).toBeInTheDocument()
})

it('explains a payment that someone else already decided', async () => {
  api.verifyPayment.mockRejectedValue(new ApiError(409, 'x', { code: 'ALREADY_REVIEWED' }))
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Verify payment' }))
  await userEvent.click(screen.getByRole('button', { name: 'Yes, verify the payment' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('already verified or rejected')
})

it('rejects with a reason chosen from the list', async () => {
  api.rejectPayment.mockResolvedValue(row({ status: 'REJECTED' }))
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Reject payment' }))
  const dialog = screen.getByRole('alertdialog', { name: 'Reject this payment?' })
  await userEvent.selectOptions(within(dialog).getByLabelText('Reason'), 'AMOUNT_MISMATCH')
  await userEvent.type(within(dialog).getByLabelText(/Note for the customer/), 'Rs 1,000 arrived')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Reject payment' }))
  expect(api.rejectPayment).toHaveBeenCalledWith('a1', 'AMOUNT_MISMATCH', 'Rs 1,000 arrived')
})

it('makes the reason mandatory: "Other" needs a written reason', async () => {
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Reject payment' }))
  const dialog = screen.getByRole('alertdialog', { name: 'Reject this payment?' })
  await userEvent.selectOptions(within(dialog).getByLabelText('Reason'), 'OTHER')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Reject payment' }))
  expect(within(dialog).getByRole('alert')).toHaveTextContent('write the reason')
  expect(api.rejectPayment).not.toHaveBeenCalled()
})
