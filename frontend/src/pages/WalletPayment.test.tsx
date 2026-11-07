import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError, type Order, type PaymentAttempt } from '../lib/api'
import { makeAuth } from '../test/auth'
import { WalletPayment } from './WalletPayment'

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

const attempt = (over: Partial<PaymentAttempt> = {}): PaymentAttempt => ({
  attempt_id: 'a1',
  status: 'SUBMITTED',
  transaction_reference: 'TX-998877',
  amount_paisa: 270100,
  created_at: '2026-03-05T10:05:00Z',
  rejection_reason: null,
  rejection_note: null,
  reviewed_at: null,
  ...over,
})
const order = (over: Partial<Order> = {}): Order =>
  ({
    order_id: 'abcdef12-0000-0000-0000-000000000000',
    status: 'PENDING',
    payment_method: 'EASYPAISA',
    payment_status: 'PENDING',
    payment_deadline_at: '2026-03-05T10:30:00Z',
    proof_submitted_at: null,
    payment_attempts: [],
    total_amount_paisa: 270100,
    ...over,
  }) as Order

// The page decides what to show from the public settings, so wait for them before looking.
const show = async (o: Order, onUpdated = vi.fn()) => {
  const { wrap } = makeAuth()
  await act(async () => {
    render(wrap(<WalletPayment order={o} onUpdated={onUpdated} />))
  })
  return onUpdated
}
const receipt = () => new File(['x'], 'pay.png', { type: 'image/png' })
const fill = async (reference = 'TX-998877') => {
  await userEvent.type(screen.getByLabelText(/Transaction number/), reference)
  await userEvent.upload(screen.getByLabelText(/Screenshot of the receipt/i), receipt())
}

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
  uploadToSignedUrl.mockReset().mockResolvedValue({ error: null })
  api.getPublicSettings.mockResolvedValue({
    easypaisa_qr_url: 'https://img.example/payment-qr/ep.png',
    easypaisa_details: 'Sara Ahmed 0300 1234567',
    jazzcash_qr_url: 'https://img.example/payment-qr/jc.png',
    jazzcash_details: null,
    whatsapp: '0300 1234567',
    wallet_receipts_enabled: true, // the receipt flow; the launch behaviour is tested below
  })
})

it('shows the QR code, amount, order number, instructions and the form', async () => {
  await show(order())
  expect(screen.getByRole('heading', { name: /Pay Rs 2,701 with Easypaisa/ })).toBeInTheDocument()
  expect(screen.getByText('ABCDEF12')).toBeInTheDocument() // the order number
  expect(await screen.findByRole('img', { name: /Easypaisa QR code/ })).toHaveAttribute(
    'src',
    'https://img.example/payment-qr/ep.png',
  )
  expect(screen.getByText('Sara Ahmed 0300 1234567')).toBeInTheDocument()
  expect(screen.getByLabelText(/Transaction number/)).toBeInTheDocument()
  expect(screen.getByLabelText(/Screenshot of the receipt/i)).toBeInTheDocument()
})

it('shows the JazzCash QR code for a JazzCash order', async () => {
  await show(order({ payment_method: 'JAZZCASH' }))
  expect(await screen.findByRole('img', { name: /JazzCash QR code/ })).toHaveAttribute(
    'src',
    'https://img.example/payment-qr/jc.png',
  )
})

it.each([
  ['COD order', order({ payment_method: 'COD' })],
  ['online order', order({ payment_method: 'ONLINE' })],
  ['paid order without details', order({ payment_status: 'PAID' })],
  ['cancelled order without details', order({ status: 'CANCELLED' })],
])('shows nothing for a %s', async (_name, o) => {
  let container!: HTMLElement
  await act(async () => {
    container = render(<WalletPayment order={o} onUpdated={vi.fn()} />).container
  })
  expect(container).toBeEmptyDOMElement()
})

it('uploads the receipt straight to the private bucket, then sends the number and its path', async () => {
  api.getProofUploadTarget.mockResolvedValue({
    storage_path: 'payment-proofs/abc.png',
    upload_url: 'u',
    token: 't',
    bucket: 'payment-proofs',
  })
  const updated = order({ proof_submitted_at: '2026-03-05T10:05:00Z' })
  api.sendPaymentProof.mockResolvedValue(updated)
  const onUpdated = await show(order())
  await userEvent.type(screen.getByLabelText(/Transaction number/), '  TX-998877 ')
  const file = receipt()
  await userEvent.upload(screen.getByLabelText(/Screenshot of the receipt/i), file)
  await userEvent.click(screen.getByRole('button', { name: /I have paid/ }))
  expect(api.getProofUploadTarget).toHaveBeenCalledWith(order().order_id, 'image/png')
  expect(uploadToSignedUrl).toHaveBeenCalledWith(
    'payment-proofs',
    'payment-proofs/abc.png',
    't',
    file,
  )
  expect(api.sendPaymentProof).toHaveBeenCalledWith(order().order_id, {
    reference: 'TX-998877',
    image_path: 'payment-proofs/abc.png',
  })
  expect(onUpdated).toHaveBeenCalledWith(updated)
  expect(await screen.findByText('Payment details sent')).toBeInTheDocument() // a pop-up
})

it('needs BOTH a valid number and a receipt picture', async () => {
  await show(order())
  await userEvent.click(screen.getByRole('button', { name: /I have paid/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('transaction number')
  await userEvent.type(screen.getByLabelText(/Transaction number/), 'TX-998877')
  await userEvent.click(screen.getByRole('button', { name: /I have paid/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('screenshot of your receipt')
  await userEvent.upload(
    screen.getByLabelText(/Screenshot of the receipt/i),
    new File(['x'], 'a.pdf', { type: 'application/pdf' }),
    { applyAccept: false },
  )
  await userEvent.click(screen.getByRole('button', { name: /I have paid/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('JPG, PNG or WebP')
  expect(api.getProofUploadTarget).not.toHaveBeenCalled()
  expect(api.sendPaymentProof).not.toHaveBeenCalled()
})

it('rejects a number with spaces or too few characters before asking the server', async () => {
  await show(order())
  await fill('12 34')
  await userEvent.click(screen.getByRole('button', { name: /I have paid/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('transaction number')
  expect(api.sendPaymentProof).not.toHaveBeenCalled()
})

it.each([
  ['PAYMENT_WINDOW_CLOSED', 409, '30 minutes for this payment have passed'],
  ['DUPLICATE_REFERENCE', 409, 'already used'],
  ['ALREADY_SUBMITTED', 409, 'already with the shop'],
  ['X', 429, 'Too many attempts'],
  ['X', 500, 'Could not send your details'],
])('explains the %s failure', async (code, status, text) => {
  api.getProofUploadTarget.mockResolvedValue({
    storage_path: 'payment-proofs/abc.png',
    upload_url: 'u',
    token: 't',
    bucket: 'payment-proofs',
  })
  api.sendPaymentProof.mockRejectedValue(new ApiError(status, 'x', { code }))
  await show(order())
  await fill()
  await userEvent.click(screen.getByRole('button', { name: /I have paid/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent(text)
})

it('after sending, tells the customer the shop is checking and shows the number', async () => {
  await show(order({ proof_submitted_at: '2026-03-05T10:05:00Z', payment_attempts: [attempt()] }))
  expect(screen.getByRole('status')).toHaveTextContent(/will check its Easypaisa account/)
  expect(screen.getByText('TX-998877')).toBeInTheDocument()
  expect(screen.queryByLabelText(/Transaction number/)).not.toBeInTheDocument()
})

it('explains why a payment was rejected and offers corrected details', async () => {
  await show(
    order({
      payment_attempts: [
        attempt({
          status: 'REJECTED',
          rejection_reason: 'AMOUNT_MISMATCH',
          rejection_note: 'Rs 1,000',
        }),
      ],
    }),
  )
  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent('Your last payment was not accepted')
  expect(alert).toHaveTextContent('Payment amount does not match: Rs 1,000')
  expect(screen.getByRole('button', { name: 'Send corrected details' })).toBeInTheDocument()
  expect(screen.getByLabelText(/Transaction number/)).toBeInTheDocument()
})

it('shows the written reason when the shop chose "Other"', async () => {
  await show(
    order({
      payment_attempts: [
        attempt({ status: 'REJECTED', rejection_reason: 'OTHER', rejection_note: 'Wrong account' }),
      ],
    }),
  )
  expect(screen.getByRole('alert')).toHaveTextContent('Wrong account')
})

it('shows the verified transaction once the payment is settled', async () => {
  await show(
    order({
      status: 'CONFIRMED',
      payment_status: 'PAID',
      payment_attempts: [attempt({ status: 'PAID' })],
    }),
  )
  expect(screen.getByText('TX-998877')).toBeInTheDocument()
  expect(screen.getByText(/verified by the shop/)).toBeInTheDocument()
})

// ---- launch mode: pay, then send the screenshot on WhatsApp (receipt flow switched off) --------

const launchSettings = (over: Record<string, unknown> = {}) =>
  api.getPublicSettings.mockResolvedValue({
    easypaisa_qr_url: 'https://img.example/payment-qr/ep.png',
    easypaisa_details: 'Sara Ahmed 0300 1234567',
    jazzcash_qr_url: null,
    jazzcash_details: null,
    whatsapp: '0300 7654321',
    wallet_receipts_enabled: false,
    ...over,
  })

it('launch mode: shows the account, the exact amount, the order number and the WhatsApp step', async () => {
  launchSettings()
  await show(order({ payment_deadline_at: null }))
  expect(screen.getByRole('heading', { name: /Pay Rs 2,701 with Easypaisa/ })).toBeInTheDocument()
  expect(screen.getByText('ABCDEF12')).toBeInTheDocument()
  expect(screen.getByRole('img', { name: /Easypaisa QR code/ })).toBeInTheDocument()
  expect(screen.getByText('Sara Ahmed 0300 1234567')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent(
    'Send the payment, then message us the screenshot on WhatsApp. We will confirm your order once we receive it.',
  )
  const link = screen.getByRole('link', { name: 'Send the screenshot on WhatsApp' })
  expect(link).toHaveAttribute(
    'href',
    expect.stringMatching(/^https:\/\/wa\.me\/923007654321\?text=/),
  )
  expect(decodeURIComponent(link.getAttribute('href')!)).toContain('order ABCDEF12')
  expect(decodeURIComponent(link.getAttribute('href')!)).toContain('Rs 2,701')
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
})

it('launch mode: has no receipt form, no deadline text and never calls the receipt API', async () => {
  launchSettings()
  await show(order({ payment_deadline_at: null }))
  expect(screen.queryByLabelText(/Transaction number/)).not.toBeInTheDocument()
  expect(screen.queryByLabelText(/Screenshot of the receipt/i)).not.toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.queryByText(/30 minutes|before \d/)).not.toBeInTheDocument()
  expect(api.getProofUploadTarget).not.toHaveBeenCalled()
  expect(api.sendPaymentProof).not.toHaveBeenCalled()
})

it('launch mode: tells the customer when the shop confirmed the payment', async () => {
  launchSettings()
  await show(order({ status: 'CONFIRMED', payment_status: 'PAID' }))
  expect(screen.getByText(/Easypaisa payment received/)).toBeInTheDocument()
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
})

it('launch mode: shows nothing for a cancelled order', async () => {
  launchSettings()
  const { container } = await (async () => {
    let c!: HTMLElement
    await act(async () => {
      c = render(
        <WalletPayment order={order({ status: 'CANCELLED' })} onUpdated={vi.fn()} />,
      ).container
    })
    return { container: c }
  })()
  expect(container).toBeEmptyDOMElement()
})

it('launch mode: still explains what to do when the shop details cannot be loaded', async () => {
  api.getPublicSettings.mockRejectedValue(new Error('down'))
  await show(order())
  expect(screen.getByText(/account details could not be loaded/)).toBeInTheDocument()
  expect(screen.queryByRole('link')).not.toBeInTheDocument() // no WhatsApp number known
})
