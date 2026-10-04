import { expect, it } from 'vitest'
import { formatPrice, parseRupeesToPaisa } from './money'

it('formats paisa as rupees without floating point', () => {
  expect(formatPrice(0)).toBe('Rs 0')
  expect(formatPrice(125050)).toBe('Rs 1,250.50')
  expect(formatPrice(125000)).toBe('Rs 1,250')
  expect(formatPrice(5)).toBe('Rs 0.05')
  expect(formatPrice(100000000)).toBe('Rs 1,000,000')
})

it('parses rupees to paisa without floating point', () => {
  expect(parseRupeesToPaisa('1250.50')).toBe(125050)
  expect(parseRupeesToPaisa('1250.5')).toBe(125050)
  expect(parseRupeesToPaisa('1250')).toBe(125000)
  expect(parseRupeesToPaisa(' 0.05 ')).toBe(5)
  for (const bad of ['', 'abc', '-1', '1.234', '1,000', '1e3', '.5'])
    expect(parseRupeesToPaisa(bad)).toBeNull()
})
