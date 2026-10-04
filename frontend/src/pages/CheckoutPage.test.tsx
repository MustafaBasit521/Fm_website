import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError, type Address, type Quote } from '../lib/api'
import { loadLastOrder } from '../lib/lastOrder'
import { saveCart } from '../lib/cart'
import { fakeSession, makeAuth } from '../test/auth'
import CheckoutPage from './CheckoutPage'

const api = { getQuote: vi.fn(), createOrder: vi.fn(), getMe: vi.fn(), getAddresses: vi.fn() }
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getQuote: (...a: unknown[]) => api.getQuote(...a),
  createOrder: (...a: unknown[]) => api.createOrder(...a),
  getMe: (...a: unknown[]) => api.getMe(...a),
  getAddresses: (...a: unknown[]) => api.getAddresses(...a),
}))

const okQuote: Quote = {
  lines: [
    {
      product_id: 'p1',
      quantity: 2,
      name: 'Sunflower',
      unit_price_paisa: 125050,
      line_total_paisa: 250100,
      image: null,
      issue: null,
      max_quantity: null,
    },
  ],
  subtotal_paisa: 250100,
  delivery_fee_paisa: 20000,
  total_paisa: 270100,
  payment_methods: ['COD'],
  can_checkout: true,
}
const order = {
  order_id: 'o1',
  customer_name: 'Ayesha',
  customer_email: 'a@example.com',
  payment_method: 'COD',
  items: [],
}
const saved: Address = {
  address_id: 'a1',
  label: 'Home',
  house_no: '12-B',
  street_number: null,
  city: 'Lahore',
  province: null,
  postal_code: '54000',
  country: 'Pakistan',
  created_at: '2026-01-01T00:00:00Z',
}

const renderCheckout = (signedIn = false) =>
  render(
    makeAuth(signedIn ? { session: fakeSession } : {}).wrap(
      <Routes>
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/order-confirmation" element={<p>confirmation page</p>} />
      </Routes>,
      '/checkout',
    ),
  )

async function fillGuestForm() {
  await userEvent.type(await screen.findByLabelText('Full name'), 'Ayesha Khan')
  await userEvent.type(screen.getByLabelText('Email'), 'a@example.com')
  await userEvent.type(screen.getByLabelText('House number'), '12-B')
  await userEvent.type(screen.getByLabelText('Postal code'), '54000')
}

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
  api.getQuote.mockResolvedValue(okQuote)
  api.getMe.mockResolvedValue({ name: 'Reg User', email: 'reg@example.com', phone: null })
  api.getAddresses.mockResolvedValue([])
  saveCart([{ product_id: 'p1', quantity: 2 }])
})

it('lets a guest place a COD order: sends the expected total, clears the cart, shows confirmation', async () => {
  api.createOrder.mockResolvedValue(order)
  renderCheckout()
  await fillGuestForm()
  await userEvent.click(screen.getByRole('button', { name: 'Place order' }))

  expect(await screen.findByText('confirmation page')).toBeInTheDocument()
  const sent = api.createOrder.mock.calls[0][0]
  expect(sent.items).toEqual([{ product_id: 'p1', quantity: 2 }])
  expect(sent.payment_method).toBe('COD')
  expect(sent.expected_total_paisa).toBe(270100)
  expect(sent.delivery.address).toMatchObject({
    house_no: '12-B',
    city: 'Lahore',
    postal_code: '54000',
  })
  expect(sent.delivery.address_id).toBeUndefined()
  // no client-computed prices are ever sent
  expect(JSON.stringify(sent)).not.toMatch(/price|subtotal/)
  expect(window.localStorage.getItem('crochet-cart-v1')).toBe('[]')
  expect(loadLastOrder()?.order_id).toBe('o1')
})

it('prefills a registered customer and uses a saved address id', async () => {
  api.getAddresses.mockResolvedValue([saved])
  api.createOrder.mockResolvedValue(order)
  renderCheckout(true)
  expect(await screen.findByDisplayValue('Reg User')).toBeInTheDocument()
  expect(screen.getByLabelText(/Home, 12-B/)).toBeChecked()
  expect(screen.queryByLabelText('House number')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Place order' }))
  await screen.findByText('confirmation page')
  const sent = api.createOrder.mock.calls[0][0]
  expect(sent.delivery.address_id).toBe('a1')
  expect(sent.delivery.address).toBeUndefined()
})

it('shows the new total when it changed and keeps the cart', async () => {
  api.createOrder.mockRejectedValue(
    new ApiError(409, 'x', { code: 'TOTAL_CHANGED', total_paisa: 300000 }),
  )
  renderCheckout()
  await fillGuestForm()
  await userEvent.click(screen.getByRole('button', { name: 'Place order' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('The total has changed to Rs 3,000')
  expect(JSON.parse(window.localStorage.getItem('crochet-cart-v1')!)).toHaveLength(1)
})

it.each([
  ['CHECKOUT_INVALID', 409, 'no longer available'],
  ['NOT_DELIVERABLE', 422, 'only within Lahore'],
])('explains %s errors and keeps the cart', async (code, status, text) => {
  api.createOrder.mockRejectedValue(new ApiError(status, 'x', { code }))
  renderCheckout()
  await fillGuestForm()
  await userEvent.click(screen.getByRole('button', { name: 'Place order' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(text)
  expect(JSON.parse(window.localStorage.getItem('crochet-cart-v1')!)).toHaveLength(1)
})

it('blocks checkout when the quote has problems', async () => {
  api.getQuote.mockResolvedValue({ ...okQuote, can_checkout: false })
  renderCheckout()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Some items in your cart are unavailable',
  )
  expect(screen.queryByRole('button', { name: 'Place order' })).not.toBeInTheDocument()
})

it('offers online payment only when the backend lists it', async () => {
  api.getQuote.mockResolvedValue({ ...okQuote, payment_methods: ['COD', 'ONLINE'] })
  renderCheckout()
  expect(await screen.findByLabelText('Pay online')).toBeInTheDocument()
  expect(screen.getByLabelText('Cash on delivery')).toBeChecked()
})

it('shows an empty-cart message', () => {
  window.localStorage.clear()
  renderCheckout()
  expect(screen.getByText(/Your cart is empty/)).toBeInTheDocument()
})
