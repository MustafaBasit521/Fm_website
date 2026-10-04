import { render, screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api'
import { fakeSession, makeAuth } from '../test/auth'
import { AdminRoute } from './AdminRoute'

const getAdminMe = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/adminApi', () => ({ getAdminMe: (...a: unknown[]) => getAdminMe(...a) }))

const renderAt = (auth = {}) =>
  render(
    makeAuth(auth).wrap(
      <Routes>
        <Route path="/login" element={<p>login page</p>} />
        <Route element={<AdminRoute />}>
          <Route path="/admin" element={<p>admin area</p>} />
        </Route>
      </Routes>,
      '/admin',
    ),
  )

beforeEach(() => {
  getAdminMe.mockReset()
})

it('sends signed-out visitors to the login page without calling the API', () => {
  renderAt()
  expect(screen.getByText('login page')).toBeInTheDocument()
  expect(getAdminMe).not.toHaveBeenCalled()
})

it('shows the admin area only when the server confirms the admin role', async () => {
  getAdminMe.mockResolvedValue({ id: 'u1', role: 'admin' })
  renderAt({ session: fakeSession })
  expect(await screen.findByText('admin area')).toBeInTheDocument()
})

it('tells a non-admin they have no access (and does not render the area)', async () => {
  getAdminMe.mockRejectedValue(new ApiError(403, 'x'))
  renderAt({ session: fakeSession })
  expect(await screen.findByText('No access')).toBeInTheDocument()
  expect(screen.queryByText('admin area')).not.toBeInTheDocument()
})

it('also refuses access if the check fails for any other reason', async () => {
  getAdminMe.mockRejectedValue(new Error('network'))
  renderAt({ session: fakeSession })
  expect(await screen.findByText('No access')).toBeInTheDocument()
})

it('waits while the session is loading', () => {
  renderAt({ loading: true })
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
})
