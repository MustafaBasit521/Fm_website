import { expect, it } from 'vitest'
import { formatPrice } from './money'

it('formats paisa as rupees without floating point', () => {
  expect(formatPrice(0)).toBe('Rs 0')
  expect(formatPrice(125050)).toBe('Rs 1,250.50')
  expect(formatPrice(125000)).toBe('Rs 1,250')
  expect(formatPrice(5)).toBe('Rs 0.05')
  expect(formatPrice(100000000)).toBe('Rs 1,000,000')
})
