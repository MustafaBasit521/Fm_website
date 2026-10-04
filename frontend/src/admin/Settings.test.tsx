import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api'
import SettingsAdminPage from './SettingsAdminPage'

const api = { getAdminSettings: vi.fn(), updateAdminSettings: vi.fn() }
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/adminApi', () => ({
  getAdminSettings: (...a: unknown[]) => api.getAdminSettings(...a),
  updateAdminSettings: (...a: unknown[]) => api.updateAdminSettings(...a),
}))

const settings = (over = {}) => ({
  business_name: 'Bundle of Loops',
  email: 'shop@example.com',
  phone: null,
  whatsapp: '0300 1234567',
  address: null,
  delivery_information: 'Delivered in 3 days',
  delivery_fee_paisa: 20000,
  social_links: { instagram: 'https://instagram.com/bol' },
  updated_at: '2026-03-05T10:00:00Z',
  ...over,
})

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
})

it('shows the current settings, with the fee in rupees', async () => {
  api.getAdminSettings.mockResolvedValue(settings())
  render(<SettingsAdminPage />)
  expect(await screen.findByDisplayValue('Bundle of Loops')).toBeInTheDocument()
  expect(screen.getByLabelText('Delivery fee (Rs)')).toHaveValue('200')
  expect(screen.getByLabelText('Instagram link')).toHaveValue('https://instagram.com/bol')
  // only the fields business-rules §33 lists: no holiday mode or payment toggles
  expect(screen.queryByText(/holiday/i)).not.toBeInTheDocument()
})

it('saves changes, converting the fee to paisa and dropping empty links', async () => {
  api.getAdminSettings.mockResolvedValue(settings())
  api.updateAdminSettings.mockResolvedValue(
    settings({ delivery_fee_paisa: 25050, updated_at: 'later' }),
  )
  render(<SettingsAdminPage />)
  const fee = await screen.findByLabelText('Delivery fee (Rs)')
  await userEvent.clear(fee)
  await userEvent.type(fee, '250.50')
  await userEvent.clear(screen.getByLabelText('Instagram link'))
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  const sent = api.updateAdminSettings.mock.calls[0][0]
  expect(sent.delivery_fee_paisa).toBe(25050)
  expect(sent.social_links).toEqual({})
  expect(sent.business_name).toBe('Bundle of Loops')
  expect(sent.phone).toBeNull()
  expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
})

it('rejects a bad fee locally and explains server validation errors', async () => {
  api.getAdminSettings.mockResolvedValue(settings())
  api.updateAdminSettings.mockRejectedValue(new ApiError(422, 'x'))
  render(<SettingsAdminPage />)
  const fee = await screen.findByLabelText('Delivery fee (Rs)')
  await userEvent.clear(fee)
  await userEvent.type(fee, 'free')
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('like 200 or 200.50')
  expect(api.updateAdminSettings).not.toHaveBeenCalled()
  await userEvent.clear(fee)
  await userEvent.type(fee, '200')
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('https://')
})

it('shows a load error', async () => {
  api.getAdminSettings.mockRejectedValue(new Error('x'))
  render(<SettingsAdminPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
})
