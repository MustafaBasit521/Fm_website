import { render, screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { fakeSession, makeAuth } from '../test/auth'
import { ProtectedRoute } from './ProtectedRoute'

vi.mock('../lib/supabase', () => ({ supabase: {} }))

const routes = (
  <Routes>
    <Route path="/login" element={<p>login page</p>} />
    <Route element={<ProtectedRoute />}>
      <Route path="/account" element={<p>secret</p>} />
    </Route>
  </Routes>
)

it('redirects signed-out users to /login', () => {
  const { wrap } = makeAuth()
  render(wrap(routes, '/account'))
  expect(screen.getByText('login page')).toBeInTheDocument()
  expect(screen.queryByText('secret')).not.toBeInTheDocument()
})

it('shows the page to signed-in users', () => {
  const { wrap } = makeAuth({ session: fakeSession })
  render(wrap(routes, '/account'))
  expect(screen.getByText('secret')).toBeInTheDocument()
})

it('waits while the session is loading instead of redirecting', () => {
  const { wrap } = makeAuth({ loading: true })
  render(wrap(routes, '/account'))
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  expect(screen.queryByText('login page')).not.toBeInTheDocument()
})
