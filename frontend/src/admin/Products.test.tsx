import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AdminProduct } from '../lib/adminApi'
import { ApiError, type Page } from '../lib/api'
import ProductFormPage from './ProductFormPage'
import ProductsAdminPage from './ProductsAdminPage'

const api = {
  getAdminCategories: vi.fn(),
  getAdminProducts: vi.fn(),
  getAdminProduct: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
  getProductImageUpload: vi.fn(),
  registerProductImage: vi.fn(),
  updateProductImage: vi.fn(),
  deleteProductImage: vi.fn(),
}
const uploadToSignedUrl = vi.fn()
vi.mock('../lib/supabase', () => ({
  supabase: {
    storage: {
      from: (b: string) => ({ uploadToSignedUrl: (...a: unknown[]) => uploadToSignedUrl(b, ...a) }),
    },
  },
}))
vi.mock('../lib/adminApi', () => ({
  getAdminCategories: (...a: unknown[]) => api.getAdminCategories(...a),
  getAdminProducts: (...a: unknown[]) => api.getAdminProducts(...a),
  getAdminProduct: (...a: unknown[]) => api.getAdminProduct(...a),
  createProduct: (...a: unknown[]) => api.createProduct(...a),
  updateProduct: (...a: unknown[]) => api.updateProduct(...a),
  deleteProduct: (...a: unknown[]) => api.deleteProduct(...a),
  getProductImageUpload: (...a: unknown[]) => api.getProductImageUpload(...a),
  registerProductImage: (...a: unknown[]) => api.registerProductImage(...a),
  updateProductImage: (...a: unknown[]) => api.updateProductImage(...a),
  deleteProductImage: (...a: unknown[]) => api.deleteProductImage(...a),
}))

const cats = [
  { category_id: 'c1', name: 'Flowers', product_count: 2 },
  { category_id: 'c2', name: 'Amigurumi', product_count: 0 },
]
const product = (over: Partial<AdminProduct> = {}): AdminProduct => ({
  product_id: 'p1',
  name: 'Sunflower',
  price_paisa: 125050,
  category: { category_id: 'c1', name: 'Flowers' },
  availability_type: 'READY_TO_SHIP',
  is_available: true,
  is_featured: false,
  image: null,
  description: 'Bright',
  images: [],
  category_id: 'c1',
  stock_quantity: 5,
  max_active_units: 0,
  is_visible: true,
  created_at: '',
  updated_at: '',
  ...over,
})
const page = (items: AdminProduct[], total = items.length): Page<AdminProduct> => ({
  items,
  total,
  page: 1,
  page_size: 20,
})

const renderList = () =>
  render(
    <MemoryRouter>
      <ProductsAdminPage />
    </MemoryRouter>,
  )
const renderForm = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/products/new" element={<ProductFormPage />} />
        <Route path="/admin/products/:id" element={<ProductFormPage />} />
        <Route path="/admin/products" element={<p>products list</p>} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
  uploadToSignedUrl.mockReset().mockResolvedValue({ error: null })
  api.getAdminCategories.mockResolvedValue(cats)
})

// ---- list ----------------------------------------------------------------------------------

it('lists products with visibility, stock and filters', async () => {
  api.getAdminProducts.mockResolvedValue(
    page([
      product(),
      product({
        product_id: 'p2',
        name: 'Bunny',
        is_visible: false,
        availability_type: 'MADE_TO_ORDER',
        max_active_units: 3,
        is_featured: true,
      }),
    ]),
  )
  renderList()
  expect(await screen.findByText('Sunflower')).toBeInTheDocument()
  expect(screen.getByText('5 in stock')).toBeInTheDocument()
  expect(screen.getByText('Capacity 3')).toBeInTheDocument()
  expect(screen.getByText('Hidden')).toBeInTheDocument()
  expect(screen.getByText('Featured')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Add product' })).toHaveAttribute(
    'href',
    '/admin/products/new',
  )
  await userEvent.selectOptions(screen.getByLabelText('Category'), 'c2')
  expect(api.getAdminProducts.mock.calls.at(-1)![0]).toMatchObject({ category_id: 'c2', page: 1 })
  await userEvent.type(screen.getByLabelText('Search'), 'bun{Enter}')
  expect(api.getAdminProducts.mock.calls.at(-1)![0].search).toBe('bun')
})

it('shows empty and error states for the list', async () => {
  api.getAdminProducts.mockResolvedValue(page([]))
  const a = renderList()
  expect(await screen.findByText('No products match.')).toBeInTheDocument()
  a.unmount()
  api.getAdminProducts.mockRejectedValue(new Error('x'))
  renderList()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
})

// ---- create --------------------------------------------------------------------------------

it('creates a product, converting the price to paisa, and opens it for pictures', async () => {
  api.createProduct.mockResolvedValue(product())
  api.getAdminProduct.mockResolvedValue(product())
  renderForm('/admin/products/new')
  await userEvent.type(await screen.findByLabelText('Product name'), 'Sunflower')
  await userEvent.selectOptions(screen.getByLabelText('Category'), 'c1')
  await userEvent.type(screen.getByLabelText('Price (Rs)'), '1250.50')
  await userEvent.clear(screen.getByLabelText('Pieces in stock'))
  await userEvent.type(screen.getByLabelText('Pieces in stock'), '5')
  await userEvent.click(screen.getByLabelText('Show in shop'))
  await userEvent.click(screen.getByRole('button', { name: 'Create product' }))
  expect(api.createProduct).toHaveBeenCalledWith({
    category_id: 'c1',
    name: 'Sunflower',
    description: null,
    price_paisa: 125050,
    availability_type: 'READY_TO_SHIP',
    stock_quantity: 5,
    max_active_units: 0,
    is_visible: true,
    is_featured: false,
  })
  expect(await screen.findByRole('heading', { name: 'Edit product' })).toBeInTheDocument()
})

it('shows capacity (not stock) for made-to-order products', async () => {
  renderForm('/admin/products/new')
  await screen.findByLabelText('Product name')
  expect(screen.getByLabelText('Pieces in stock')).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Availability'), 'MADE_TO_ORDER')
  expect(screen.queryByLabelText('Pieces in stock')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Most units in progress at once')).toBeInTheDocument()
})

it('rejects a bad price or bad numbers before calling the server', async () => {
  renderForm('/admin/products/new')
  await userEvent.type(await screen.findByLabelText('Product name'), 'X')
  await userEvent.selectOptions(screen.getByLabelText('Category'), 'c1')
  await userEvent.type(screen.getByLabelText('Price (Rs)'), 'cheap')
  await userEvent.click(screen.getByRole('button', { name: 'Create product' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('like 1250 or 1250.50')
  expect(api.createProduct).not.toHaveBeenCalled()
})

// ---- edit ----------------------------------------------------------------------------------

it('loads a product, saves changes and deletes it after confirmation', async () => {
  api.getAdminProduct.mockResolvedValue(product())
  api.updateProduct.mockResolvedValue(product({ price_paisa: 99900 }))
  api.deleteProduct.mockResolvedValue(undefined)
  renderForm('/admin/products/p1')
  expect(await screen.findByDisplayValue('Sunflower')).toBeInTheDocument()
  expect(screen.getByLabelText('Price (Rs)')).toHaveValue('1250.50')
  const price = screen.getByLabelText('Price (Rs)')
  await userEvent.clear(price)
  await userEvent.type(price, '999')
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(api.updateProduct.mock.calls[0][0]).toBe('p1')
  expect(api.updateProduct.mock.calls[0][1]).toMatchObject({
    price_paisa: 99900,
    name: 'Sunflower',
  })
  expect(await screen.findByText('Saved.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Delete product' }))
  expect(api.deleteProduct).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Yes, delete this product' }))
  expect(api.deleteProduct).toHaveBeenCalledWith('p1')
  expect(await screen.findByText('products list')).toBeInTheDocument()
})

it('explains why the availability type cannot change while orders are active', async () => {
  api.getAdminProduct.mockResolvedValue(product())
  api.updateProduct.mockRejectedValue(new ApiError(409, 'x', { code: 'ACTIVE_ORDERS' }))
  renderForm('/admin/products/p1')
  await userEvent.selectOptions(await screen.findByLabelText('Availability'), 'MADE_TO_ORDER')
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('still active')
})

// ---- pictures ------------------------------------------------------------------------------

it('uploads a picture straight to storage and registers it', async () => {
  api.getAdminProduct.mockResolvedValueOnce(product()).mockResolvedValue(
    product({
      images: [{ image_id: 'i1', url: 'https://img/1.jpg', alt_text: null, sort_order: 0 }],
    }),
  )
  api.getProductImageUpload.mockResolvedValue({
    storage_path: 'products/p1/abc.png',
    upload_url: 'u',
    token: 't',
    bucket: 'product-images',
  })
  api.registerProductImage.mockResolvedValue({ image_id: 'i1' })
  renderForm('/admin/products/p1')
  const file = new File(['x'], 'a.png', { type: 'image/png' })
  await userEvent.upload(await screen.findByLabelText(/Add a picture/), file)
  expect(api.getProductImageUpload).toHaveBeenCalledWith('p1', 'image/png')
  expect(uploadToSignedUrl).toHaveBeenCalledWith('product-images', 'products/p1/abc.png', 't', file)
  expect(api.registerProductImage).toHaveBeenCalledWith('p1', {
    storage_path: 'products/p1/abc.png',
    alt_text: null,
    sort_order: 0,
  })
  expect(await screen.findByAltText('Sunflower')).toBeInTheDocument()
})

it('refuses wrong picture types, and explains a missing storage key', async () => {
  api.getAdminProduct.mockResolvedValue(product())
  renderForm('/admin/products/p1')
  const input = await screen.findByLabelText(/Add a picture/)
  await userEvent.upload(input, new File(['x'], 'a.pdf', { type: 'application/pdf' }), {
    applyAccept: false,
  })
  expect(await screen.findByRole('alert')).toHaveTextContent('JPG, PNG or WebP')
  expect(api.getProductImageUpload).not.toHaveBeenCalled()
  api.getProductImageUpload.mockRejectedValue(new ApiError(503, 'x'))
  await userEvent.upload(input, new File(['x'], 'a.png', { type: 'image/png' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('storage key missing')
})

it('edits picture descriptions and removes pictures after confirmation', async () => {
  const withImage = product({
    images: [{ image_id: 'i1', url: 'https://img/1.jpg', alt_text: 'old', sort_order: 0 }],
  })
  api.getAdminProduct.mockResolvedValueOnce(withImage).mockResolvedValue(product())
  api.updateProductImage.mockResolvedValue({})
  api.deleteProductImage.mockResolvedValue(undefined)
  renderForm('/admin/products/p1')
  const alt = await screen.findByDisplayValue('old')
  await userEvent.clear(alt)
  await userEvent.type(alt, 'A sunflower')
  await userEvent.tab()
  expect(api.updateProductImage).toHaveBeenCalledWith('p1', 'i1', { alt_text: 'A sunflower' })
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
  await userEvent.click(screen.getByRole('button', { name: 'Yes, remove' }))
  expect(api.deleteProductImage).toHaveBeenCalledWith('p1', 'i1')
  expect(await screen.findByText('No pictures yet.')).toBeInTheDocument()
})

it('shows an error state when the product cannot be loaded', async () => {
  api.getAdminProduct.mockRejectedValue(new Error('x'))
  renderForm('/admin/products/p1')
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
})
