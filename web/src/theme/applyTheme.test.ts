import { describe, it, expect } from 'vitest'
import { builtinById, parseColour } from 'theme-core'
import { buildThemeSheet } from './applyTheme'

const osmosis = builtinById('builtin:osmosis')!
const forest = builtinById('builtin:forest')!

function bgOf(css: string): string {
  const m = /--bg:\s*([^;}\s]+)/.exec(css)
  if (!m) throw new Error('no --bg in sheet')
  return m[1]
}

describe('buildThemeSheet', () => {
  it('emits the light palette', () => {
    const { css, mode } = buildThemeSheet({ manifest: osmosis, mode: 'light', blend: 0 })
    expect(mode).toBe('light')
    expect(css).toContain('--bg:#eef1e5')
    expect(css).toContain('--accent:#c65d22')
    expect(css).toContain('color-scheme:light')
  })

  it('emits the dark palette', () => {
    const { css } = buildThemeSheet({ manifest: osmosis, mode: 'dark', blend: 1 })
    expect(css).toContain('--bg:#17160f')
    expect(css).toContain('color-scheme:dark')
  })

  it('blends between the two at 0.5', () => {
    const l = parseColour(bgOf(buildThemeSheet({ manifest: osmosis, mode: 'light', blend: 0 }).css)).l
    const d = parseColour(bgOf(buildThemeSheet({ manifest: osmosis, mode: 'dark', blend: 1 }).css)).l
    const m = parseColour(bgOf(buildThemeSheet({ manifest: osmosis, mode: 'dark', blend: 0.5 }).css)).l
    expect(m).toBeLessThan(l)
    expect(m).toBeGreaterThan(d)
  })

  it('appends the manifest css', () => {
    const { css } = buildThemeSheet({ manifest: forest, mode: 'light', blend: 0 })
    expect(css).toContain('.panel')
    expect(css.trimEnd().endsWith(forest.css!.trimEnd())).toBe(true)
  })

  it('is deterministic with a stable key', () => {
    const a = buildThemeSheet({ manifest: forest, mode: 'dark', blend: 1 })
    const b = buildThemeSheet({ manifest: forest, mode: 'dark', blend: 1 })
    expect(b).toEqual(a)
    const c = buildThemeSheet({ manifest: forest, mode: 'light', blend: 0 })
    expect(c.key).not.toBe(a.key)
    expect(a.key.endsWith(':dark:1.000')).toBe(true)
  })
})
