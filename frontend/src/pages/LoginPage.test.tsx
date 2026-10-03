import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { makeAuth } from '../test/auth'
import LoginPage from './LoginPage'

vi.mock('../lib/supabase', () => ({ supabase: {} }))

it('submits email and password to signIn', async () => {
  const { ctx, wrap } = makeAuth()
  render(wrap(<LoginPage />, '/login'))
  await userEvent.type(screen.getByLabelText('Email'), 'a@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'secret123')
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
  expect(ctx.signIn).toHaveBeenCalledWith('a@example.com', 'secret123')
})

it('shows a generic error when login fails', async () => {
  const { wrap } = makeAuth({ signIn: vi.fn().mockRejectedValue(new Error('Invalid login')) })
  render(wrap(<LoginPage />, '/login'))
  await userEvent.type(screen.getByLabelText('Email'), 'a@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'bad')
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password')
})
