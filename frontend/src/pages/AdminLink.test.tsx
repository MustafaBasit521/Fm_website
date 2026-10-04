import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { fakeSession, makeAuth } from '../test/auth'
import { AdminLink } from './AdminLink'

const getAdminMe = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/adminApi', () => ({ getAdminMe: (...a: unknown[]) => getAdminMe(...a) }))

beforeEach(() => {
  getAdminMe.mockReset()
})

it('shows nothing when signed out and makes no API call', () => {
  render(makeAuth().wrap(<AdminLink />))
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  expect(getAdminMe).not.toHaveBeenCalled()
})

it('shows the link only when the server says the user is the admin', async () => {
  getAdminMe.mockResolvedValue({ id: 'u1', role: 'admin' })
  render(makeAuth({ session: fakeSession }).wrap(<AdminLink />))
  expect(await screen.findByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin')
})

it('shows nothing for a customer', async () => {
  getAdminMe.mockRejectedValue(new Error('403'))
  render(makeAuth({ session: fakeSession }).wrap(<AdminLink />))
  await vi.waitFor(() => expect(getAdminMe).toHaveBeenCalled())
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
})
