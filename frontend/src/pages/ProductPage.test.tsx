import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError, type ProductDetail } from '../lib/api'
import { makeAuth } from '../test/auth'
import ProductPage from './ProductPage'

const getProduct = vi.fn()
const getReviews = vi.fn()
const getPublicSettings = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getProduct: (...a: unknown[]) => getProduct(...a),
  getReviews: (...a: unknown[]) => getReviews(...a),
  getPublicSettings: (...a: unknown[]) => getPublicSettings(...a),
}))

const img = (n: number) => ({
  image_id: `i${n}`,
  url: `https://img/${n}.jpg`,
  alt_text: `Photo ${n}`,
  sort_order: n,
})
const detail: ProductDetail = {
  product_id: 'p1',
  name: 'Sunflower',
  price_paisa: 99900,
  category: { category_id: 'c1', name: 'Flowers' },
  availability_type: 'MADE_TO_ORDER',
  is_available: true,
  is_featured: false,
  image: img(1),
  description: 'Bright and cheerful',
  images: [img(1), img(2)],
}

const renderPage = () => {
  const { wrap } = makeAuth()
  return render(
    wrap(
      <Routes>
        <Route path="/shop/:id" element={<ProductPage />} />
      </Routes>,
      '/shop/p1',
    ),
  )
}

beforeEach(() => {
  getPublicSettings.mockReset().mockRejectedValue(new Error('x'))
  getProduct.mockReset()
  getReviews.mockReset().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 10,
    average_rating: null,
    rating_count: 0,
  })
})

it('shows product details and switches images', async () => {
  getProduct.mockResolvedValue(detail)
  renderPage()
  expect(await screen.findByRole('heading', { name: 'Sunflower' })).toBeInTheDocument()
  expect(screen.getByText('Rs 999')).toBeInTheDocument()
  expect(screen.getByText('Made to order')).toBeInTheDocument()
  expect(screen.getByText('Bright and cheerful')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Log in to save/ })).toBeInTheDocument()
  expect(screen.getByAltText('Photo 1')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Show image 2' }))
  expect(screen.getByAltText('Photo 2')).toBeInTheDocument()
})

it('shows not-found for hidden or unknown products', async () => {
  getProduct.mockRejectedValue(new ApiError(404, 'x'))
  renderPage()
  expect(await screen.findByText('Product not found')).toBeInTheDocument()
})

it('shows an error for server failures', async () => {
  getProduct.mockRejectedValue(new ApiError(500, 'x'))
  renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this product')
})

it('lets the shopper pick a quantity, shows the total on the button and adds that many to the bag', async () => {
  getProduct.mockResolvedValue(detail)
  renderPage()
  await screen.findByRole('heading', { name: 'Sunflower' })
  expect(screen.getByRole('button', { name: 'Add to bag · Rs 999' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Increase quantity of Sunflower' }))
  await userEvent.click(screen.getByRole('button', { name: 'Increase quantity of Sunflower' }))
  await userEvent.click(screen.getByRole('button', { name: 'Add to bag · Rs 2,997' }))
  expect(JSON.parse(window.localStorage.getItem('crochet-cart-v1')!)).toEqual([
    { product_id: 'p1', quantity: 3 },
  ])
  expect(await screen.findByText(/Sunflower added to your bag/)).toBeInTheDocument()
})

it('offers no quantity or add button for an unavailable product', async () => {
  getProduct.mockResolvedValue({ ...detail, is_available: false })
  renderPage()
  await screen.findByRole('heading', { name: 'Sunflower' })
  expect(screen.queryByRole('group', { name: /Quantity/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled()
  expect(screen.getByText('Currently unavailable')).toBeInTheDocument()
})

it('offers a WhatsApp chat about this piece, with the name, price and link typed in', async () => {
  getPublicSettings.mockResolvedValue({ whatsapp: '0300 1234567' })
  getProduct.mockResolvedValue(detail)
  renderPage()
  const chat = await screen.findByRole('link', { name: /Ask about this on WhatsApp/ })
  const href = chat.getAttribute('href')!
  expect(href).toMatch(/^https:\/\/wa\.me\/923001234567\?text=/)
  const text = decodeURIComponent(href.split('?text=')[1])
  expect(text).toContain('Sunflower')
  expect(text).toContain('/shop/p1')
})

it('shows no WhatsApp link when the shop has no number', async () => {
  getProduct.mockResolvedValue(detail)
  renderPage()
  await screen.findByRole('heading', { name: 'Sunflower' })
  expect(screen.queryByRole('link', { name: /WhatsApp/ })).not.toBeInTheDocument()
})
