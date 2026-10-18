import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { STATUS_COLORS } from './pages/statusColors'

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

// Every text colour on every surface it can appear on. WCAG AA needs 4.5:1 for normal text.
//   cream-100 = the page, paper = cards/inputs/panels, cream-200 = footer and placeholder tiles.
const SURFACES = ['cream-100', 'paper', 'cream-200']
const TEXT = ['ink', 'bark', 'terracotta', 'danger', 'moss-dark']
const WHITE = '#ffffff'

const MATRIX = SURFACES.flatMap((bg) => TEXT.map((fg) => [fg, bg] as const))
it.each(MATRIX)('%s text on %s has AA contrast', (fg, bg) => {
  expect(ratio(color(fg), color(bg))).toBeGreaterThanOrEqual(4.5)
})

// "muted" (secondary text, placeholders) is only allowed on the lighter surfaces: on the footer
// colour it falls below AA (4.28:1), so secondary text there must use "bark" instead.
it.each(['cream-100', 'paper'])('muted text on %s has AA contrast', (bg) => {
  expect(ratio(color('muted'), color(bg))).toBeGreaterThanOrEqual(4.5)
})
it('white and cream text on the buttons have AA contrast', () => {
  expect(ratio(WHITE, color('terracotta'))).toBeGreaterThanOrEqual(4.5) // accent pill
  expect(ratio(WHITE, color('accent-hover'))).toBeGreaterThanOrEqual(4.5) // its hover
  expect(ratio(color('paper'), color('ink'))).toBeGreaterThanOrEqual(4.5) // dark pill, header bar
})
it('the dashed focus ring (bark) is clearly visible against every surface', () => {
  for (const bg of SURFACES) expect(ratio(color('bark'), color(bg))).toBeGreaterThanOrEqual(3)
})
it('the contrast calculator itself is right (black/white = 21, same colour = 1)', () => {
  expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 0)
  expect(ratio('#777777', '#777777')).toBeCloseTo(1, 5)
})

it.each(Object.entries(STATUS_COLORS))(
  'the %s status badge text has AA contrast on its background',
  (_status, c) => {
    expect(ratio(c.fg, c.bg)).toBeGreaterThanOrEqual(4.5)
  },
)

// The dark footer (ink) is a surface of its own: its text colours are checked here. The terracotta
// accent is too dark on it (2.65:1, found by axe in a real browser), so the footer uses a lighter one.
it.each([
  ['paper', 4.5],
  ['linen', 4.5],
  ['accent-light', 4.5],
])('%s text on the dark footer has AA contrast', (fg, min) => {
  expect(ratio(color(fg), color('ink'))).toBeGreaterThanOrEqual(min)
})
it('the old terracotta accent would NOT have passed on the dark footer (why accent-light exists)', () => {
  expect(ratio(color('terracotta'), color('ink'))).toBeLessThan(3)
})
