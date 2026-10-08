import { describe, expect, it } from 'vitest'
import { COLOUR_TOKENS } from './colour.js'
import { DOC_TOKENS, FEATURE_KINDS, GRAPH_TOKENS } from './engines.js'
import { createResolver } from './resolver.js'
import { parseTokenValue } from './types.js'
import { parseColour } from '../colour.js'
import { DEFAULT_DIALS, DEFAULT_FONTS, DEFAULT_SEEDS, type Mode } from '../manifest.js'

const ALL = [...GRAPH_TOKENS, ...DOC_TOKENS]
function make(mode: Mode = 'light', overrides?: Record<string, string>) {
  const s = DEFAULT_SEEDS[mode]
  return createResolver({
    mode, defs: [...COLOUR_TOKENS, ...ALL], dials: DEFAULT_DIALS, fonts: DEFAULT_FONTS, overrides,
    seeds: { canvas: parseColour(s.canvas), surface: parseColour(s.surface), ink: parseColour(s.ink), accent: parseColour(s.accent) },
  })
}

describe('graph and document tokens', () => {
  it('has 9 feature markers equal to the series tokens', () => {
    expect(FEATURE_KINDS).toHaveLength(9)
    const r = make()
    FEATURE_KINDS.forEach((k, i) => {
      expect(r.get(`graph-marker-${k}`)).toBe(r.get(`color-series-${(i % 8) + 1}`))
    })
  })
  it('groups and meanings', () => {
    for (const t of GRAPH_TOKENS) expect(t.group).toBe('graph')
    for (const t of DOC_TOKENS) expect(t.group).toBe('document')
    for (const t of ALL) expect(t.meaning.length).toBeGreaterThan(10)
  })
  for (const mode of ['light', 'dark'] as Mode[]) {
    it(`values are valid (${mode})`, () => {
      const r = make(mode)
      for (const t of ALL) expect(parseTokenValue(t.type, r.get(t.name)), t.name).toBe(true)
    })
  }
  it('follows colour overrides', () => {
    expect(make('light', { 'color-surface': '#123456' }).get('graph-paper')).toBe('#123456')
    expect(make('light', { 'color-text': '#654321' }).get('graph-ink')).toBe('#654321')
  })
  it('doc-table-stripe differs from surface', () => {
    const r = make()
    expect(r.get('doc-table-stripe')).not.toBe(r.get('color-surface'))
  })
  it('non-colour tokens', () => {
    const r = make()
    expect(r.get('graph-region-alpha')).toBe('0.18')
    expect(r.get('doc-measure')).toBe('68ch')
  })
})
