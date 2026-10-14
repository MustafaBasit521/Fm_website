import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import AdminApp from './admin/App'
import { makeAuth } from './test/auth'
import ShopApp from './shop/App'

vi.mock('./lib/supabase', () => ({ supabase: {} }))
vi.mock('./lib/api', async (orig) => ({
  ...(await orig<typeof import('./lib/api')>()),
  getHealth: vi.fn().mockResolvedValue({ status: 'ok' }),
}))

it('the shop has no admin pages at all: /admin is just "not found"', () => {
  for (const path of ['/admin', '/admin/orders', '/admin/login']) {
    const { unmount } = render(makeAuth().wrap(<ShopApp />, path))
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    unmount()
  }
})

it('the admin site has no shop pages: /shop, /cart and /register are "not found"', () => {
  for (const path of ['/shop', '/cart', '/register', '/checkout']) {
    const { unmount } = render(makeAuth().wrap(<AdminApp />, path))
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    unmount()
  }
})

it('the admin site sends signed-out visitors to its own login page', () => {
  render(makeAuth().wrap(<AdminApp />, '/orders'))
  expect(screen.getByRole('heading', { name: 'Shop admin' })).toBeInTheDocument()
  expect(screen.getByLabelText('Password')).toBeInTheDocument()
})
