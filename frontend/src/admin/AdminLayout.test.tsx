import { render, screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { makeAuth } from '../test/auth'
import AdminLayout from './AdminLayout'

const getDashboard = vi.fn()
const getPublicSettings = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/adminApi', () => ({ getDashboard: (...a: unknown[]) => getDashboard(...a) }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getPublicSettings: (...a: unknown[]) => getPublicSettings(...a),
}))

const renderLayout = () => {
  const { wrap } = makeAuth()
  return render(
    wrap(
      <Routes>
        <Route element={<AdminLayout />}>
          <Route path="*" element={<p>page body</p>} />
        </Route>
      </Routes>,
      '/orders',
    ),
  )
}

beforeEach(() => {
  getDashboard
    .mockReset()
    .mockResolvedValue({ orders_needing_action: 4, new_messages: 3, new_custom_orders: 0 })
  getPublicSettings.mockReset().mockResolvedValue({ business_name: 'Bundle of Loops' })
})

it('has the grouped sidebar with the shop name and the current page marked', async () => {
  renderLayout()
  const nav = screen.getByRole('navigation', { name: 'Admin' })
  for (const name of ['Overview', 'Orders', 'Products', 'Gallery', 'Messages', 'Settings'])
    expect(within(nav).getByRole('link', { name: new RegExp(name) })).toBeInTheDocument()
  expect(within(nav).getByRole('link', { name: /Orders/ })).toHaveAttribute('aria-current', 'page')
  expect(await within(nav).findByText('Loops', { exact: false })).toBeInTheDocument()
  expect(screen.getByText('page body')).toBeInTheDocument()
})

it('shows how many orders and messages need attention, and nothing for zero', async () => {
  renderLayout()
  const nav = screen.getByRole('navigation', { name: 'Admin' })
  expect(await within(nav).findByLabelText('4 new')).toBeInTheDocument()
  expect(within(nav).getByLabelText('3 new')).toBeInTheDocument()
  expect(within(nav).getAllByLabelText(/new$/)).toHaveLength(2) // custom orders: 0, so no badge
})

it('still works when the numbers cannot be loaded', async () => {
  getDashboard.mockRejectedValue(new Error('x'))
  renderLayout()
  expect(await screen.findByRole('link', { name: /Orders/ })).toBeInTheDocument()
})
