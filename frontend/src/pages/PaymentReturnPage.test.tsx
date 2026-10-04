import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import PaymentReturnPage from './PaymentReturnPage'

const refreshPayment = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/navigation', () => ({ redirectTo: vi.fn() }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  refreshPayment: (...a: unknown[]) => refreshPayment(...a),
  payOrder: vi.fn(),
}))

const renderPage = (path = '/payment/return?order=o1') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <PaymentReturnPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  refreshPayment.mockReset()
})

it('asks the server (not the URL) and shows success', async () => {
  refreshPayment.mockResolvedValue({ order_status: 'CONFIRMED', payment_status: 'PAID' })
  renderPage('/payment/return?order=o1&status=success') // a claimed status in the URL is ignored
  expect(await screen.findByText('Payment received')).toBeInTheDocument()
  expect(refreshPayment).toHaveBeenCalledWith('o1')
})

it('offers a retry after a failed payment', async () => {
  refreshPayment.mockResolvedValue({ order_status: 'PENDING', payment_status: 'FAILED' })
  renderPage()
  expect(await screen.findByText('Payment failed')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try paying again' })).toBeInTheDocument()
})

it('lets the customer check again while the payment is still pending', async () => {
  refreshPayment.mockResolvedValue({ order_status: 'PENDING', payment_status: 'PENDING' })
  renderPage()
  expect(await screen.findByText('Waiting for your payment')).toBeInTheDocument()
  refreshPayment.mockResolvedValue({ order_status: 'CONFIRMED', payment_status: 'PAID' })
  await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
  expect(await screen.findByText('Payment received')).toBeInTheDocument()
  expect(refreshPayment).toHaveBeenCalledTimes(2)
})

it('explains a payment that arrived after the order was cancelled', async () => {
  refreshPayment.mockResolvedValue({ order_status: 'CANCELLED', payment_status: 'PAID' })
  renderPage()
  expect(await screen.findByText('Your payment arrived too late')).toBeInTheDocument()
  expect(screen.getByText(/refunded in full/)).toBeInTheDocument()
})

it('shows a cancelled order and a service error', async () => {
  refreshPayment.mockResolvedValue({ order_status: 'CANCELLED', payment_status: 'PENDING' })
  const { unmount } = renderPage()
  expect(await screen.findByText('Order cancelled')).toBeInTheDocument()
  unmount()
  refreshPayment.mockRejectedValue(new Error('x'))
  renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('could not reach the payment service')
})

it('handles a missing order id', () => {
  renderPage('/payment/return')
  expect(screen.getByText('No order was specified.')).toBeInTheDocument()
  expect(refreshPayment).not.toHaveBeenCalled()
})
