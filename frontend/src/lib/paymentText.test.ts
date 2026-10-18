import { expect, it } from 'vitest'
import { paymentSummary } from './paymentText'

it('names only the payment methods the shop really offers', () => {
  expect(paymentSummary(['COD'])).toBe('Cash on Delivery')
  expect(paymentSummary(['COD', 'TRANSFER'])).toBe('Cash on Delivery or bank or wallet transfer')
  expect(paymentSummary(['COD', 'ONLINE'])).toBe('Cash on Delivery or online payment')
  expect(paymentSummary([])).toBe('Cash on Delivery')
})
