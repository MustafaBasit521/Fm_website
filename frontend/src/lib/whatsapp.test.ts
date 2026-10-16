import { expect, it } from 'vitest'
import { waDigits, waLink } from './whatsapp'

it.each([
  ['+92 300 1234567', '923001234567'],
  ['0300 1234567', '923001234567'], // local format gets the country code
  ['0092 300 1234567', '923001234567'],
  ['92-300-1234567', '923001234567'],
])('turns %s into wa.me digits', (raw, digits) => {
  expect(waDigits(raw)).toBe(digits)
})

it.each([null, undefined, '', 'call me', '123'])('treats %s as no number', (raw) => {
  expect(waDigits(raw)).toBeNull()
})

it('builds a link with the message already typed, safely encoded', () => {
  expect(waLink('923001234567')).toBe('https://wa.me/923001234567')
  expect(waLink('923001234567', 'Hi & hello\nRs 500')).toBe(
    'https://wa.me/923001234567?text=Hi%20%26%20hello%0ARs%20500',
  )
})
