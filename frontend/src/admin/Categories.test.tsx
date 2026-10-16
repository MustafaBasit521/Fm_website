import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api'
import CategoriesAdminPage from './CategoriesAdminPage'

const api = {
  getAdminCategories: vi.fn(),
  getAdminProducts: vi.fn(),
  createCategory: vi.fn(),
  renameCategory: vi.fn(),
  deleteCategory: vi.fn(),
}
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/adminApi', () => ({
  getAdminCategories: (...a: unknown[]) => api.getAdminCategories(...a),
  getAdminProducts: (...a: unknown[]) => api.getAdminProducts(...a),
  createCategory: (...a: unknown[]) => api.createCategory(...a),
  renameCategory: (...a: unknown[]) => api.renameCategory(...a),
  deleteCategory: (...a: unknown[]) => api.deleteCategory(...a),
}))

const cats = [
  { category_id: 'c1', name: 'Flowers', product_count: 2 },
  { category_id: 'c2', name: 'Keys', product_count: 0 },
]

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
  api.getAdminCategories.mockResolvedValue(cats)
})

it('lists categories with product counts and blocks deleting used ones', async () => {
  render(<CategoriesAdminPage />)
  expect(await screen.findByText('2 products')).toBeInTheDocument()
  expect(screen.getByText('0 products')).toBeInTheDocument()
  const deletes = screen.getAllByRole('button', { name: 'Delete' })
  expect(deletes[0]).toBeDisabled() // Flowers still has products
  expect(deletes[1]).toBeEnabled()
})

it('adds, renames and deletes (after confirmation)', async () => {
  api.createCategory.mockResolvedValue({})
  api.renameCategory.mockResolvedValue({})
  api.deleteCategory.mockResolvedValue(undefined)
  render(<CategoriesAdminPage />)
  await userEvent.type(await screen.findByLabelText('New category'), 'Bags')
  await userEvent.click(screen.getByRole('button', { name: 'Add' }))
  expect(api.createCategory).toHaveBeenCalledWith('Bags')

  await userEvent.click(screen.getAllByRole('button', { name: 'Rename' })[1])
  const input = screen.getByLabelText('New name for Keys')
  await userEvent.clear(input)
  await userEvent.type(input, 'Key chains{Enter}')
  expect(api.renameCategory).toHaveBeenCalledWith('c2', 'Key chains')

  await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1])
  expect(api.deleteCategory).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
  expect(api.deleteCategory).toHaveBeenCalledWith('c2')
})

it('explains duplicate names and refused deletions', async () => {
  api.createCategory.mockRejectedValue(new ApiError(409, 'x'))
  render(<CategoriesAdminPage />)
  await userEvent.type(await screen.findByLabelText('New category'), 'Flowers')
  await userEvent.click(screen.getByRole('button', { name: 'Add' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('already used')
})

it('needs a name and shows load errors', async () => {
  const a = render(<CategoriesAdminPage />)
  await userEvent.click(await screen.findByRole('button', { name: 'Add' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('enter a name')
  expect(api.createCategory).not.toHaveBeenCalled()
  a.unmount()
  api.getAdminCategories.mockRejectedValue(new Error('x'))
  render(<CategoriesAdminPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
})

const product = (n: number, over = {}) => ({
  product_id: `p${n}`,
  name: `Piece ${n}`,
  price_paisa: 150000,
  category: { category_id: 'c1', name: 'Flowers' },
  availability_type: 'READY_TO_SHIP',
  stock_quantity: 4,
  is_visible: true,
  image: { url: `https://img/${n}.jpg`, alt_text: null },
  ...over,
})

it('opens a category to show its products with pictures, and closes it again', async () => {
  api.getAdminProducts.mockResolvedValue({
    items: [product(1), product(2, { image: null, is_visible: false })],
    total: 2,
    page: 1,
    page_size: 20,
  })
  render(
    <MemoryRouter>
      <CategoriesAdminPage />
    </MemoryRouter>,
  )
  const toggle = await screen.findByRole('button', { name: /Flowers/ })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(api.getAdminProducts).not.toHaveBeenCalled() // nothing is loaded until it is opened
  await userEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(api.getAdminProducts.mock.calls[0][0]).toMatchObject({ category_id: 'c1' })
  const link = await screen.findByRole('link', { name: /Piece 1/ })
  expect(link).toHaveAttribute('href', '/products/p1')
  expect(link.querySelector('img')).toHaveAttribute('src', 'https://img/1.jpg')
  expect(screen.getByRole('link', { name: /Piece 2.*hidden/ })).toBeInTheDocument()
  await userEvent.click(toggle)
  expect(screen.queryByRole('link', { name: /Piece 1/ })).not.toBeInTheDocument()
})

it('says so for an empty category without asking the server, and links to the rest of a long one', async () => {
  api.getAdminCategories.mockResolvedValue([
    { category_id: 'c1', name: 'Flowers', product_count: 25 },
    { category_id: 'c2', name: 'Keys', product_count: 0 },
  ])
  api.getAdminProducts.mockResolvedValue({
    items: [product(1)],
    total: 25,
    page: 1,
    page_size: 20,
  })
  render(
    <MemoryRouter>
      <CategoriesAdminPage />
    </MemoryRouter>,
  )
  await userEvent.click(await screen.findByRole('button', { name: /Keys/ }))
  expect(screen.getByText('No products in this category yet.')).toBeInTheDocument()
  expect(api.getAdminProducts).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: /Flowers/ }))
  expect(await screen.findByRole('link', { name: 'See all 25 products' })).toHaveAttribute(
    'href',
    '/products?category=c1',
  )
})
