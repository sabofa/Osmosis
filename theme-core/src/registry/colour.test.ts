import { describe, expect, it } from 'vitest'
import { COLOUR_TOKENS } from './colour.js'
import { createResolver, type ModeSeeds } from './resolver.js'
import { parseTokenValue } from './types.js'
import { contrast, parseColour, type Oklch } from '../colour.js'
import { DEFAULT_DIALS, DEFAULT_FONTS, DEFAULT_SEEDS, type Mode } from '../manifest.js'

function seedsFor(mode: Mode, extra: Partial<ModeSeeds> = {}): ModeSeeds {
  const s = DEFAULT_SEEDS[mode]
  return {
    canvas: parseColour(s.canvas), surface: parseColour(s.surface),
    ink: parseColour(s.ink), accent: parseColour(s.accent), ...extra,
  }
}
function make(mode: Mode, extra: Partial<ModeSeeds> = {}, overrides?: Record<string, string>) {
  return createResolver({
    mode, defs: COLOUR_TOKENS, seeds: seedsFor(mode, extra),
    dials: DEFAULT_DIALS, fonts: DEFAULT_FONTS, overrides,
  })
}
const modes: Mode[] = ['light', 'dark']
const hueDiff = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180)

function lab(c: Oklch): [number, number, number] {
  const r = (c.h * Math.PI) / 180
  return [c.l, c.c * Math.cos(r), c.c * Math.sin(r)]
}

describe('colour tokens', () => {
  for (const mode of modes) {
    describe(mode, () => {
      const r = make(mode)
      const col = (n: string): Oklch => parseColour(r.get(n))

      it('every token resolves to a valid colour with a meaning', () => {
        for (const t of COLOUR_TOKENS) {
          expect(t.group).toBe('colour')
          expect(t.type).toBe('color')
          expect(t.modeDependent).toBe(true)
          expect(t.meaning.length).toBeGreaterThan(10)
          expect(parseTokenValue('color', r.get(t.name)), t.name).toBe(true)
        }
        expect(new Set(COLOUR_TOKENS.map((t) => t.name)).size).toBe(COLOUR_TOKENS.length)
      })

      it('text contrast', () => {
        expect(contrast(col('color-text'), col('color-surface'))).toBeGreaterThanOrEqual(7)
        expect(contrast(col('color-text-muted'), col('color-surface'))).toBeGreaterThanOrEqual(3)
      })

      it('series are legible and distinct', () => {
        const s = Array.from({ length: 8 }, (_, i) => col(`color-series-${i + 1}`))
        for (const c of s) expect(contrast(c, col('color-surface'))).toBeGreaterThanOrEqual(3 - 0.01)
        let min = Infinity
        for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
          const a = lab(s[i]!), b = lab(s[j]!)
          min = Math.min(min, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]))
        }
        expect(min).toBeGreaterThan(0.05)
      })

      it('accent hover moves in the right direction', () => {
        const a = col('color-accent'), h = col('color-accent-hover')
        if (mode === 'light') expect(h.l).toBeLessThan(a.l)
        else expect(h.l).toBeGreaterThan(a.l)
      })

      it('focus ring is visible on canvas', () => {
        expect(contrast(col('color-focus'), col('color-canvas'))).toBeGreaterThanOrEqual(3 - 0.01)
      })

      it('status and syntax text are readable on surface', () => {
        for (const n of ['good', 'bad', 'warn', 'info', 'accent', 'secondary']) {
          expect(contrast(col(`color-${n}-text`), col('color-surface')), n).toBeGreaterThanOrEqual(4.5 - 0.01)
        }
        for (const n of ['keyword', 'string', 'number', 'function', 'type']) {
          expect(contrast(col(`color-syntax-${n}`), col('color-surface')), n).toBeGreaterThanOrEqual(4.5 - 0.01)
        }
      })

      it('alpha tokens carry alpha', () => {
        for (const n of ['color-scrim', 'color-selection', 'color-shadow']) {
          expect(r.get(n)).toMatch(/^#[0-9a-f]{8}$/)
        }
      })
    })
  }

  it('series-1 has the accent hue when unseeded', () => {
    const r = make('light')
    const a = parseColour(r.get('color-accent'))
    expect(hueDiff(parseColour(r.get('color-series-1')).h, a.h)).toBeLessThan(6)
  })

  it('series seeds are honoured', () => {
    const r = make('light', { series: [parseColour('#00aa00')] })
    expect(r.get('color-series-1')).toBe('#00aa00')
  })

  it('override of color-surface flows to dependents', () => {
    const base = make('light')
    const r = make('light', {}, { 'color-surface': '#ff00aa' })
    expect(r.get('color-surface')).toBe('#ff00aa')
    expect(r.get('color-surface-raised')).not.toBe(base.get('color-surface-raised'))
    expect(r.get('color-text-muted')).not.toBe(base.get('color-text-muted'))
    expect(r.overridden.has('color-surface')).toBe(true)
  })

  it('secondary seed is honoured', () => {
    const r = make('light', { secondary: parseColour('#2244cc') })
    expect(r.get('color-secondary')).toBe('#2244cc')
  })

  it('unseeded secondary is accent hue + 40 degrees', () => {
    const r = make('light')
    const d = hueDiff(parseColour(r.get('color-secondary')).h, parseColour(r.get('color-accent')).h)
    expect(Math.abs(d - 40)).toBeLessThan(6)
  })

  it('status seeds are honoured', () => {
    const r = make('dark', { good: parseColour('#33aa55') })
    expect(r.get('color-good')).toBe('#33aa55')
  })

  it('works without a surface seed', () => {
    const r = createResolver({
      mode: 'light', defs: COLOUR_TOKENS,
      seeds: { canvas: parseColour('#eef1e5'), ink: parseColour('#17170f'), accent: parseColour('#c65d22') },
      dials: DEFAULT_DIALS, fonts: DEFAULT_FONTS,
    })
    expect(parseTokenValue('color', r.get('color-surface'))).toBe(true)
  })
})
