import { describe, expect, it } from 'vitest'
import { COLOUR_TOKENS } from './colour.js'
import { MATERIAL_TOKENS } from './material.js'
import { createResolver, ResolveError } from './resolver.js'
import { TOKENS, isValidTokenValue, tokenByName } from './index.js'
import { parseColour } from '../colour.js'
import { DEFAULT_DIALS, DEFAULT_FONTS, DEFAULT_SEEDS, type Mode } from '../manifest.js'

function make(mode: Mode = 'light', overrides?: Record<string, string>) {
  const s = DEFAULT_SEEDS[mode]
  return createResolver({
    mode, defs: [...COLOUR_TOKENS, ...MATERIAL_TOKENS], dials: DEFAULT_DIALS, fonts: DEFAULT_FONTS, overrides,
    seeds: { canvas: parseColour(s.canvas), surface: parseColour(s.surface), ink: parseColour(s.ink), accent: parseColour(s.accent) },
  })
}

describe('material tokens', () => {
  it('defaults', () => {
    const r = make()
    expect(r.get('elevation-mode')).toBe('shadow')
    expect(r.get('corner-shape')).toBe('round')
    expect(r.get('motion-style')).toBe('smooth')
    expect(r.get('bevel-depth')).toBe('2px')
  })
  it('registered with groups', () => {
    for (const n of ['elevation-mode', 'bevel-light', 'bevel-dark', 'bevel-depth']) expect(tokenByName.get(n)!.group).toBe('elevation')
    expect(tokenByName.get('corner-shape')!.group).toBe('shape')
    expect(tokenByName.get('motion-style')!.group).toBe('motion')
    for (const t of MATERIAL_TOKENS) { expect(TOKENS).toContain(t); expect(t.tier).toBe('semantic') }
  })
  it('bevel-light is lighter than bevel-dark in both modes', () => {
    for (const mode of ['light', 'dark'] as const) {
      const r = make(mode)
      expect(parseColour(r.get('bevel-light')).l, mode).toBeGreaterThan(parseColour(r.get('bevel-dark')).l)
    }
  })
  it('enum overrides', () => {
    expect(make('light', { 'elevation-mode': 'hairline' }).get('elevation-mode')).toBe('hairline')
    expect(() => make('light', { 'elevation-mode': 'neon' })).toThrow(ResolveError)
    expect(make('light', { 'corner-shape': 'squircle' }).get('corner-shape')).toBe('squircle')
    expect(make('light', { 'motion-style': 'wiggle' }).get('motion-style')).toBe('wiggle')
    expect(() => make('light', { 'motion-style': 'sproing' })).toThrow(ResolveError)
  })
  it('isValidTokenValue', () => {
    const t = (n: string) => tokenByName.get(n)!
    const rows: Array<[string, string, boolean]> = [
      ['elevation-mode', 'bevel', true], ['elevation-mode', 'neon', false], ['elevation-mode', '', false],
      ['corner-shape', 'notch', true], ['corner-shape', 'Round', false],
      ['bevel-depth', '3px', true], ['bevel-depth', 'thick', false],
      ['bevel-light', '#fff', true], ['bevel-light', 'nope', false],
      ['font-body', 'Georgia, serif', true],
    ]
    for (const [n, v, ok] of rows) expect(isValidTokenValue(t(n), v), `${n} ${v}`).toBe(ok)
  })
})
