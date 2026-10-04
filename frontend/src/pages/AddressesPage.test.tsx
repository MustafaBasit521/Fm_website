import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Address } from '../lib/api'
import AddressesPage from './AddressesPage'

const api = {
  getAddresses: vi.fn(),
  createAddress: vi.fn(),
  updateAddress: vi.fn(),
  deleteAddress: vi.fn(),
}
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getAddresses: (...a: unknown[]) => api.getAddresses(...a),
  createAddress: (...a: unknown[]) => api.createAddress(...a),
  updateAddress: (...a: unknown[]) => api.updateAddress(...a),
  deleteAddress: (...a: unknown[]) => api.deleteAddress(...a),
}))

const home: Address = {
  address_id: 'a1',
  label: 'Home',
  house_no: '12-B',
  street_number: null,
  city: 'Lahore',
  province: null,
  postal_code: '54000',
  country: 'Pakistan',
  created_at: '2026-01-01T00:00:00Z',
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <AddressesPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
  api.getAddresses.mockResolvedValue([home])
})

it('lists saved addresses', async () => {
  renderPage()
  expect(await screen.findByText('Home')).toBeInTheDocument()
  expect(screen.getByText('12-B, Lahore, 54000, Pakistan')).toBeInTheDocument()
})

it('shows an empty state', async () => {
  api.getAddresses.mockResolvedValue([])
  renderPage()
  expect(await screen.findByText('You have no saved addresses yet.')).toBeInTheDocument()
})

it('adds an address, sending blank optional fields as null', async () => {
  api.createAddress.mockResolvedValue({ ...home, address_id: 'a2', label: 'Office', house_no: '7' })
  renderPage()
  await screen.findByText('Home')
  await userEvent.click(screen.getByRole('button', { name: 'Add address' }))
  const form = screen.getByRole('form', { name: 'New address' })
  await userEvent.type(within(form).getByLabelText('Label (e.g. Home)'), 'Office')
  await userEvent.type(within(form).getByLabelText('House number'), '7')
  await userEvent.type(within(form).getByLabelText('Postal code'), '54000')
  await userEvent.click(within(form).getByRole('button', { name: 'Save address' }))

  expect(api.createAddress).toHaveBeenCalledWith({
    label: 'Office',
    house_no: '7',
    street_number: null,
    city: 'Lahore',
    province: null,
    postal_code: '54000',
    country: 'Pakistan',
  })
  expect(await screen.findByText('Office')).toBeInTheDocument()
  expect(screen.queryByRole('form')).not.toBeInTheDocument()
})

it('edits an address', async () => {
  api.updateAddress.mockResolvedValue({ ...home, street_number: 'St 4' })
  renderPage()
  await screen.findByText('Home')
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
  await userEvent.type(screen.getByLabelText('Street number'), 'St 4')
  await userEvent.click(screen.getByRole('button', { name: 'Save address' }))
  expect(api.updateAddress).toHaveBeenCalledWith(
    'a1',
    expect.objectContaining({ street_number: 'St 4' }),
  )
  expect(await screen.findByText('12-B, St 4, Lahore, 54000, Pakistan')).toBeInTheDocument()
})

it('requires a second click to delete', async () => {
  api.deleteAddress.mockResolvedValue(undefined)
  renderPage()
  await screen.findByText('Home')
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
  expect(api.deleteAddress).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
  expect(api.deleteAddress).toHaveBeenCalledWith('a1')
  expect(await screen.findByText('You have no saved addresses yet.')).toBeInTheDocument()
})

it('shows an error when saving fails', async () => {
  api.createAddress.mockRejectedValue(new Error('boom'))
  renderPage()
  await screen.findByText('Home')
  await userEvent.click(screen.getByRole('button', { name: 'Add address' }))
  await userEvent.type(screen.getByLabelText('House number'), '1')
  await userEvent.type(screen.getByLabelText('Postal code'), '1')
  await userEvent.click(screen.getByRole('button', { name: 'Save address' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the address')
})

it('shows an error state when loading fails', async () => {
  api.getAddresses.mockRejectedValue(new Error('x'))
  renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your addresses')
})
