import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api'
import UnsubscribePage from './UnsubscribePage'

const unsubscribeNewsletter = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  unsubscribeNewsletter: (...a: unknown[]) => unsubscribeNewsletter(...a),
}))

const open = (token = 'abcdefghijklmnop') =>
  render(
    <MemoryRouter initialEntries={[`/unsubscribe?token=${token}`]}>
      <UnsubscribePage />
    </MemoryRouter>,
  )

beforeEach(() => {
  unsubscribeNewsletter.mockReset()
})

it('asks first, and unsubscribes only after the button is pressed', async () => {
  unsubscribeNewsletter.mockResolvedValue({ unsubscribed: true })
  open()
  expect(unsubscribeNewsletter).not.toHaveBeenCalled() // opening the link changes nothing
  await userEvent.click(screen.getByRole('button', { name: 'Yes, unsubscribe me' }))
  expect(unsubscribeNewsletter).toHaveBeenCalledWith('abcdefghijklmnop')
  expect(await screen.findByRole('status')).toHaveTextContent(/unsubscribed/)
})

it('explains an old or used link', async () => {
  unsubscribeNewsletter.mockRejectedValue(new ApiError(404, 'x'))
  open()
  await userEvent.click(screen.getByRole('button', { name: 'Yes, unsubscribe me' }))
  expect(await screen.findByRole('status')).toHaveTextContent(/no longer valid/)
})

it('cannot be pressed without a token in the link', () => {
  open('')
  expect(screen.getByRole('button', { name: 'Yes, unsubscribe me' })).toBeDisabled()
})
