import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError, type Order } from '../lib/api'
import { makeAuth } from '../test/auth'
import { TransferPayment } from './TransferPayment'

const api = {
  getPublicSettings: vi.fn(),
  getProofUploadTarget: vi.fn(),
  sendPaymentProof: vi.fn(),
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
  getPublicSettings: (...a: unknown[]) => api.getPublicSettings(...a),
  getProofUploadTarget: (...a: unknown[]) => api.getProofUploadTarget(...a),
  sendPaymentProof: (...a: unknown[]) => api.sendPaymentProof(...a),
}))

const order = (over: Partial<Order> = {}): Order =>
  ({
    order_id: 'o1',
    status: 'PENDING',
    payment_method: 'TRANSFER',
    payment_status: 'PENDING',
    payment_deadline_at: '2026-03-05T10:30:00Z',
    proof_submitted_at: null,
    total_amount_paisa: 270100,
    ...over,
  }) as Order

const show = (o: Order, onUpdated = vi.fn()) => {
  const { wrap } = makeAuth()
  render(wrap(<TransferPayment order={o} onUpdated={onUpdated} />))
  return onUpdated
}

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
  uploadToSignedUrl.mockReset().mockResolvedValue({ error: null })
  api.getPublicSettings.mockResolvedValue({ transfer_instructions: 'JazzCash 0300 1234567' })
})

it('shows the amount, where to send it and the form', async () => {
  show(order())
  expect(screen.getByRole('heading', { name: /Send Rs 2,701 to the shop/ })).toBeInTheDocument()
  expect(await screen.findByText('JazzCash 0300 1234567')).toBeInTheDocument()
  expect(screen.getByLabelText(/Transaction number/)).toBeInTheDocument()
  expect(screen.getByLabelText(/screenshot of the payment/i)).toBeInTheDocument()
})

it.each([
  ['COD order', order({ payment_method: 'COD' })],
  ['already paid', order({ payment_status: 'PAID' })],
  ['cancelled', order({ status: 'CANCELLED' })],
])('shows nothing for a %s', (_name, o) => {
  const { container } = render(<TransferPayment order={o} onUpdated={vi.fn()} />)
  expect(container).toBeEmptyDOMElement()
})

it('sends a transaction number without a screenshot', async () => {
  const updated = order({ proof_submitted_at: '2026-03-05T10:05:00Z' })
  api.sendPaymentProof.mockResolvedValue(updated)
  const onUpdated = show(order())
  await userEvent.type(screen.getByLabelText(/Transaction number/), '  TX-998877 ')
  await userEvent.click(screen.getByRole('button', { name: /I have paid/ }))
  expect(api.sendPaymentProof).toHaveBeenCalledWith('o1', {
    reference: 'TX-998877',
    image_path: null,
  })
  expect(api.getProofUploadTarget).not.toHaveBeenCalled()
  expect(onUpdated).toHaveBeenCalledWith(updated)
  expect(await screen.findByText('Payment details sent')).toBeInTheDocument() // a pop-up
})

it('uploads a screenshot straight to the private bucket, then sends its path', async () => {
  api.getProofUploadTarget.mockResolvedValue({
    storage_path: 'payment-proofs/abc.png',
    upload_url: 'u',
    token: 't',
    bucket: 'payment-proofs',
  })
  api.sendPaymentProof.mockResolvedValue(order({ proof_submitted_at: '2026-03-05T10:05:00Z' }))
  show(order())
  const file = new File(['x'], 'pay.png', { type: 'image/png' })
  await userEvent.upload(screen.getByLabelText(/screenshot of the payment/i), file)
  await userEvent.click(screen.getByRole('button', { name: /I have paid/ }))
  expect(api.getProofUploadTarget).toHaveBeenCalledWith('o1', 'image/png')
  expect(uploadToSignedUrl).toHaveBeenCalledWith(
    'payment-proofs',
    'payment-proofs/abc.png',
    't',
    file,
  )
  expect(api.sendPaymentProof).toHaveBeenCalledWith('o1', {
    reference: null,
    image_path: 'payment-proofs/abc.png',
  })
})

it('needs a number or a screenshot, and refuses other file types', async () => {
  show(order())
  await userEvent.click(screen.getByRole('button', { name: /I have paid/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('transaction number')
  await userEvent.upload(
    screen.getByLabelText(/screenshot of the payment/i),
    new File(['x'], 'a.pdf', { type: 'application/pdf' }),
    { applyAccept: false },
  )
  await userEvent.click(screen.getByRole('button', { name: /I have paid/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('JPG, PNG or WebP')
  expect(api.sendPaymentProof).not.toHaveBeenCalled()
})

it('explains a closed payment window and other failures', async () => {
  api.sendPaymentProof.mockRejectedValue(new ApiError(409, 'x', { code: 'PAYMENT_WINDOW_CLOSED' }))
  show(order())
  await userEvent.type(screen.getByLabelText(/Transaction number/), 'TX1')
  await userEvent.click(screen.getByRole('button', { name: /I have paid/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '30 minutes for this payment have passed',
  )
  api.sendPaymentProof.mockRejectedValue(new Error('x'))
  await userEvent.click(screen.getByRole('button', { name: /I have paid/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not send your details')
})

it('after sending, tells the customer the shop is checking', () => {
  show(order({ proof_submitted_at: '2026-03-05T10:05:00Z' }))
  expect(screen.getByRole('status')).toHaveTextContent(/will check its account/)
  expect(screen.queryByLabelText(/Transaction number/)).not.toBeInTheDocument()
})
