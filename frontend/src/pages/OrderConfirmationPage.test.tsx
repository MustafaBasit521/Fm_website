import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it } from 'vitest'
import type { Order } from '../lib/api'
import { saveLastOrder } from '../lib/lastOrder'
import OrderConfirmationPage from './OrderConfirmationPage'

const order: Order = {
  order_id: 'order-123',
  status: 'PENDING',
  payment_method: 'COD',
  payment_status: 'PENDING',
  payment_deadline_at: null,
  customer_name: 'Ayesha',
  customer_email: 'a@example.com',
  customer_phone: null,
  delivery_name: 'Ayesha',
  delivery_house_no: '12-B',
  delivery_street_number: null,
  delivery_city: 'Lahore',
  delivery_province: null,
  delivery_postal_code: '54000',
  delivery_country: 'Pakistan',
  items: [
    {
      product_id: 'p1',
      product_name_snapshot: 'Sunflower',
      quantity: 2,
      unit_price_at_purchase_paisa: 125050,
    },
  ],
  subtotal_paisa: 250100,
  delivery_fee_paisa: 20000,
  total_amount_paisa: 270100,
  created_at: '2026-01-01T00:00:00Z',
  cancelled_at: null,
  cancellation_charge_paisa: 0,
  charge_waived: false,
  refund_due_paisa: 0,
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <OrderConfirmationPage />
    </MemoryRouter>,
  )

it('shows the order that was just placed', () => {
  saveLastOrder(order)
  renderPage()
  expect(screen.getByText('Thank you, Ayesha!')).toBeInTheDocument()
  expect(screen.getByText('order-123')).toBeInTheDocument()
  expect(screen.getByText('2 × Sunflower')).toBeInTheDocument()
  expect(screen.getByText('Rs 2,701')).toBeInTheDocument()
  expect(screen.getByText(/cash on delivery/)).toBeInTheDocument()
})

it('handles a missing order gracefully', () => {
  renderPage()
  expect(screen.getByText(/could not find a recent order/)).toBeInTheDocument()
})
