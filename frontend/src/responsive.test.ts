import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// A row of links or buttons that cannot wrap runs off the edge of a phone screen (the home page
// did exactly that). This scans every component and fails if a `flex` row with a sizeable gap has
// no way to wrap and does not stack as a column.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return path.endsWith('.tsx') && !path.endsWith('.test.tsx') ? [path] : []
  })
}

it('no horizontal flex row with a wide gap is unable to wrap', () => {
  const offenders: string[] = []
  for (const file of files(join(process.cwd(), 'src'))) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const m of line.matchAll(/className=["'`]([^"'`]*)["'`]/g)) {
          const c = m[1].split(/\s+/)
          const row = c.includes('flex') && c.some((x) => /^gap-[3-9]$/.test(x))
          const safe = c.includes('flex-wrap') || c.includes('flex-col') || c.includes('grid')
          if (row && !safe) offenders.push(`${file.replace(process.cwd() + '/', '')}:${i + 1}`)
        }
      })
  }
  expect(offenders).toEqual([])
})
