import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api'
import CustomOrderPage from './CustomOrderPage'

const api = {
  getCustomOrderUploadTarget: vi.fn(),
  submitCustomOrder: vi.fn(),
  getPublicSettings: vi.fn(),
}
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
  getPublicSettings: (...a: unknown[]) => api.getPublicSettings(...a),
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
  api.getPublicSettings.mockRejectedValue(new Error('x'))
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

it('writes the chosen kind of piece at the top of the description', async () => {
  renderPage()
  await fillBasics()
  await userEvent.click(screen.getByLabelText('Keychain'))
  await userEvent.click(screen.getByRole('button', { name: 'Send request' }))
  expect(api.submitCustomOrder).toHaveBeenCalledWith(
    expect.objectContaining({ description: 'Type: Keychain\n\nA jersey with a name' }),
  )
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

it('can send the typed request on WhatsApp instead, without saving anything', async () => {
  api.getPublicSettings.mockResolvedValue({ whatsapp: '+92 300 1234567' })
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  renderPage()
  await fillBasics()
  await userEvent.click(screen.getByLabelText('Keychain'))
  await userEvent.click(await screen.findByRole('button', { name: 'Or send this on WhatsApp' }))
  const [url, target] = open.mock.calls[0] as [string, string]
  expect(url).toMatch(/^https:\/\/wa\.me\/923001234567\?text=/)
  const text = decodeURIComponent(url.split('?text=')[1])
  expect(text).toContain('Type: Keychain')
  expect(text).toContain('Name: Sara')
  expect(text).toContain('Details: A jersey with a name')
  expect(target).toBe('_blank')
  expect(api.submitCustomOrder).not.toHaveBeenCalled()
  open.mockRestore()
})

it('shows no WhatsApp button without a shop number', () => {
  renderPage()
  expect(screen.queryByRole('button', { name: /WhatsApp/ })).not.toBeInTheDocument()
})
