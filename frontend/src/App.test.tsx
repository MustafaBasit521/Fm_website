import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'

afterEach(() => vi.unstubAllGlobals())

it('shows connected state when the health endpoint succeeds', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('{"status":"ok"}', { status: 200 })),
  )
  render(<App />)
  expect(await screen.findByText('API connected.')).toBeInTheDocument()
})

it('shows an error state when the API is unreachable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')))
  render(<App />)
  expect(await screen.findByText('Cannot reach the API.')).toBeInTheDocument()
})
