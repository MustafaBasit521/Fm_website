import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { GalleryImage, Page } from '../lib/api'
import GalleryPage from './GalleryPage'

const getGallery = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  getGallery: (...a: unknown[]) => getGallery(...a),
}))

const img = (n: number, over: Partial<GalleryImage> = {}): GalleryImage => ({
  gallery_image_id: `g${n}`,
  url: `https://img/${n}.jpg`,
  title: `Photo ${n}`,
  description: null,
  image_type: 'SHOP',
  ...over,
})
const page = (items: GalleryImage[], total = items.length): Page<GalleryImage> => ({
  items,
  total,
  page: 1,
  page_size: 24,
})
const renderPage = () =>
  render(
    <MemoryRouter>
      <GalleryPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  getGallery.mockReset()
})

it('shows images with captions and filters by type', async () => {
  getGallery.mockResolvedValue(page([img(1, { description: 'Made with love' }), img(2)]))
  renderPage()
  expect(await screen.findByAltText('Photo 1')).toBeInTheDocument()
  expect(screen.getByText('Made with love')).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Show'), 'DESIGN')
  expect(getGallery.mock.calls.at(-1)![0]).toBe('DESIGN')
  expect(getGallery.mock.calls.at(-1)![1]).toBe(1)
})

it('shows empty, error and pagination states', async () => {
  getGallery.mockResolvedValue(page([]))
  const first = renderPage()
  expect(await screen.findByText('Nothing here yet.')).toBeInTheDocument()
  first.unmount()
  getGallery.mockRejectedValue(new Error('x'))
  const second = renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the gallery')
  second.unmount()
  getGallery.mockReset().mockResolvedValue(page([img(1)], 50))
  renderPage()
  await screen.findByText('Page 1 of 3')
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(getGallery.mock.calls.at(-1)![1]).toBe(2)
})
