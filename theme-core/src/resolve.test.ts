import { describe, it, expect } from 'vitest'
import { normalise, DEFAULT_SEEDS } from './manifest.js'
import { parseColour } from './colour.js'
import { TOKENS, ResolveError } from './registry/index.js'
import { resolve, resolveMode, mirrorSeed } from './resolve.js'

const empty = normalise({ id: 't', name: 'T' })
const hueDiff = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d) }

describe('resolve', () => {
  it('resolves every token in both modes, deterministically', () => {
    const a = resolve(empty), b = resolve(empty)
    for (const t of TOKENS) {
      for (const mode of ['light', 'dark'] as const) {
        const v = a[mode][t.name]
        expect(typeof v).toBe('string')
        expect(v!.length).toBeGreaterThan(0)
      }
    }
    expect(a).toEqual(b)
    expect(a.key).toBe(b.key)
    expect(a.key).toMatch(/^[0-9a-f]{8}$/)
  })

  it('override replaces exactly what it names; dependents follow', () => {
    const base = resolve(empty)
    const r = resolve(normalise({ id: 't', name: 'T', overrides: { any: { 'color-surface': '#ff00aa' } } }))
    expect(r.light['color-surface']).toBe('#ff00aa')
    expect(r.light['graph-paper']).toBe('#ff00aa')
    expect(r.light['color-canvas']).toBe(base.light['color-canvas'])
  })

  it('mode-specific override beats any', () => {
    const r = resolve(normalise({ id: 't', name: 'T', overrides: { any: { 'color-accent': '#112233' }, dark: { 'color-accent': '#445566' } } }))
    expect(r.light['color-accent']).toBe('#112233')
    expect(r.dark['color-accent']).toBe('#445566')
  })

  it('light-only seeds derive dark', () => {
    const r = resolve(normalise({ id: 't', name: 'T', seeds: { light: { canvas: '#f4efe6', ink: '#201a14', accent: '#b3411f' } } }))
    const lc = parseColour('#f4efe6')
    const dc = parseColour(r.dark['color-canvas']!)
    expect(dc.l).toBeLessThan(0.3)
    expect(hueDiff(dc.h, lc.h)).toBeLessThan(8)
    expect(parseColour(r.dark['color-text']!).l).toBeGreaterThan(0.7)
    expect(parseColour(r.dark['color-accent']!).l).toBeGreaterThan(parseColour(r.light['color-accent']!).l)
  })

  it('surface derives from canvas when only canvas seeded; defaults otherwise', () => {
    const r = resolve(normalise({ id: 't', name: 'T', seeds: { light: { canvas: '#e6dfcf' } } }))
    expect(r.light['color-surface']).not.toBe(DEFAULT_SEEDS.light.surface)
    const e = resolve(empty)
    expect(e.light['color-surface']).toBe('#ffffff')
    expect(e.dark['color-surface']).toBe('#201e15')
  })

  it('provenance', () => {
    const r = resolve(normalise({ id: 't', name: 'T', dials: { roundness: 0.9 }, seeds: { light: { canvas: '#f4efe6' } }, overrides: { any: { 'color-accent': '#112233' } } }))
    expect(r.provenance.light['color-accent']).toMatchObject({ source: 'override', from: 'any' })
    expect(r.provenance.light['color-canvas']).toMatchObject({ source: 'seed', from: 'canvas' })
    expect(r.provenance.light['color-border']!.source).toBe('default')
    expect(r.provenance.light['radius-md']!.source).toBe('dial')
    const e = resolve(empty)
    expect(e.provenance.light['radius-md']!.source).toBe('default')
    expect(e.provenance.light['color-canvas']!.source).toBe('default')
    const o = resolve(normalise({ id: 't', name: 'T', overrides: { dark: { 'color-accent': '#112233' } } }))
    expect(o.provenance.dark['color-accent']!.from).toBe('dark')
  })

  it('key changes with accent, not with name', () => {
    const a = resolve(empty).key
    const b = resolve(normalise({ id: 't', name: 'Other' })).key
    const c = resolve(normalise({ id: 't', name: 'T', seeds: { light: { accent: '#3366cc' } } })).key
    expect(a).toBe(b)
    expect(c).not.toBe(a)
  })

  it('bad overrides throw ResolveError', () => {
    expect(() => resolve(normalise({ id: 't', name: 'T', overrides: { any: { 'color-accent': 'nope' } } }))).toThrow(ResolveError)
    expect(() => resolve(normalise({ id: 't', name: 'T', overrides: { any: { 'no-such-token': '#fff' } } }))).toThrow(ResolveError)
  })

  it('resolveMode matches resolve', () => {
    expect(resolveMode(empty, 'dark').tokens).toEqual(resolve(empty).dark)
  })
})

describe('mirrorSeed', () => {
  it('inverts canvas lightness', () => {
    expect(mirrorSeed('canvas', parseColour('#eef1e5'), 'dark').l).toBeLessThan(0.3)
  })
  it('accent to dark gets +0.08 L', () => {
    const c = parseColour('#b3411f')
    expect(mirrorSeed('accent', c, 'dark').l).toBeCloseTo(c.l + 0.08, 5)
    expect(mirrorSeed('accent', c, 'light').l).toBeCloseTo(c.l - 0.08, 5)
  })
})
