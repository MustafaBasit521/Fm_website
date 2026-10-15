import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { QuantityStepper } from './QuantityStepper'

function Harness({ start = 2, min, max }: { start?: number; min?: number; max?: number }) {
  const [n, setN] = useState(start)
  return <QuantityStepper value={n} onChange={setN} label="Sunflower" min={min} max={max} />
}

it('is a labelled group whose buttons name the product', () => {
  render(<Harness />)
  expect(screen.getByRole('group', { name: 'Quantity of Sunflower' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Increase quantity of Sunflower' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Decrease quantity of Sunflower' })).toBeInTheDocument()
})

it('increases and decreases', async () => {
  render(<Harness />)
  await userEvent.click(screen.getByRole('button', { name: /Increase/ }))
  expect(screen.getByRole('status')).toHaveTextContent('3')
  await userEvent.click(screen.getByRole('button', { name: /Decrease/ }))
  await userEvent.click(screen.getByRole('button', { name: /Decrease/ }))
  expect(screen.getByRole('status')).toHaveTextContent('1')
})

it('cannot go below the minimum or above the maximum', async () => {
  render(<Harness start={1} />)
  expect(screen.getByRole('button', { name: /Decrease/ })).toBeDisabled()
  const onChange = vi.fn()
  render(<QuantityStepper value={99} onChange={onChange} label="Cup" />)
  expect(screen.getByRole('button', { name: 'Increase quantity of Cup' })).toBeDisabled()
  render(<QuantityStepper value={3} onChange={onChange} label="Bowl" max={3} />)
  expect(screen.getByRole('button', { name: 'Increase quantity of Bowl' })).toBeDisabled()
})
