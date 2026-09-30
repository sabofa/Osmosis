import { describe, expect, it } from 'vitest'

// Rule 2 of the figure-styles design: every random choice comes from
// style/random.ts, seeded by identity. `Math.random` (or the clock) anywhere in
// the style module or the figure renderer would make the same figure draw two
// ways, and nothing downstream could tell — so it is refused by reading the
// source.
const SOURCES = {
  ...import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../figure/**/*.ts', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>

// Comments may name the thing they forbid; code may not.
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('no stray randomness', () => {
  const files = Object.keys(SOURCES).filter((path) => !path.endsWith('.test.ts'))

  it('reads the style module and the figure renderer', () => {
    expect(files.some((f) => f.includes('/style/') || f.startsWith('./'))).toBe(true)
    expect(files.some((f) => f.includes('../figure/render.ts'))).toBe(true)
    expect(files.length).toBeGreaterThan(30)
  })

  for (const path of files) {
    it(`${path} uses no Math.random and no clock`, () => {
      const text = code(SOURCES[path])
      expect(text).not.toMatch(/Math\.random/)
      expect(text).not.toMatch(/\bDate\b/)
      expect(text).not.toMatch(/performance\.now/)
    })
  }
})
