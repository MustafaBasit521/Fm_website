import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError, type CustomOrder, type Page } from '../lib/api'
import CustomOrdersPage from './CustomOrdersPage'

const api = { getCustomOrders: vi.fn(), cancelCustomOrder: vi.fn() }
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getCustomOrders: (...a: unknown[]) => api.getCustomOrders(...a),
  cancelCustomOrder: (...a: unknown[]) => api.cancelCustomOrder(...a),
}))

const co = (over: Partial<CustomOrder> = {}): CustomOrder => ({
  custom_order_id: 'c1',
  name: 'Sara',
  whatsapp_number: '0300',
  description: 'A jersey with a name',
  budget_paisa: 250000,
  required_date: '2026-12-01',
  status: 'NEW',
  has_reference_image: true,
  created_at: '2026-03-05T10:00:00Z',
  updated_at: '2026-03-05T10:00:00Z',
  ...over,
})
const page = (items: CustomOrder[]): Page<CustomOrder> => ({
  items,
  total: items.length,
  page: 1,
  page_size: 10,
})
const renderPage = () =>
  render(
    <MemoryRouter>
      <CustomOrdersPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
})

it('lists requests in plain words with budget and picture info', async () => {
  api.getCustomOrders.mockResolvedValue(
    page([
      co(),
      co({
        custom_order_id: 'c2',
        status: 'IN_PROGRESS',
        budget_paisa: null,
        has_reference_image: false,
      }),
    ]),
  )
  renderPage()
  expect(await screen.findByText('Received')).toBeInTheDocument()
  expect(screen.getByText('Being made')).toBeInTheDocument()
  expect(screen.getByText(/Budget Rs 2,500/)).toBeInTheDocument()
  expect(screen.getByText(/No picture/)).toBeInTheDocument()
  // only requests that are still open for withdrawal offer cancel
  expect(screen.getAllByRole('button', { name: 'Cancel request' })).toHaveLength(1)
})

it('cancels after a confirmation', async () => {
  api.getCustomOrders.mockResolvedValue(page([co()]))
  api.cancelCustomOrder.mockResolvedValue(co({ status: 'CANCELLED' }))
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel request' }))
  expect(api.cancelCustomOrder).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel this request' }))
  expect(api.cancelCustomOrder).toHaveBeenCalledWith('c1')
  expect(await screen.findByText('Cancelled')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeInTheDocument()
})

it('shows what to do when cancelling is refused, plus empty and error states', async () => {
  api.getCustomOrders.mockResolvedValue(page([co()]))
  api.cancelCustomOrder.mockRejectedValue(new ApiError(409, 'x'))
  const first = renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel request' }))
  await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel this request' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('contact the shop')
  first.unmount()
  api.getCustomOrders.mockResolvedValue(page([]))
  const second = renderPage()
  expect(await screen.findByText(/not sent any custom order requests/)).toBeInTheDocument()
  second.unmount()
  api.getCustomOrders.mockRejectedValue(new Error('x'))
  renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your custom orders')
})
