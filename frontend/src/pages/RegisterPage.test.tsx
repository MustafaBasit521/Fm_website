import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { makeAuth } from '../test/auth'
import RegisterPage from './RegisterPage'

vi.mock('../lib/supabase', () => ({ supabase: {} }))

it('registers with name, email and password and asks to confirm the email', async () => {
  const { ctx, wrap } = makeAuth()
  render(wrap(<RegisterPage />, '/register'))
  await userEvent.type(screen.getByLabelText('Name'), 'Ayesha')
  await userEvent.type(screen.getByLabelText('Email'), 'a@example.com')
  await userEvent.type(screen.getByLabelText(/Password/), 'secret123')
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
  expect(ctx.signUp).toHaveBeenCalledWith('Ayesha', 'a@example.com', 'secret123')
  expect(await screen.findByText('Check your email')).toBeInTheDocument()
})
