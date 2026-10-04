import { beforeEach, expect, it } from 'vitest'
import {
  addItem,
  loadCart,
  MAX_LINE_QUANTITY,
  MAX_LINES,
  removeItem,
  sanitize,
  saveCart,
  setQuantity,
  totalUnits,
} from './cart'

beforeEach(() => window.localStorage.clear())

it('adds, merges, updates and removes lines', () => {
  let c = addItem([], 'a')
  c = addItem(c, 'a', 2)
  c = addItem(c, 'b')
  expect(c).toEqual([
    { product_id: 'a', quantity: 3 },
    { product_id: 'b', quantity: 1 },
  ])
  expect(totalUnits(c)).toBe(4)
  expect(setQuantity(c, 'a', 7)[0].quantity).toBe(7)
  expect(setQuantity(c, 'a', 0)).toEqual([{ product_id: 'b', quantity: 1 }])
  expect(removeItem(c, 'b')).toEqual([{ product_id: 'a', quantity: 3 }])
})

it('caps quantity and the number of lines', () => {
  expect(addItem([{ product_id: 'a', quantity: 98 }], 'a', 5)[0].quantity).toBe(MAX_LINE_QUANTITY)
  expect(setQuantity([{ product_id: 'a', quantity: 1 }], 'a', 1000)[0].quantity).toBe(
    MAX_LINE_QUANTITY,
  )
  const many = Array.from({ length: MAX_LINES }, (_, i) => ({ product_id: `p${i}`, quantity: 1 }))
  expect(addItem(many, 'extra')).toHaveLength(MAX_LINES)
})

it('sanitizes whatever is in storage', () => {
  expect(sanitize('nope')).toEqual([])
  expect(
    sanitize([
      { product_id: 'a', quantity: 2 },
      { product_id: 'a', quantity: 3 },
      { product_id: 5, quantity: 1 },
      { product_id: 'b', quantity: 'x' },
      { product_id: 'c', quantity: -4 },
      { product_id: 'd', quantity: 1e9 },
      null,
      { product_id: 'e', quantity: NaN },
    ]),
  ).toEqual([
    { product_id: 'a', quantity: 5 },
    { product_id: 'd', quantity: MAX_LINE_QUANTITY },
  ])
})

it('persists to localStorage and survives corrupt data', () => {
  saveCart([{ product_id: 'a', quantity: 2 }])
  expect(loadCart()).toEqual([{ product_id: 'a', quantity: 2 }])
  window.localStorage.setItem('crochet-cart-v1', '{not json')
  expect(loadCart()).toEqual([])
})
