import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api'
import { fakeSession, makeAuth } from '../test/auth'
import AccountPage from './AccountPage'

const getMe = vi.fn()
const updateMe = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getMe: (...a: unknown[]) => getMe(...a),
  updateMe: (...a: unknown[]) => updateMe(...a),
}))

const customer = {
  customer_id: 'u1',
  name: 'Ayesha',
  email: 'a@example.com',
  phone: null,
  subscribed_to_updates: true,
  created_at: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  getMe.mockReset().mockResolvedValue(customer)
  updateMe.mockReset()
})

it('shows the profile and saves edits through the API', async () => {
  updateMe.mockResolvedValue({ ...customer, name: 'Ayesha K', phone: '03001234567' })
  const { wrap } = makeAuth({ session: fakeSession })
  render(wrap(<AccountPage />, '/account'))

  expect(await screen.findByText('a@example.com')).toBeInTheDocument()
  const name = screen.getByLabelText('Name')
  await userEvent.clear(name)
  await userEvent.type(name, 'Ayesha K')
  await userEvent.type(screen.getByLabelText('Phone'), '03001234567')
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

  expect(updateMe).toHaveBeenCalledWith({
    name: 'Ayesha K',
    phone: '03001234567',
    subscribed_to_updates: true,
  })
  expect(await screen.findByText('Saved.')).toBeInTheDocument()
})

it('shows a validation message on 422', async () => {
  updateMe.mockRejectedValue(new ApiError(422, 'bad'))
  const { wrap } = makeAuth({ session: fakeSession })
  render(wrap(<AccountPage />, '/account'))
  await screen.findByText('a@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('check your name and phone')
})

it('shows an error state when the profile cannot be loaded', async () => {
  getMe.mockRejectedValue(new ApiError(500, 'x'))
  const { wrap } = makeAuth({ session: fakeSession })
  render(wrap(<AccountPage />, '/account'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
})
