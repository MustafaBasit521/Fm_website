import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useToast } from './context'
import { ToastProvider } from './ToastProvider'

function Trigger({ n = 1 }: { n?: number }) {
  const toast = useToast()
  return (
    <button
      type="button"
      onClick={() => {
        for (let i = 1; i <= n; i++) toast.show(`Message ${i}`)
      }}
    >
      go
    </button>
  )
}
const open = (n?: number) =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <Trigger n={n} />
      </ToastProvider>
    </MemoryRouter>,
  )

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
afterEach(() => vi.useRealTimers())

it('shows a message and removes it by itself after a few seconds', async () => {
  open()
  act(() => screen.getByRole('button', { name: 'go' }).click())
  expect(screen.getByText('Message 1')).toBeInTheDocument()
  act(() => void vi.advanceTimersByTime(5000))
  expect(screen.queryByText('Message 1')).not.toBeInTheDocument()
})

it('keeps at most three at once, dropping the oldest', () => {
  open(5)
  act(() => screen.getByRole('button', { name: 'go' }).click())
  expect(screen.queryByText('Message 2')).not.toBeInTheDocument()
  for (const n of [3, 4, 5]) expect(screen.getByText(`Message ${n}`)).toBeInTheDocument()
})

it('does nothing, and does not crash, outside a provider', () => {
  render(<Trigger />)
  act(() => screen.getByRole('button', { name: 'go' }).click())
  expect(screen.queryByText('Message 1')).not.toBeInTheDocument()
})
