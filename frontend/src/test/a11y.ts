import axe from 'axe-core'
import { expect } from 'vitest'

/** Fails the test with a readable list if axe finds accessibility violations in `container`.
 *  Colour contrast cannot be computed in jsdom, so it is checked separately (see contrast.test). */
export async function expectNoA11yViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  })
  const report = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n   ${v.nodes.map((n) => n.html.slice(0, 120)).join('\n   ')}`,
  )
  expect(report, report.join('\n')).toEqual([])
}
