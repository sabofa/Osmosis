import { describe, expect, it } from 'vitest'
import { COLOUR_TOKENS } from './colour.js'
import { ELEVATION_TOKENS, MOTION_TOKENS, SHAPE_TOKENS, SPACE_TOKENS, SURFACE_TOKENS, TYPE_TOKENS } from './layout.js'
import { createResolver } from './resolver.js'
import { parseTokenValue } from './types.js'
import { parseColour } from '../colour.js'
import { DEFAULT_DIALS, DEFAULT_FONTS, DEFAULT_SEEDS, FONT_STACKS, type Dials, type FontRef, type FontRole, type Mode } from '../manifest.js'

const LAYOUT = [...TYPE_TOKENS, ...SHAPE_TOKENS, ...SPACE_TOKENS, ...ELEVATION_TOKENS, ...MOTION_TOKENS, ...SURFACE_TOKENS]
const defs = [...COLOUR_TOKENS, ...LAYOUT]

function make(mode: Mode = 'light', dials: Partial<Dials> = {}, fonts: Record<FontRole, FontRef> = DEFAULT_FONTS) {
  const s = DEFAULT_SEEDS[mode]
  return createResolver({
    mode, defs, dials: { ...DEFAULT_DIALS, ...dials }, fonts,
    seeds: { canvas: parseColour(s.canvas), surface: parseColour(s.surface), ink: parseColour(s.ink), accent: parseColour(s.accent) },
  })
}

describe('layout tokens', () => {
  it('defaults', () => {
    const r = make()
    expect(r.get('text-md')).toBe('14px')
    expect(r.get('radius-md')).toBe('12px')
    expect(r.get('space-3')).toBe('12px')
    expect(r.get('motion-normal')).toBe('200ms')
    expect(r.get('surface-alpha')).toBe('1')
    expect(r.get('surface-blur')).toBe('0px')
    expect(r.get('border-width')).toBe('1px')
  })
  it('groups and flags', () => {
    const groups = new Set(['type', 'shape', 'space', 'elevation', 'motion', 'surface'])
    for (const t of LAYOUT) {
      expect(groups.has(t.group)).toBe(true)
      expect(t.meaning.length).toBeGreaterThan(10)
      expect(t.modeDependent).toBe(t.name.startsWith('shadow-'))
    }
  })
  it('roundness', () => {
    expect(make('light', { roundness: 0 }).get('radius-md')).toBe('0px')
    expect(make('light', { roundness: 0 }).get('radius-pill')).toBe('0px')
    expect(make('light', { roundness: 1 }).get('radius-md')).toBe('24px')
    expect(make().get('radius-pill')).toBe('999px')
  })
  it('elevation', () => {
    expect(make('light', { elevation: 0 }).get('shadow-2')).toBe('none')
    const v = make('light', { elevation: 1 }).get('shadow-2')
    expect(v).toContain('px')
    expect(v).toContain('#')
  })
  it('dark and light shadows differ', () => {
    expect(make('dark').get('shadow-1')).not.toBe(make('light').get('shadow-1'))
  })
  it('motion, density, base size, borders, translucency', () => {
    expect(make('light', { motion: 0 }).get('motion-fast')).toBe('0ms')
    expect(make('light', { density: 1 }).get('space-1')).toBe('5.5px')
    expect(make('light', { baseSize: 18 }).get('text-md')).toBe('18px')
    expect(make('light', { borders: 0 }).get('border-width')).toBe('0px')
    expect(make('light', { translucency: 1 }).get('surface-alpha')).toBe('0.5')
  })
  it('asset font falls back to the default stack', () => {
    const r = make('light', {}, { ...DEFAULT_FONTS, body: { asset: 'x' } })
    expect(r.get('font-body')).toBe(FONT_STACKS.inter)
  })
  for (const mode of ['light', 'dark'] as Mode[]) {
    it(`every value is valid (${mode})`, () => {
      const r = make(mode)
      for (const t of LAYOUT) expect(parseTokenValue(t.type, r.get(t.name)), t.name).toBe(true)
    })
  }
})
