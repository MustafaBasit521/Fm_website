import { expect, it } from 'vitest'
import { isWalletMethod, methodName, paymentSummary } from './paymentText'

it('names only the payment methods the shop really offers', () => {
  expect(paymentSummary(['COD'])).toBe('Cash on Delivery')
  expect(paymentSummary(['COD', 'EASYPAISA'])).toBe('Cash on Delivery or Easypaisa')
  expect(paymentSummary(['COD', 'EASYPAISA', 'JAZZCASH'])).toBe(
    'Cash on Delivery, Easypaisa or JazzCash',
  )
  expect(paymentSummary(['COD', 'ONLINE'])).toBe('Cash on Delivery or online payment')
  expect(paymentSummary([])).toBe('Cash on Delivery')
})

it('knows which methods are wallets', () => {
  expect(isWalletMethod('EASYPAISA')).toBe(true)
  expect(isWalletMethod('JAZZCASH')).toBe(true)
  expect(isWalletMethod('COD')).toBe(false)
  expect(isWalletMethod('ONLINE')).toBe(false)
  expect(methodName('JAZZCASH')).toBe('JazzCash')
  expect(methodName('COD')).toBe('Cash on delivery')
})
