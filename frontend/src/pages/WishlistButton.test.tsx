import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api'
import { fakeSession, makeAuth } from '../test/auth'
import { WishlistButton } from './WishlistButton'

const api = { getWishlistIds: vi.fn(), addToWishlist: vi.fn(), removeFromWishlist: vi.fn() }
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getWishlistIds: (...a: unknown[]) => api.getWishlistIds(...a),
  addToWishlist: (...a: unknown[]) => api.addToWishlist(...a),
  removeFromWishlist: (...a: unknown[]) => api.removeFromWishlist(...a),
}))

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
  api.getWishlistIds.mockResolvedValue([])
})

it('asks signed-out visitors to log in and makes no API calls', () => {
  const { wrap } = makeAuth()
  render(wrap(<WishlistButton productId="p1" />))
  expect(screen.getByRole('link', { name: /Log in to save/ })).toHaveAttribute('href', '/login')
  expect(api.getWishlistIds).not.toHaveBeenCalled()
})

it('adds and removes for signed-in customers', async () => {
  api.addToWishlist.mockResolvedValue({})
  api.removeFromWishlist.mockResolvedValue(undefined)
  const { wrap } = makeAuth({ session: fakeSession })
  render(wrap(<WishlistButton productId="p1" />))
  const button = await screen.findByRole('button', { name: /Add to wishlist/ })
  await vi.waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
  expect(api.addToWishlist).toHaveBeenCalledWith('p1')
  expect(await screen.findByRole('button', { name: /Saved to wishlist/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await userEvent.click(screen.getByRole('button', { name: /Saved to wishlist/ }))
  expect(api.removeFromWishlist).toHaveBeenCalledWith('p1')
  expect(await screen.findByRole('button', { name: /Add to wishlist/ })).toBeInTheDocument()
})

it('starts as saved when the product is already on the wishlist', async () => {
  api.getWishlistIds.mockResolvedValue(['p1'])
  const { wrap } = makeAuth({ session: fakeSession })
  render(wrap(<WishlistButton productId="p1" />))
  expect(await screen.findByRole('button', { name: /Saved to wishlist/ })).toBeInTheDocument()
})

it('treats 409 (already saved elsewhere) as success', async () => {
  api.addToWishlist.mockRejectedValue(new ApiError(409, 'dup'))
  const { wrap } = makeAuth({ session: fakeSession })
  render(wrap(<WishlistButton productId="p1" />))
  const button = await screen.findByRole('button', { name: /Add to wishlist/ })
  await vi.waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
  expect(await screen.findByRole('button', { name: /Saved to wishlist/ })).toBeInTheDocument()
})

it('shows an error when the update fails', async () => {
  api.addToWishlist.mockRejectedValue(new ApiError(500, 'x'))
  const { wrap } = makeAuth({ session: fakeSession })
  render(wrap(<WishlistButton productId="p1" />))
  const button = await screen.findByRole('button', { name: /Add to wishlist/ })
  await vi.waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not update your wishlist')
})
