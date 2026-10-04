import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api'
import ContactPage from './ContactPage'

const sendContactMessage = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  sendContactMessage: (...a: unknown[]) => sendContactMessage(...a),
}))

const renderPage = () =>
  render(
    <MemoryRouter>
      <ContactPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  sendContactMessage.mockReset()
})

it('sends a message and thanks the customer', async () => {
  sendContactMessage.mockResolvedValue({ received: true })
  renderPage()
  await userEvent.type(screen.getByLabelText('Your name'), 'Sara')
  await userEvent.type(screen.getByLabelText('Email'), 'sara@example.com')
  await userEvent.type(screen.getByLabelText('Message'), 'Do you ship to Islamabad?')
  await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
  expect(sendContactMessage).toHaveBeenCalledWith({
    name: 'Sara',
    email: 'sara@example.com',
    phone: null,
    whatsapp_number: null,
    message: 'Do you ship to Islamabad?',
  })
  expect(await screen.findByText(/received your message/)).toBeInTheDocument()
})

it('needs at least one way to reply, without calling the server', async () => {
  renderPage()
  await userEvent.type(screen.getByLabelText('Your name'), 'Sara')
  await userEvent.type(screen.getByLabelText('Message'), 'Hello')
  await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('email, phone or WhatsApp')
  expect(sendContactMessage).not.toHaveBeenCalled()
})

it.each([
  [429, 'several messages recently'],
  [422, 'check your details'],
  [500, 'Could not send your message'],
])('explains a %s response', async (status, text) => {
  sendContactMessage.mockRejectedValue(new ApiError(status, 'x'))
  renderPage()
  await userEvent.type(screen.getByLabelText('Your name'), 'Sara')
  await userEvent.type(screen.getByLabelText('Phone'), '03001234567')
  await userEvent.type(screen.getByLabelText('Message'), 'Hello')
  await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(text)
})
