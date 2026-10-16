import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { StatusBadge } from './StatusBadge'
import { STATUS_COLORS } from './statusColors'

it('writes the status out in words and colours it per status', () => {
  const { rerender } = render(<StatusBadge status="SHIPPED" />)
  const badge = screen.getByText('Shipped')
  expect(badge).toHaveStyle({ backgroundColor: STATUS_COLORS.SHIPPED.bg })
  rerender(<StatusBadge status="CANCELLED" />)
  expect(screen.getByText('Cancelled')).toHaveStyle({ backgroundColor: STATUS_COLORS.CANCELLED.bg })
})

it('has a colour for every order status and copes with an unknown one', () => {
  for (const s of ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'])
    expect(STATUS_COLORS[s]).toBeDefined()
  render(<StatusBadge status="WEIRD" />)
  expect(screen.getByText('WEIRD')).toBeInTheDocument()
})
