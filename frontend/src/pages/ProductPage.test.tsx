import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError, type ProductDetail } from '../lib/api'
import { makeAuth } from '../test/auth'
import ProductPage from './ProductPage'

const getProduct = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getProduct: (...a: unknown[]) => getProduct(...a),
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
  getProduct.mockReset()
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
