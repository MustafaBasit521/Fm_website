import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The deployment security headers are configuration, not code, so nothing else would notice if a
// later edit weakened them. These tests lock in the rules that matter.
type Header = { key: string; value: string }
const load = (site: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), `../deploy/${site}/vercel.json`), 'utf8')) as {
    outputDirectory: string
    buildCommand: string
    rewrites: { source: string; destination: string }[]
    headers: { source: string; headers: Header[] }[]
  }
const headersOf = (site: string) =>
  Object.fromEntries(load(site).headers[0].headers.map((h) => [h.key, h.value]))

describe.each(['shop', 'admin'])('%s deployment headers', (site) => {
  const h = headersOf(site)
  const csp = h['Content-Security-Policy']

  it('has a content security policy that blocks injected scripts and framing', () => {
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toMatch(/script-src[^;]*('unsafe-inline'|'unsafe-eval'|\*)/)
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
  })
  it('only allows network calls to itself, the API and Supabase', () => {
    const connect = /connect-src ([^;]*)/.exec(csp)![1].split(' ')
    expect(connect).toEqual(["'self'", 'https://API_DOMAIN', 'https://*.supabase.co'])
  })
  it('sets the standard protective headers', () => {
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['X-Frame-Options']).toBe('DENY')
    expect(h['Strict-Transport-Security']).toMatch(/max-age=\d{7,}/)
    expect(h['Permissions-Policy']).toContain('camera=()')
  })
  it('builds only its own site and serves it as a single-page app', () => {
    const c = load(site)
    expect(c.buildCommand).toContain(`build:${site}`)
    expect(c.buildCommand).not.toContain(site === 'shop' ? 'build:admin' : 'build:shop')
    expect(c.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }])
  })
})

it('the admin site is additionally kept out of search engines and sends no referrer', () => {
  const h = headersOf('admin')
  expect(h['X-Robots-Tag']).toBe('noindex, nofollow')
  expect(h['Referrer-Policy']).toBe('no-referrer')
  expect(headersOf('shop')['X-Robots-Tag']).toBeUndefined()
})
