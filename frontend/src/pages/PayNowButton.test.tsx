import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api'
import { PayNowButton } from './PayNowButton'

const payOrder = vi.fn()
const redirectTo = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/navigation', () => ({ redirectTo: (u: string) => redirectTo(u) }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  payOrder: (...a: unknown[]) => payOrder(...a),
}))

beforeEach(() => {
  payOrder.mockReset()
  redirectTo.mockReset()
})

it('starts a payment and sends the browser to the gateway', async () => {
  payOrder.mockResolvedValue({ payment_id: 'p1', redirect_url: 'https://gateway.test/pay/abc' })
  render(<PayNowButton orderId="o1" />)
  await userEvent.click(screen.getByRole('button', { name: 'Pay now' }))
  expect(payOrder).toHaveBeenCalledWith('o1')
  expect(redirectTo).toHaveBeenCalledWith('https://gateway.test/pay/abc')
})

it.each([
  ['ALREADY_PAID', 409, 'already paid'],
  ['PAYMENT_IN_PROGRESS', 409, 'already in progress'],
  ['WINDOW_EXPIRED', 409, 'window has passed'],
  ['NOT_PAYABLE', 409, 'can no longer be paid'],
])('explains %s', async (code, status, text) => {
  payOrder.mockRejectedValue(new ApiError(status, 'x', { code }))
  render(<PayNowButton orderId="o1" />)
  await userEvent.click(screen.getByRole('button', { name: 'Pay now' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(text)
  expect(redirectTo).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Pay now' })).toBeEnabled() // can try again
})

it('handles an unavailable payment service and unexpected errors', async () => {
  payOrder.mockRejectedValueOnce(new ApiError(503, 'x'))
  render(<PayNowButton orderId="o1" />)
  await userEvent.click(screen.getByRole('button', { name: 'Pay now' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable')
  payOrder.mockRejectedValueOnce(new Error('boom'))
  await userEvent.click(screen.getByRole('button', { name: 'Pay now' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not start the payment')
})
