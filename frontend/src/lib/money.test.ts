import { expect, it } from 'vitest'
import { formatPrice, paisaToRupeesInput, parseRupeesToPaisa } from './money'

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

it('turns paisa into editable rupee text and back without loss', () => {
  expect(paisaToRupeesInput(125050)).toBe('1250.50')
  expect(paisaToRupeesInput(125000)).toBe('1250')
  expect(paisaToRupeesInput(5)).toBe('0.05')
  for (const paisa of [0, 5, 99, 100, 101, 125050, 99999999]) {
    expect(parseRupeesToPaisa(paisaToRupeesInput(paisa))).toBe(paisa)
  }
})
