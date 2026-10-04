import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AppNotification, Page } from '../lib/api'
import { fakeSession, makeAuth } from '../test/auth'
import NotificationsPage from './NotificationsPage'
import { NotificationsLink } from './NotificationsLink'

const api = {
  getNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  getUnreadCount: vi.fn(),
}
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getNotifications: (...a: unknown[]) => api.getNotifications(...a),
  markNotificationRead: (...a: unknown[]) => api.markNotificationRead(...a),
  markAllNotificationsRead: (...a: unknown[]) => api.markAllNotificationsRead(...a),
  getUnreadCount: (...a: unknown[]) => api.getUnreadCount(...a),
}))

const note = (n: number, over: Partial<AppNotification> = {}): AppNotification => ({
  notification_id: `n${n}`,
  type: 'ORDER_PLACED',
  title: `Title ${n}`,
  message: `Message ${n}`,
  status: 'UNREAD',
  created_at: '2026-03-05T10:00:00Z',
  ...over,
})
const page = (items: AppNotification[]): Page<AppNotification> => ({
  items,
  total: items.length,
  page: 1,
  page_size: 20,
})
const renderPage = () =>
  render(
    <MemoryRouter>
      <NotificationsPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
})

it('shows unread notifications as "New" (in words) and marks one as read', async () => {
  api.getNotifications.mockResolvedValue(page([note(1), note(2, { status: 'READ' })]))
  api.markNotificationRead.mockResolvedValue(note(1, { status: 'READ' }))
  renderPage()
  expect(await screen.findByText('Message 1')).toBeInTheDocument()
  expect(screen.getAllByText('New')).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Mark "Title 1" as read' }))
  expect(api.markNotificationRead).toHaveBeenCalledWith('n1')
  expect(screen.queryByText('New')).not.toBeInTheDocument()
})

it('marks everything as read', async () => {
  api.getNotifications.mockResolvedValue(page([note(1), note(2)]))
  api.markAllNotificationsRead.mockResolvedValue({ updated: 2 })
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }))
  expect(api.markAllNotificationsRead).toHaveBeenCalled()
  expect(screen.queryByText('New')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Mark all as read' })).not.toBeInTheDocument()
})

it('shows empty, error and update-failure states', async () => {
  api.getNotifications.mockResolvedValue(page([]))
  const a = renderPage()
  expect(await screen.findByText('You have no notifications.')).toBeInTheDocument()
  a.unmount()
  api.getNotifications.mockRejectedValue(new Error('x'))
  const b = renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your notifications')
  b.unmount()
  api.getNotifications.mockResolvedValue(page([note(1)]))
  api.markNotificationRead.mockRejectedValue(new Error('x'))
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Mark "Title 1" as read' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not update')
})

it('the link shows the unread count, and nothing when signed out', async () => {
  api.getUnreadCount.mockResolvedValue({ unread: 3 })
  const signedOut = render(makeAuth().wrap(<NotificationsLink />))
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  expect(api.getUnreadCount).not.toHaveBeenCalled()
  signedOut.unmount()
  render(makeAuth({ session: fakeSession }).wrap(<NotificationsLink />))
  expect(await screen.findByRole('link', { name: 'Notifications (3)' })).toHaveAttribute(
    'href',
    '/notifications',
  )
})
