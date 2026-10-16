import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it } from 'vitest'
import { OrderBreakdown } from './OrderBreakdown'

const order = {
  subtotal_paisa: 150000,
  delivery_fee_paisa: 20000,
  total_amount_paisa: 170000,
  items: [
    {
      product_id: 'p1',
      product_name_snapshot: 'Sunflower',
      quantity: 2,
      unit_price_at_purchase_paisa: 50000,
      image_url: 'https://img/p1.jpg',
    },
    {
      product_id: null,
      product_name_snapshot: 'Old keychain',
      quantity: 1,
      unit_price_at_purchase_paisa: 50000,
      image_url: null,
    },
  ],
}

it('shows each item with its picture, and a plain tile when the picture is gone', () => {
  const { container } = render(
    <MemoryRouter>
      <OrderBreakdown order={order} />
    </MemoryRouter>,
  )
  expect(screen.getByText('2 × Sunflower')).toBeInTheDocument()
  expect(container.querySelectorAll('img')).toHaveLength(1)
  expect(container.querySelector('img')).toHaveAttribute('src', 'https://img/p1.jpg')
  expect(screen.getByText('1 × Old keychain')).toBeInTheDocument()
  expect(screen.getByText('Rs 1,700')).toBeInTheDocument()
})
