import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { fakeSession, makeAuth } from '../test/auth'
import AdminLoginPage from './AdminLoginPage'

vi.mock('../lib/supabase', () => ({ supabase: {} }))

const renderLogin = (auth = {}) => {
  const { ctx, wrap } = makeAuth(auth)
  render(
    wrap(
      <Routes>
        <Route path="/login" element={<AdminLoginPage />} />
        <Route path="/" element={<p>dashboard</p>} />
      </Routes>,
      '/login',
    ),
  )
  return ctx
}

it('signs in with email and password and offers no sign-up', async () => {
  const ctx = renderLogin()
  await userEvent.type(screen.getByLabelText('Email'), 'admin@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'secret-password')
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
  expect(ctx.signIn).toHaveBeenCalledWith('admin@example.com', 'secret-password')
  expect(screen.queryByText(/create/i)).not.toBeInTheDocument()
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
})

it('shows the same generic message for every failure', async () => {
  const ctx = renderLogin({ signIn: vi.fn().mockRejectedValue(new Error('Invalid login')) })
  await userEvent.type(screen.getByLabelText('Email'), 'nobody@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'x')
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.')
  expect(ctx).toBeDefined()
})

it('moves on once there is a session', () => {
  renderLogin({ session: fakeSession })
  expect(screen.getByText('dashboard')).toBeInTheDocument()
})

it('shows the shop logo above the title', () => {
  renderLogin()
  const logo = screen.getByRole('img', { name: 'Bundle of Loops logo' })
  expect(logo).toHaveAttribute('src', '/logo.png')
  expect(screen.getByRole('heading', { name: 'Shop admin' })).toBeInTheDocument()
})
