import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Quote, QuoteLine } from '../lib/api'
import { saveCart } from '../lib/cart'
import { makeAuth } from '../test/auth'
import CartPage from './CartPage'

const getQuote = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getQuote: (...a: unknown[]) => getQuote(...a),
}))

const line = (over: Partial<QuoteLine> = {}): QuoteLine => ({
  product_id: 'p1',
  quantity: 2,
  name: 'Sunflower',
  unit_price_paisa: 125050,
  line_total_paisa: 250100,
  image: null,
  issue: null,
  max_quantity: null,
  ...over,
})
const quote = (lines: QuoteLine[], over: Partial<Quote> = {}): Quote => ({
  lines,
  subtotal_paisa: 250100,
  delivery_fee_paisa: 20000,
  total_paisa: 270100,
  payment_methods: ['COD'],
  can_checkout: true,
  ...over,
})

const renderCart = () =>
  render(
    makeAuth().wrap(
      <Routes>
        <Route path="/cart" element={<CartPage />} />
        <Route path="/checkout" element={<p>checkout page</p>} />
      </Routes>,
      '/cart',
    ),
  )

beforeEach(() => {
  getQuote.mockReset()
})

it('shows an empty cart without calling the API', () => {
  renderCart()
  expect(screen.getByText('Your bag is empty')).toBeInTheDocument()
  expect(getQuote).not.toHaveBeenCalled()
})

it('shows server prices and totals, and sends only ids and quantities', async () => {
  saveCart([{ product_id: 'p1', quantity: 2 }])
  getQuote.mockResolvedValue(quote([line()]))
  renderCart()
  expect(await screen.findByText('Sunflower')).toBeInTheDocument()
  expect(screen.getAllByText('Rs 2,501').length).toBeGreaterThan(0)
  expect(screen.getByText('Rs 200')).toBeInTheDocument() // delivery fee from the backend
  expect(screen.getByText('Rs 2,701')).toBeInTheDocument()
  expect(getQuote.mock.calls[0][0]).toEqual([{ product_id: 'p1', quantity: 2 }])
  expect(screen.getByRole('link', { name: 'Proceed to checkout' })).toHaveAttribute(
    'href',
    '/checkout',
  )
})

it('flags unavailable lines, offers to reduce, and blocks checkout', async () => {
  saveCart([
    { product_id: 'p1', quantity: 5 },
    { product_id: 'p2', quantity: 1 },
  ])
  getQuote.mockResolvedValue(
    quote(
      [
        line({ quantity: 5, issue: 'EXCEEDS_AVAILABLE', max_quantity: 2 }),
        line({
          product_id: 'p2',
          name: null,
          unit_price_paisa: null,
          line_total_paisa: null,
          issue: 'NOT_FOUND',
        }),
      ],
      { can_checkout: false },
    ),
  )
  renderCart()
  expect(await screen.findByText('Only 2 available.')).toBeInTheDocument()
  expect(screen.getByText('This product is no longer available.')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Proceed to checkout' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Reduce to 2' }))
  expect(JSON.parse(window.localStorage.getItem('crochet-cart-v1')!)[0].quantity).toBe(2)
})

it('removes a line', async () => {
  saveCart([{ product_id: 'p1', quantity: 2 }])
  getQuote.mockResolvedValue(quote([line()]))
  renderCart()
  await userEvent.click(await screen.findByRole('button', { name: 'Remove Sunflower from bag' }))
  expect(await screen.findByText('Your bag is empty')).toBeInTheDocument()
})

it('shows an error state', async () => {
  saveCart([{ product_id: 'p1', quantity: 1 }])
  getQuote.mockRejectedValue(new Error('x'))
  renderCart()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your bag')
})

it('changes the quantity with the stepper (and the quote follows the new quantity)', async () => {
  saveCart([{ product_id: 'p1', quantity: 2 }])
  // like the real server, answer with the quantity that was asked for
  getQuote.mockImplementation((items: { quantity: number }[]) =>
    Promise.resolve(quote([line({ quantity: items[0].quantity })])),
  )
  renderCart()
  await userEvent.click(
    await screen.findByRole('button', { name: 'Increase quantity of Sunflower' }),
  )
  expect(JSON.parse(window.localStorage.getItem('crochet-cart-v1')!)[0].quantity).toBe(3)
  await vi.waitFor(() =>
    expect(getQuote.mock.calls.at(-1)![0]).toEqual([{ product_id: 'p1', quantity: 3 }]),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Decrease quantity of Sunflower' }))
  expect(JSON.parse(window.localStorage.getItem('crochet-cart-v1')!)[0].quantity).toBe(2)
})

it('cannot step below one (the shopper uses Remove instead)', async () => {
  saveCart([{ product_id: 'p1', quantity: 1 }])
  getQuote.mockResolvedValue(quote([line({ quantity: 1 })]))
  renderCart()
  expect(
    await screen.findByRole('button', { name: 'Decrease quantity of Sunflower' }),
  ).toBeDisabled()
})

it('summarises the order beside the lines and links on to checkout', async () => {
  saveCart([{ product_id: 'p1', quantity: 2 }])
  getQuote.mockResolvedValue(quote([line()]))
  renderCart()
  const summary = await screen.findByRole('complementary', { name: 'Order summary' })
  expect(summary).toHaveTextContent('Delivery in Lahore')
  expect(summary).toHaveTextContent('Cash on Delivery · Lahore only') // only what the shop offers
  expect(summary.querySelector('a[href="/checkout"]')).toHaveTextContent('Proceed to checkout')
})
