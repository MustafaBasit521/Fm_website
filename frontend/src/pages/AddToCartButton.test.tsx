import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { makeAuth } from '../test/auth'
import { AddToCartButton } from './AddToCartButton'
import { CartLink } from './CartLink'

it('adds to the cart (persisted) and updates the cart link count', async () => {
  const { wrap } = makeAuth()
  render(
    wrap(
      <>
        <CartLink />
        <AddToCartButton productId="p1" productName="Sunflower" />
      </>,
    ),
  )
  expect(screen.getByRole('link', { name: 'Cart' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
  await userEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
  expect(screen.getByRole('link', { name: 'Cart (2)' })).toBeInTheDocument()
  expect(JSON.parse(window.localStorage.getItem('crochet-cart-v1')!)).toEqual([
    { product_id: 'p1', quantity: 2 },
  ])
})

it('cannot be used for unavailable products', () => {
  const { wrap } = makeAuth()
  render(wrap(<AddToCartButton productId="p1" productName="Sunflower" disabled />))
  expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled()
})
