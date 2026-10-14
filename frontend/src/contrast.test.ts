import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

// Reads the real colour tokens, so changing a colour re-checks the contrast automatically.
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
const color = (name: string): string => {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)
  if (!m) throw new Error(`token --color-${name} not found`)
  return m[1]
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// [text colour, background, where it is used]. WCAG AA needs 4.5:1 for normal text.
const WHITE = '#ffffff'
const PAIRS: [string, string, string][] = [
  ['ink', 'cream', 'body text'],
  ['ink', 'cream-100', 'text on cards'],
  ['bark', 'cream', 'form labels'],
  ['bark', 'cream-100', 'admin menu'],
  ['muted', 'cream', 'secondary text'],
  ['muted', 'cream-100', 'secondary text on panels'],
  ['bark', 'cream-200', 'placeholder tiles ("No image")'],
  ['terracotta', 'cream', 'links'],
  ['terracotta', 'cream-100', 'links on panels'],
  ['danger', 'cream', 'errors'],
  ['danger', 'cream-100', 'errors on panels'],
  ['moss-dark', 'cream', 'in-stock labels'],
]
const ON_WHITE: [string, string][] = [
  ['ink', 'text on white cards'],
  ['muted', 'secondary text on cards'],
  ['terracotta', 'links on cards'],
  ['danger', 'errors on cards'],
  ['moss-dark', 'in-stock label on cards'],
  ['bark', 'labels on cards'],
]

it.each(PAIRS)('%s on %s has AA contrast (%s)', (fg, bg) => {
  expect(ratio(color(fg), color(bg))).toBeGreaterThanOrEqual(4.5)
})
it.each(ON_WHITE)('%s on white has AA contrast (%s)', (fg) => {
  expect(ratio(color(fg), WHITE)).toBeGreaterThanOrEqual(4.5)
})
it('white text on the terracotta buttons has AA contrast', () => {
  expect(ratio(WHITE, color('terracotta'))).toBeGreaterThanOrEqual(4.5)
})
it('the contrast calculator itself is right (black/white = 21, same colour = 1)', () => {
  expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 0)
  expect(ratio('#777777', '#777777')).toBeCloseTo(1, 5)
})
