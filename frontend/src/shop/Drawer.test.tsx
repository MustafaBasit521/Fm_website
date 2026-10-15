import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { Drawer } from './Drawer'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open it
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Filters"
        footer={<button type="button">footer action</button>}
      >
        <button type="button">first inside</button>
        <input aria-label="field" />
      </Drawer>
    </>
  )
}

afterEach(() => {
  document.body.style.overflow = ''
})

it('is a labelled modal dialog that moves focus inside and stops the page behind from scrolling', async () => {
  render(<Harness />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'open it' }))
  const dialog = screen.getByRole('dialog', { name: 'Filters' })
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  expect(screen.getByRole('button', { name: 'Close filters' })).toHaveFocus()
  expect(document.body.style.overflow).toBe('hidden')
})

it('closes with Escape and gives focus back to the button that opened it', async () => {
  render(<Harness />)
  const opener = screen.getByRole('button', { name: 'open it' })
  await userEvent.click(opener)
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(opener).toHaveFocus()
  expect(document.body.style.overflow).toBe('') // scrolling is restored
})

it('closes from the close button and from a click on the dimmed background', async () => {
  const { container } = render(<Harness />)
  await userEvent.click(screen.getByRole('button', { name: 'open it' }))
  await userEvent.click(screen.getByRole('button', { name: 'Close filters' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'open it' }))
  await userEvent.click(
    container.ownerDocument.querySelector('[aria-hidden="true"].absolute') as HTMLElement,
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('keeps Tab inside the drawer (wraps from the last control to the first and back)', async () => {
  render(<Harness />)
  await userEvent.click(screen.getByRole('button', { name: 'open it' }))
  const close = screen.getByRole('button', { name: 'Close filters' })
  const last = screen.getByRole('button', { name: 'footer action' })
  last.focus()
  await userEvent.tab()
  expect(close).toHaveFocus()
  await userEvent.tab({ shift: true })
  expect(last).toHaveFocus()
})
