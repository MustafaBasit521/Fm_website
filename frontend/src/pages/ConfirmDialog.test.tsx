import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

function Harness({ onConfirm }: { onConfirm: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        ask
      </button>
      <ConfirmDialog
        open={open}
        title="Delete it?"
        confirmLabel="Yes, delete"
        danger
        onCancel={() => setOpen(false)}
        onConfirm={onConfirm}
      >
        <p>This cannot be undone.</p>
      </ConfirmDialog>
    </>
  )
}

afterEach(() => {
  document.body.style.overflow = ''
})

it('is a labelled alert dialog that starts on the safe button and stops the page scrolling', async () => {
  render(<Harness onConfirm={vi.fn()} />)
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'ask' }))
  const dialog = screen.getByRole('alertdialog', { name: 'Delete it?' })
  expect(dialog).toHaveAccessibleDescription('This cannot be undone.')
  expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus()
  expect(document.body.style.overflow).toBe('hidden')
})

it('confirms only when the confirm button is pressed', async () => {
  const onConfirm = vi.fn()
  render(<Harness onConfirm={onConfirm} />)
  await userEvent.click(screen.getByRole('button', { name: 'ask' }))
  await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
  expect(onConfirm).toHaveBeenCalledTimes(1)
})

it('cancels with Escape and gives focus back to the button that opened it', async () => {
  const onConfirm = vi.fn()
  render(<Harness onConfirm={onConfirm} />)
  const opener = screen.getByRole('button', { name: 'ask' })
  await userEvent.click(opener)
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(opener).toHaveFocus()
  expect(onConfirm).not.toHaveBeenCalled()
})

it('keeps Tab inside the dialog', async () => {
  render(<Harness onConfirm={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'ask' }))
  await userEvent.tab()
  expect(screen.getByRole('button', { name: 'Yes, delete' })).toHaveFocus()
  await userEvent.tab()
  expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus()
})

it('keeps the focus in a field inside the dialog while the page re-renders on every keystroke', async () => {
  function WithField() {
    const [note, setNote] = useState('')
    return (
      <ConfirmDialog
        open
        title="Why?"
        confirmLabel="Save"
        onCancel={() => {}} // a new function on every render
        onConfirm={() => {}}
      >
        <label htmlFor="n">Note</label>
        <textarea id="n" value={note} onChange={(e) => setNote(e.target.value)} />
      </ConfirmDialog>
    )
  }
  render(<WithField />)
  await userEvent.type(screen.getByLabelText('Note'), 'abc')
  expect(screen.getByLabelText('Note')).toHaveValue('abc')
  expect(screen.getByLabelText('Note')).toHaveFocus()
})
