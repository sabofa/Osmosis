import { describe, expect, it } from 'vitest'
import { COMPONENT_TOKENS } from './component.js'
import { TOKENS } from './index.js'
import { createResolver } from './resolver.js'
import { parseTokenValue } from './types.js'
import { parseColour } from '../colour.js'
import { DEFAULT_DIALS, DEFAULT_FONTS, DEFAULT_SEEDS, type Mode } from '../manifest.js'

function make(mode: Mode = 'light', overrides: Record<string, string> = {}) {
  const s = DEFAULT_SEEDS[mode]
  return createResolver({
    mode, defs: TOKENS, dials: DEFAULT_DIALS, fonts: DEFAULT_FONTS, overrides,
    seeds: { canvas: parseColour(s.canvas), surface: parseColour(s.surface), ink: parseColour(s.ink), accent: parseColour(s.accent) },
  })
}

describe('component tokens', () => {
  it('resolve and validate in both modes', () => {
    for (const mode of ['light', 'dark'] as Mode[]) {
      const r = make(mode)
      for (const t of COMPONENT_TOKENS) {
        expect(parseTokenValue(t.type, r.get(t.name)), `${mode} ${t.name}`).toBe(true)
      }
    }
  })
  it('surface override flows through', () => {
    const r = make('light', { 'color-surface': '#ff00aa' })
    for (const n of ['panel-bg', 'input-bg', 'sidebar-bg', 'button-secondary-bg']) expect(r.get(n)).toBe('#ff00aa')
  })
  it('component override is local', () => {
    const base = make().get('card-bg')
    expect(make('light', { 'panel-bg': '#123456' }).get('card-bg')).toBe(base)
  })
  it('radius-md flows through', () => {
    const r = make('light', { 'radius-md': '3px' })
    for (const n of ['input-radius', 'button-radius', 'menu-radius']) expect(r.get(n)).toBe('3px')
  })
  it('names unique, kebab, tier component', () => {
    const names = COMPONENT_TOKENS.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    for (const t of COMPONENT_TOKENS) {
      expect(t.name).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
      expect(t.tier).toBe('component')
      expect(t.group).toBe('component')
      expect(t.meaning.length).toBeGreaterThan(10)
    }
  })
  it('sidebar-row-hover differs from surface', () => {
    for (const mode of ['light', 'dark'] as Mode[]) {
      const r = make(mode)
      expect(r.get('sidebar-row-hover')).not.toBe(r.get('color-surface'))
    }
  })
})
