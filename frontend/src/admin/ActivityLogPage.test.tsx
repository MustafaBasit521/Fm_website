import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import ActivityLogPage from './ActivityLogPage'

const getAuditLog = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/adminApi', () => ({ getAuditLog: (...a: unknown[]) => getAuditLog(...a) }))

const entry = (n: number, status: number) => ({
  audit_id: `a${n}`,
  user_id: '12345678-aaaa-bbbb-cccc-1234567890ab',
  action: `POST /api/admin/orders/{id}/cancel`,
  path: '/api/admin/orders/x/cancel',
  status_code: status,
  ip: n === 1 ? '203.0.113.7' : null,
  created_at: '2026-03-05T10:00:00Z',
})

it('shows what happened, who did it, and whether it was refused', async () => {
  getAuditLog.mockResolvedValue({
    items: [entry(1, 200), entry(2, 403)],
    total: 2,
    page: 1,
    page_size: 50,
  })
  render(<ActivityLogPage />)
  expect(await screen.findAllByText('POST /api/admin/orders/{id}/cancel')).toHaveLength(2)
  expect(screen.getByText('OK (200)')).toBeInTheDocument()
  expect(screen.getByText('Refused or failed (403)')).toBeInTheDocument()
  expect(screen.getByText(/203\.0\.113\.7/)).toBeInTheDocument()
  expect(screen.getByText(/unknown address/)).toBeInTheDocument()
  expect(screen.getAllByText(/user 12345678/).length).toBe(2)
})

it('shows empty and error states', async () => {
  getAuditLog.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 50 })
  const a = render(<ActivityLogPage />)
  expect(await screen.findByText('No activity recorded yet.')).toBeInTheDocument()
  a.unmount()
  getAuditLog.mockRejectedValue(new Error('x'))
  render(<ActivityLogPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
})
