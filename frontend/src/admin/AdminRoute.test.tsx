import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { ApiError } from '../lib/api'
import { fakeSession, makeAuth } from '../test/auth'
import { AdminRoute } from './AdminRoute'

const getAdminMe = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/adminApi', () => ({ getAdminMe: (...a: unknown[]) => getAdminMe(...a) }))
vi.mock('./MfaStep', () => ({
  MfaStep: ({ onDone }: { onDone: () => void }) => (
    <button type="button" onClick={onDone}>
      mfa step
    </button>
  ),
}))

const renderAt = (auth = {}) => {
  const { ctx, wrap } = makeAuth(auth)
  const view = render(
    wrap(
      <Routes>
        <Route path="/login" element={<p>login page</p>} />
        <Route element={<AdminRoute />}>
          <Route path="/" element={<p>admin area</p>} />
        </Route>
      </Routes>,
      '/',
    ),
  )
  return { ctx, view }
}

beforeEach(() => {
  getAdminMe.mockReset()
})

it('sends signed-out visitors to the admin login without calling the API', () => {
  renderAt()
  expect(screen.getByText('login page')).toBeInTheDocument()
  expect(getAdminMe).not.toHaveBeenCalled()
})

it('shows the admin area only when the role AND the second factor are confirmed', async () => {
  getAdminMe.mockResolvedValue({ id: 'u1', role: 'admin', mfa_required: true, mfa_verified: true })
  renderAt({ session: fakeSession })
  expect(await screen.findByText('admin area')).toBeInTheDocument()
})

it('asks for the second factor before showing anything when it is not done yet', async () => {
  getAdminMe.mockResolvedValue({ id: 'u1', role: 'admin', mfa_required: true, mfa_verified: false })
  renderAt({ session: fakeSession })
  expect(await screen.findByRole('button', { name: 'mfa step' })).toBeInTheDocument()
  expect(screen.queryByText('admin area')).not.toBeInTheDocument()
})

it('lets the admin in when the server does not require a second factor (local development)', async () => {
  getAdminMe.mockResolvedValue({
    id: 'u1',
    role: 'admin',
    mfa_required: false,
    mfa_verified: false,
  })
  renderAt({ session: fakeSession })
  expect(await screen.findByText('admin area')).toBeInTheDocument()
})

it('re-checks after the second factor step finishes', async () => {
  getAdminMe
    .mockResolvedValueOnce({ id: 'u1', role: 'admin', mfa_required: true, mfa_verified: false })
    .mockResolvedValue({ id: 'u1', role: 'admin', mfa_required: true, mfa_verified: true })
  renderAt({ session: fakeSession })
  await userEvent.click(await screen.findByRole('button', { name: 'mfa step' }))
  expect(await screen.findByText('admin area')).toBeInTheDocument()
  expect(getAdminMe).toHaveBeenCalledTimes(2)
})

it('re-checks when the session token changes (e.g. after MFA upgrades it)', async () => {
  getAdminMe
    .mockResolvedValueOnce({ id: 'u1', role: 'admin', mfa_required: true, mfa_verified: false })
    .mockResolvedValue({ id: 'u1', role: 'admin', mfa_required: true, mfa_verified: true })
  const first = renderAt({ session: fakeSession })
  await screen.findByRole('button', { name: 'mfa step' })
  first.view.unmount()
  const upgraded = { ...fakeSession, access_token: 'aal2-token' } as unknown as Session
  renderAt({ session: upgraded })
  expect(await screen.findByText('admin area')).toBeInTheDocument()
})

it('tells a non-admin they have no access, and lets them log out', async () => {
  getAdminMe.mockRejectedValue(new ApiError(403, 'x'))
  const { ctx } = renderAt({ session: fakeSession })
  expect(await screen.findByText('No access')).toBeInTheDocument()
  expect(screen.queryByText('admin area')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
  expect(ctx.signOut).toHaveBeenCalled()
})

it('does not confuse a server problem with "not admin", and can retry', async () => {
  getAdminMe
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValue({ id: 'u1', role: 'admin', mfa_required: true, mfa_verified: true })
  renderAt({ session: fakeSession })
  expect(await screen.findByRole('alert')).toHaveTextContent('did not answer')
  expect(screen.queryByText('No access')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('admin area')).toBeInTheDocument()
})

it('waits while the session is loading', () => {
  renderAt({ loading: true })
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
})
