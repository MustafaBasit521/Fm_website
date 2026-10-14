import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { makeAuth } from '../test/auth'
import { MfaStep } from './MfaStep'

const mfa = {
  listFactors: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
  challengeAndVerify: vi.fn(),
}
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      mfa: {
        listFactors: (...a: unknown[]) => mfa.listFactors(...a),
        enroll: (...a: unknown[]) => mfa.enroll(...a),
        unenroll: (...a: unknown[]) => mfa.unenroll(...a),
        challengeAndVerify: (...a: unknown[]) => mfa.challengeAndVerify(...a),
      },
    },
  },
}))

const factor = (over = {}) => ({ id: 'f1', factor_type: 'totp', status: 'verified', ...over })
const renderStep = (onDone = vi.fn()) => {
  const { ctx, wrap } = makeAuth()
  render(wrap(<MfaStep onDone={onDone} />))
  return { onDone, ctx }
}

beforeEach(() => {
  Object.values(mfa).forEach((m) => m.mockReset())
  mfa.unenroll.mockResolvedValue({ error: null })
  mfa.challengeAndVerify.mockResolvedValue({ error: null })
})

it('asks for the current code when an authenticator is already set up', async () => {
  mfa.listFactors.mockResolvedValue({ data: { totp: [factor()], all: [factor()] }, error: null })
  const { onDone } = renderStep()
  await userEvent.type(await screen.findByLabelText('6-digit code'), '123 456')
  await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
  expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f1', code: '123456' })
  expect(mfa.enroll).not.toHaveBeenCalled()
  expect(onDone).toHaveBeenCalled()
})

it('walks a first-time admin through setup with a QR code and a manual key', async () => {
  mfa.listFactors.mockResolvedValue({ data: { totp: [], all: [] }, error: null })
  mfa.enroll.mockResolvedValue({
    data: {
      id: 'new1',
      totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'ABCD EFGH', uri: 'otpauth://x' },
    },
    error: null,
  })
  const { onDone } = renderStep()
  expect(
    await screen.findByRole('heading', { name: 'Set up two-factor login' }),
  ).toBeInTheDocument()
  expect(screen.getByAltText('QR code to scan with your authenticator app')).toBeInTheDocument()
  expect(screen.getByText('ABCD EFGH')).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('6-digit code'), '654321')
  await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
  expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'new1', code: '654321' })
  expect(onDone).toHaveBeenCalled()
})

it('removes an abandoned half-finished setup before starting a new one', async () => {
  const stale = factor({ id: 'old', status: 'unverified' })
  mfa.listFactors.mockResolvedValue({ data: { totp: [], all: [stale] }, error: null })
  mfa.enroll.mockResolvedValue({
    data: { id: 'new1', totp: { qr_code: 'q', secret: 's', uri: 'u' } },
    error: null,
  })
  renderStep()
  await screen.findByLabelText('6-digit code')
  expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'old' })
})

it('rejects malformed codes locally and explains a wrong code', async () => {
  mfa.listFactors.mockResolvedValue({ data: { totp: [factor()], all: [factor()] }, error: null })
  const { onDone } = renderStep()
  const input = await screen.findByLabelText('6-digit code')
  await userEvent.type(input, '12ab')
  await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('6-digit code')
  expect(mfa.challengeAndVerify).not.toHaveBeenCalled()
  await userEvent.clear(input)
  mfa.challengeAndVerify.mockResolvedValue({ error: new Error('invalid') })
  await userEvent.type(input, '000000')
  await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('did not work')
  expect(onDone).not.toHaveBeenCalled()
})

it('shows an error if two-factor setup cannot start, and can log out', async () => {
  mfa.listFactors.mockResolvedValue({ data: null, error: new Error('x') })
  const { ctx } = renderStep()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not start two-factor login')
  await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
  expect(ctx.signOut).toHaveBeenCalled()
})

it('shows an error if enrolling fails', async () => {
  mfa.listFactors.mockResolvedValue({ data: { totp: [], all: [] }, error: null })
  mfa.enroll.mockResolvedValue({ data: null, error: new Error('x') })
  renderStep()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not start two-factor login')
})
