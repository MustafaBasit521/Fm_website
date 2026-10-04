import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import FakeGatewayPage from './FakeGatewayPage'

const fakeGatewayComplete = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  fakeGatewayComplete: (...a: unknown[]) => fakeGatewayComplete(...a),
}))

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/dev/fake-gateway?ref=fake_abc&order=o1']}>
      <Routes>
        <Route path="/dev/fake-gateway" element={<FakeGatewayPage />} />
        <Route path="/payment/return" element={<p>return page</p>} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  fakeGatewayComplete.mockReset()
})

it('completes the simulated payment and returns to the shop', async () => {
  fakeGatewayComplete.mockResolvedValue({ received: true })
  renderPage()
  expect(screen.getByText(/Development only/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Pay successfully' }))
  expect(fakeGatewayComplete).toHaveBeenCalledWith('fake_abc', 'paid')
  expect(await screen.findByText('return page')).toBeInTheDocument()
})

it('can simulate a failure and reports gateway errors', async () => {
  fakeGatewayComplete.mockRejectedValue(new Error('x'))
  renderPage()
  await userEvent.click(screen.getByRole('button', { name: 'Fail the payment' }))
  expect(fakeGatewayComplete).toHaveBeenCalledWith('fake_abc', 'failed')
  expect(await screen.findByRole('alert')).toHaveTextContent('PAYMENT_PROVIDER=fake')
})
