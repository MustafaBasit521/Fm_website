import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import type {
  AdminCustomOrder,
  AdminGalleryImage,
  AdminMessage,
  AdminReview,
} from '../lib/adminApi'
import { ApiError } from '../lib/api'
import CustomOrdersAdminPage from './CustomOrdersAdminPage'
import GalleryAdminPage from './GalleryAdminPage'
import MessagesAdminPage from './MessagesAdminPage'
import ReviewsAdminPage from './ReviewsAdminPage'

const api = {
  getAdminGallery: vi.fn(),
  getGalleryUpload: vi.fn(),
  createGalleryImage: vi.fn(),
  updateGalleryImage: vi.fn(),
  deleteGalleryImage: vi.fn(),
  getAdminCustomOrders: vi.fn(),
  setCustomOrderStatus: vi.fn(),
  getAdminMessages: vi.fn(),
  setMessageStatus: vi.fn(),
  getAdminReviews: vi.fn(),
  deleteAdminReview: vi.fn(),
}
const uploadToSignedUrl = vi.fn()
vi.mock('../lib/supabase', () => ({
  supabase: {
    storage: {
      from: (b: string) => ({ uploadToSignedUrl: (...a: unknown[]) => uploadToSignedUrl(b, ...a) }),
    },
  },
}))
vi.mock('../lib/adminApi', () => ({
  getAdminGallery: (...a: unknown[]) => api.getAdminGallery(...a),
  getGalleryUpload: (...a: unknown[]) => api.getGalleryUpload(...a),
  createGalleryImage: (...a: unknown[]) => api.createGalleryImage(...a),
  updateGalleryImage: (...a: unknown[]) => api.updateGalleryImage(...a),
  deleteGalleryImage: (...a: unknown[]) => api.deleteGalleryImage(...a),
  getAdminCustomOrders: (...a: unknown[]) => api.getAdminCustomOrders(...a),
  setCustomOrderStatus: (...a: unknown[]) => api.setCustomOrderStatus(...a),
  getAdminMessages: (...a: unknown[]) => api.getAdminMessages(...a),
  setMessageStatus: (...a: unknown[]) => api.setMessageStatus(...a),
  getAdminReviews: (...a: unknown[]) => api.getAdminReviews(...a),
  deleteAdminReview: (...a: unknown[]) => api.deleteAdminReview(...a),
}))

const pageOf = <T,>(items: T[]) => ({ items, total: items.length, page: 1, page_size: 20 })

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
  uploadToSignedUrl.mockReset().mockResolvedValue({ error: null })
})

// ---- gallery -------------------------------------------------------------------------------

const img = (over: Partial<AdminGalleryImage> = {}): AdminGalleryImage => ({
  gallery_image_id: 'g1',
  url: 'https://img/1.jpg',
  title: 'Sunny',
  description: null,
  image_type: 'SHOP',
  is_visible: false,
  created_at: '',
  ...over,
})

it('uploads a gallery picture with its details', async () => {
  api.getAdminGallery.mockResolvedValue(pageOf([]))
  api.getGalleryUpload.mockResolvedValue({
    storage_path: 'gallery/abc.png',
    upload_url: 'u',
    token: 't',
    bucket: 'gallery-images',
  })
  api.createGalleryImage.mockResolvedValue(img())
  render(<GalleryAdminPage />)
  const file = new File(['x'], 'a.png', { type: 'image/png' })
  await userEvent.upload(await screen.findByLabelText(/Picture \(JPG/), file)
  await userEvent.selectOptions(screen.getByLabelText('Type'), 'DESIGN')
  await userEvent.type(screen.getByLabelText('Title (optional)'), 'Bunny')
  await userEvent.click(screen.getByLabelText('Show in the public gallery'))
  await userEvent.click(screen.getByRole('button', { name: 'Add picture' }))
  expect(uploadToSignedUrl).toHaveBeenCalledWith('gallery-images', 'gallery/abc.png', 't', file)
  expect(api.createGalleryImage).toHaveBeenCalledWith({
    storage_path: 'gallery/abc.png',
    title: 'Bunny',
    description: null,
    image_type: 'DESIGN',
    is_visible: true,
  })
})

it('validates the gallery picture and explains a missing storage key', async () => {
  api.getAdminGallery.mockResolvedValue(pageOf([]))
  render(<GalleryAdminPage />)
  await userEvent.click(await screen.findByRole('button', { name: 'Add picture' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('choose a picture')
  api.getGalleryUpload.mockRejectedValue(new ApiError(503, 'x'))
  await userEvent.upload(
    screen.getByLabelText(/Picture \(JPG/),
    new File(['x'], 'a.png', { type: 'image/png' }),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Add picture' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('storage key missing')
})

it('shows, hides, re-types and deletes gallery pictures', async () => {
  api.getAdminGallery.mockResolvedValue(pageOf([img()]))
  api.updateGalleryImage.mockResolvedValue(img())
  api.deleteGalleryImage.mockResolvedValue(undefined)
  render(<GalleryAdminPage />)
  await userEvent.click(await screen.findByLabelText('Show Sunny in the gallery'))
  expect(api.updateGalleryImage).toHaveBeenCalledWith('g1', { is_visible: true })
  await userEvent.selectOptions(screen.getAllByLabelText('Type')[1], 'DESIGN')
  expect(api.updateGalleryImage).toHaveBeenCalledWith('g1', { image_type: 'DESIGN' })
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
  expect(api.deleteGalleryImage).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
  expect(api.deleteGalleryImage).toHaveBeenCalledWith('g1')
})

// ---- custom orders -------------------------------------------------------------------------

const co = (over: Partial<AdminCustomOrder> = {}): AdminCustomOrder => ({
  custom_order_id: 'c1',
  name: 'Sara',
  whatsapp_number: '0300 1234567',
  description: 'A jersey with a name',
  budget_paisa: 250000,
  required_date: '2026-12-01',
  status: 'NEW',
  has_reference_image: true,
  created_at: '2026-03-05T10:00:00Z',
  updated_at: '',
  customer_id: null,
  reference_image_url: 'https://down.example/x?sig=1',
  ...over,
})

it('shows custom orders with the private picture link and moves them along', async () => {
  api.getAdminCustomOrders.mockResolvedValue(pageOf([co()]))
  api.setCustomOrderStatus.mockResolvedValue(co({ status: 'IN_DISCUSSION' }))
  render(<CustomOrdersAdminPage />)
  expect(await screen.findByText('A jersey with a name')).toBeInTheDocument()
  expect(screen.getByText(/Budget Rs 2,500/)).toBeInTheDocument()
  const link = screen.getByRole('link', { name: 'View reference picture' })
  expect(link).toHaveAttribute('href', 'https://down.example/x?sig=1')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  await userEvent.click(screen.getByRole('button', { name: 'Start discussion' }))
  expect(api.setCustomOrderStatus).toHaveBeenCalledWith('c1', 'IN_DISCUSSION')
  expect(await screen.findByRole('button', { name: 'Accept' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Start discussion' })).not.toBeInTheDocument()
})

it('offers no actions for final statuses and filters by status', async () => {
  api.getAdminCustomOrders.mockResolvedValue(
    pageOf([co({ status: 'COMPLETED', reference_image_url: null })]),
  )
  render(<CustomOrdersAdminPage />)
  await screen.findByText('A jersey with a name')
  expect(screen.queryByRole('button', { name: /Cancel|Decline|Accept/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'View reference picture' })).not.toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Status'), 'ACCEPTED')
  expect(api.getAdminCustomOrders.mock.calls.at(-1)![0]).toMatchObject({
    status: 'ACCEPTED',
    page: 1,
  })
})

it('explains a refused custom-order change', async () => {
  api.getAdminCustomOrders.mockResolvedValue(pageOf([co()]))
  api.setCustomOrderStatus.mockRejectedValue(new ApiError(409, 'x', { code: 'INVALID_TRANSITION' }))
  render(<CustomOrdersAdminPage />)
  await userEvent.click(await screen.findByRole('button', { name: 'Decline' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('not allowed from the current status')
})

// ---- messages ------------------------------------------------------------------------------

const msg = (over: Partial<AdminMessage> = {}): AdminMessage => ({
  message_id: 'm1',
  name: 'Sara',
  email: 'sara@example.com',
  phone: null,
  whatsapp_number: '+92 300 1234567',
  message: 'Do you ship to Islamabad?',
  status: 'NEW',
  created_at: '2026-03-05T10:00:00Z',
  ...over,
})

it('shows messages with reply links and changes their status', async () => {
  api.getAdminMessages.mockResolvedValue(pageOf([msg()]))
  api.setMessageStatus.mockResolvedValue(msg({ status: 'REPLIED' }))
  render(<MessagesAdminPage />)
  expect(await screen.findByText('Do you ship to Islamabad?')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Reply by email' })).toHaveAttribute(
    'href',
    'mailto:sara@example.com',
  )
  expect(screen.getByRole('link', { name: 'Reply on WhatsApp' })).toHaveAttribute(
    'href',
    'https://wa.me/923001234567',
  )
  await userEvent.selectOptions(screen.getByLabelText('Status of the message from Sara'), 'REPLIED')
  expect(api.setMessageStatus).toHaveBeenCalledWith('m1', 'REPLIED')
  expect(await screen.findByText('Replied', { selector: 'span' })).toBeInTheDocument()
})

it('handles messages without an email or WhatsApp, empty and error states', async () => {
  api.getAdminMessages.mockResolvedValue(
    pageOf([msg({ email: null, whatsapp_number: null, phone: '0300' })]),
  )
  const a = render(<MessagesAdminPage />)
  await screen.findByText('Do you ship to Islamabad?')
  expect(screen.queryByRole('link', { name: /Reply/ })).not.toBeInTheDocument()
  a.unmount()
  api.getAdminMessages.mockResolvedValue(pageOf([]))
  const b = render(<MessagesAdminPage />)
  expect(await screen.findByText(/all caught up/)).toBeInTheDocument()
  b.unmount()
  api.getAdminMessages.mockRejectedValue(new Error('x'))
  render(<MessagesAdminPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
})

// ---- reviews -------------------------------------------------------------------------------

const review = (over: Partial<AdminReview> = {}): AdminReview => ({
  review_id: 'r1',
  product_id: 'p1',
  rating: 2,
  comment: 'Not great',
  author: 'Ayesha',
  created_at: '2026-03-05T10:00:00Z',
  customer_id: 'c1',
  customer_name: 'Ayesha Khan',
  order_id: 'o1',
  product_name_snapshot: 'Sunflower',
  ...over,
})

it('lists reviews with full names for the admin and removes one after confirmation', async () => {
  api.getAdminReviews.mockResolvedValue(pageOf([review()]))
  api.deleteAdminReview.mockResolvedValue(undefined)
  render(<ReviewsAdminPage />)
  expect(await screen.findByText('Not great')).toBeInTheDocument()
  expect(screen.getByText(/Ayesha Khan/)).toBeInTheDocument()
  expect(screen.getByRole('img', { name: '2 out of 5 stars' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Remove review' }))
  expect(api.deleteAdminReview).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Yes, remove it' }))
  expect(api.deleteAdminReview).toHaveBeenCalledWith('r1')
})

it('shows "Former customer", empty and failure states for reviews', async () => {
  api.getAdminReviews.mockResolvedValue(
    pageOf([review({ customer_name: null, customer_id: null })]),
  )
  api.deleteAdminReview.mockRejectedValue(new Error('x'))
  const a = render(<ReviewsAdminPage />)
  expect(await screen.findByText(/Former customer/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Remove review' }))
  await userEvent.click(screen.getByRole('button', { name: 'Yes, remove it' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove')
  a.unmount()
  api.getAdminReviews.mockResolvedValue(pageOf([]))
  render(<ReviewsAdminPage />)
  expect(await screen.findByText('No reviews yet.')).toBeInTheDocument()
})
