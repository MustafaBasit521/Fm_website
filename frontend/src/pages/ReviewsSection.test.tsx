import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError, type MyReviewState, type Review, type ReviewList } from '../lib/api'
import { fakeSession, makeAuth } from '../test/auth'
import { ReviewsSection } from './ReviewsSection'

const api = {
  getReviews: vi.fn(),
  getMyReviewState: vi.fn(),
  createReview: vi.fn(),
  updateReview: vi.fn(),
  deleteReview: vi.fn(),
}
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getReviews: (...a: unknown[]) => api.getReviews(...a),
  getMyReviewState: (...a: unknown[]) => api.getMyReviewState(...a),
  createReview: (...a: unknown[]) => api.createReview(...a),
  updateReview: (...a: unknown[]) => api.updateReview(...a),
  deleteReview: (...a: unknown[]) => api.deleteReview(...a),
}))

const review = (over: Partial<Review> = {}): Review => ({
  review_id: 'r1',
  product_id: 'p1',
  rating: 4,
  comment: 'Lovely work',
  author: 'Ayesha',
  created_at: '2026-03-05T10:00:00Z',
  ...over,
})
const list = (items: Review[], over: Partial<ReviewList> = {}): ReviewList => ({
  items,
  total: items.length,
  page: 1,
  page_size: 10,
  average_rating: items.length ? 4 : null,
  rating_count: items.length,
  ...over,
})
const state = (over: Partial<MyReviewState> = {}): MyReviewState => ({
  eligible: false,
  review: null,
  ...over,
})

const renderSection = (signedIn = true) =>
  render(makeAuth(signedIn ? { session: fakeSession } : {}).wrap(<ReviewsSection productId="p1" />))

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
  api.getReviews.mockResolvedValue(list([review()]))
  api.getMyReviewState.mockResolvedValue(state())
})

it('shows reviews with the average, by first name only', async () => {
  renderSection(false)
  expect(await screen.findByText('Lovely work')).toBeInTheDocument()
  expect(screen.getByText('Ayesha')).toBeInTheDocument()
  expect(screen.getByText(/4 out of 5 · 1 review/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument()
  expect(api.getMyReviewState).not.toHaveBeenCalled() // signed-out: no private calls
})

it('shows an empty and an error state', async () => {
  api.getReviews.mockResolvedValue(list([]))
  const { unmount } = renderSection(false)
  expect(await screen.findByText('No reviews yet.')).toBeInTheDocument()
  unmount()
  api.getReviews.mockRejectedValue(new Error('x'))
  renderSection(false)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load reviews')
})

it('tells customers who have not received the product that they cannot review yet', async () => {
  renderSection()
  expect(await screen.findByText(/after your order is delivered/)).toBeInTheDocument()
  expect(screen.queryByRole('form', { name: 'Write a review' })).not.toBeInTheDocument()
})

it('lets an eligible customer post a review and reloads the list', async () => {
  api.getMyReviewState.mockResolvedValue(state({ eligible: true }))
  api.createReview.mockResolvedValue(review())
  renderSection()
  const form = await screen.findByRole('form', { name: 'Write a review' })
  expect(form).toBeInTheDocument()
  await userEvent.click(screen.getByLabelText('5'))
  await userEvent.type(screen.getByLabelText('Comment (optional)'), '  Great  ')
  api.getMyReviewState.mockResolvedValue(
    state({ eligible: true, review: review({ rating: 5, comment: 'Great' }) }),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Post review' }))
  expect(api.createReview).toHaveBeenCalledWith('p1', { rating: 5, comment: 'Great' })
  expect(await screen.findByText('Your review')).toBeInTheDocument()
  expect(api.getReviews.mock.calls.length).toBeGreaterThan(1) // the list was reloaded
})

it('asks for a rating before posting', async () => {
  api.getMyReviewState.mockResolvedValue(state({ eligible: true }))
  renderSection()
  await userEvent.click(await screen.findByRole('button', { name: 'Post review' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('choose a rating')
  expect(api.createReview).not.toHaveBeenCalled()
})

it.each([
  ['NOT_ELIGIBLE', 403, 'after an order containing it has been delivered'],
  ['ALREADY_REVIEWED', 409, 'already reviewed'],
])('explains %s', async (code, status, text) => {
  api.getMyReviewState.mockResolvedValue(state({ eligible: true }))
  api.createReview.mockRejectedValue(new ApiError(status, 'x', { code }))
  renderSection()
  await userEvent.click(await screen.findByLabelText('3'))
  await userEvent.click(screen.getByRole('button', { name: 'Post review' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(text)
})

it('lets customers edit and delete their own review', async () => {
  api.getMyReviewState.mockResolvedValue(
    state({ eligible: true, review: review({ rating: 2, comment: 'meh' }) }),
  )
  api.updateReview.mockResolvedValue(review({ rating: 5 }))
  api.deleteReview.mockResolvedValue(undefined)
  renderSection()
  await userEvent.click(await screen.findByRole('button', { name: 'Edit review' }))
  expect(screen.getByLabelText('2')).toBeChecked()
  expect(screen.getByDisplayValue('meh')).toBeInTheDocument()
  await userEvent.click(screen.getByLabelText('5'))
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(api.updateReview).toHaveBeenCalledWith('p1', { rating: 5, comment: 'meh' })
  await userEvent.click(await screen.findByRole('button', { name: 'Delete review' }))
  expect(api.deleteReview).toHaveBeenCalledWith('p1')
})
