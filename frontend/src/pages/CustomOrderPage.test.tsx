import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api'
import CustomOrderPage from './CustomOrderPage'

const api = { getCustomOrderUploadTarget: vi.fn(), submitCustomOrder: vi.fn() }
const uploadToSignedUrl = vi.fn()
vi.mock('../lib/supabase', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        uploadToSignedUrl: (...a: unknown[]) => uploadToSignedUrl(bucket, ...a),
      }),
    },
  },
}))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getCustomOrderUploadTarget: (...a: unknown[]) => api.getCustomOrderUploadTarget(...a),
  submitCustomOrder: (...a: unknown[]) => api.submitCustomOrder(...a),
}))

const renderPage = () =>
  render(
    <MemoryRouter>
      <CustomOrderPage />
    </MemoryRouter>,
  )

async function fillBasics() {
  await userEvent.type(screen.getByLabelText('Your name'), 'Sara')
  await userEvent.type(screen.getByLabelText('WhatsApp number'), '0300 1234567')
  await userEvent.type(screen.getByLabelText(/What should we make/), 'A jersey with a name')
}

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
  uploadToSignedUrl.mockReset().mockResolvedValue({ error: null })
  api.submitCustomOrder.mockResolvedValue({})
})

it('submits a request without a picture, converting the budget to paisa', async () => {
  renderPage()
  await fillBasics()
  await userEvent.type(screen.getByLabelText(/Budget/), '2500.50')
  await userEvent.click(screen.getByRole('button', { name: 'Send request' }))
  expect(api.submitCustomOrder).toHaveBeenCalledWith({
    name: 'Sara',
    whatsapp_number: '0300 1234567',
    description: 'A jersey with a name',
    budget_paisa: 250050,
    required_date: null,
    reference_image_path: null,
  })
  expect(api.getCustomOrderUploadTarget).not.toHaveBeenCalled()
  expect(await screen.findByText('Request sent')).toBeInTheDocument()
})

it('uploads the picture straight to private storage, then submits its path', async () => {
  api.getCustomOrderUploadTarget.mockResolvedValue({
    storage_path: 'custom-orders/abc.png',
    upload_url: 'https://x',
    token: 'tok',
    bucket: 'custom-order-references',
  })
  renderPage()
  await fillBasics()
  const file = new File(['png-bytes'], 'idea.png', { type: 'image/png' })
  await userEvent.upload(screen.getByLabelText(/Reference picture/), file)
  await userEvent.click(screen.getByRole('button', { name: 'Send request' }))
  expect(api.getCustomOrderUploadTarget).toHaveBeenCalledWith('image/png')
  expect(uploadToSignedUrl).toHaveBeenCalledWith(
    'custom-order-references',
    'custom-orders/abc.png',
    'tok',
    file,
  )
  expect(api.submitCustomOrder.mock.calls[0][0].reference_image_path).toBe('custom-orders/abc.png')
  expect(await screen.findByText('Request sent')).toBeInTheDocument()
})

it('refuses bad budgets and bad pictures before sending anything', async () => {
  renderPage()
  await fillBasics()
  await userEvent.type(screen.getByLabelText(/Budget/), 'lots')
  await userEvent.click(screen.getByRole('button', { name: 'Send request' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('budget as a number')
  await userEvent.clear(screen.getByLabelText(/Budget/))
  const pdf = new File(['x'], 'doc.pdf', { type: 'application/pdf' })
  await userEvent.upload(screen.getByLabelText(/Reference picture/), pdf, { applyAccept: false })
  await userEvent.click(screen.getByRole('button', { name: 'Send request' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('JPG, PNG or WebP')
  expect(api.submitCustomOrder).not.toHaveBeenCalled()
})

it('stops if the picture upload fails and explains server problems', async () => {
  api.getCustomOrderUploadTarget.mockResolvedValue({
    storage_path: 'custom-orders/abc.png',
    upload_url: 'https://x',
    token: 'tok',
    bucket: 'custom-order-references',
  })
  uploadToSignedUrl.mockResolvedValue({ error: new Error('boom') })
  renderPage()
  await fillBasics()
  await userEvent.upload(
    screen.getByLabelText(/Reference picture/),
    new File(['x'], 'a.png', { type: 'image/png' }),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Send request' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not send your request')
  expect(api.submitCustomOrder).not.toHaveBeenCalled()
})

it.each([
  [429, 'several requests recently'],
  [422, 'check your details'],
  [503, 'without a picture'],
])('explains a %s response', async (status, text) => {
  api.submitCustomOrder.mockRejectedValue(new ApiError(status, 'x'))
  renderPage()
  await fillBasics()
  await userEvent.click(screen.getByRole('button', { name: 'Send request' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(text)
})
