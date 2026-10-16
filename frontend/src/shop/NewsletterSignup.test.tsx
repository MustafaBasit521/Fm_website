import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api'
import { NewsletterSignup } from './NewsletterSignup'

const subscribeNewsletter = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  subscribeNewsletter: (...a: unknown[]) => subscribeNewsletter(...a),
}))

beforeEach(() => {
  subscribeNewsletter.mockReset()
})

it('signs a visitor up and thanks them', async () => {
  subscribeNewsletter.mockResolvedValue({ subscribed: true })
  render(<NewsletterSignup />)
  await userEvent.type(screen.getByLabelText('Your email address'), ' me@example.com ')
  await userEvent.click(screen.getByRole('button', { name: 'Join' }))
  expect(subscribeNewsletter).toHaveBeenCalledWith('me@example.com')
  expect(await screen.findByRole('status')).toHaveTextContent(/on the list/)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

it.each([
  [429, /Too many attempts/],
  [422, /valid email/],
  [500, /Could not sign you up/],
])('shows a clear message for a %s answer', async (status, message) => {
  subscribeNewsletter.mockRejectedValue(new ApiError(status, 'x'))
  render(<NewsletterSignup />)
  await userEvent.type(screen.getByLabelText('Your email address'), 'me@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Join' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(message)
})
