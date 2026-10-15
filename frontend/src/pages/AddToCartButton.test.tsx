import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { makeAuth } from '../test/auth'
import { AddToCartButton } from './AddToCartButton'

it('adds to the cart and persists it', async () => {
  const { wrap } = makeAuth()
  render(wrap(<AddToCartButton productId="p1" productName="Sunflower" />))
  await userEvent.click(screen.getByRole('button', { name: 'Add to bag' }))
  await userEvent.click(screen.getByRole('button', { name: 'Add to bag' }))
  expect(JSON.parse(window.localStorage.getItem('crochet-cart-v1')!)).toEqual([
    { product_id: 'p1', quantity: 2 },
  ])
})

it('cannot be used for unavailable products', () => {
  const { wrap } = makeAuth()
  render(wrap(<AddToCartButton productId="p1" productName="Sunflower" disabled />))
  expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled()
})
