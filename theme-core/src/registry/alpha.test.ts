import { describe, expect, it } from 'vitest'
import { ALPHA_TOKENS } from './alpha.js'
import { TOKENS, tokenByName, ResolveError } from './index.js'
import { LAYER_TOKENS } from '../layerTokens.js'
import { builtinById } from '../builtins/index.js'
import { normalise } from '../manifest.js'
import { resolve } from '../resolve.js'
import { compose, ownerOf } from '../layers.js'

const SIX = ['doc-sheet-alpha', 'doc-surface-alpha', 'doc-media-alpha', 'graph-paper-alpha', 'graph-grid-alpha', 'callout-alpha']
const mk = (dials: Record<string, number> = {}, any: Record<string, string> = {}) =>
  resolve(normalise({ id: 't', name: 'T', dials, overrides: { any } }))

describe('alpha tokens', () => {
  it('are registered once, as number tokens with the floors from LAYER_TOKENS', () => {
    expect(ALPHA_TOKENS.map((t) => t.name)).toEqual(SIX)
    for (const n of [...SIX, 'graph-region-alpha']) {
      const t = tokenByName.get(n)!
      const l = LAYER_TOKENS.find((x) => x.token === n)!
      expect(t.type).toBe('number')
      expect(t.modeDependent).toBe(false)
      expect(t.min).toBe(l.floor)
      expect(t.max).toBe(1)
    }
    expect(new Set(TOKENS.map((t) => t.name)).size).toBe(TOKENS.length)
  })
  it('resolve to table defaults at dial 0, floors at dial 1 (region stays), midpoint at 0.5', () => {
    for (const mode of ['light', 'dark'] as const) {
      const d0 = mk()[mode]
      expect(SIX.map((n) => d0[n])).toEqual(['1', '0.9', '0.95', '1', '1', '0.92'])
      expect(d0['graph-region-alpha']).toBe('0.18')
      const d1 = mk({ translucency: 1 })[mode]
      expect(SIX.map((n) => d1[n])).toEqual(['0.55', '0.6', '0.7', '0.25', '0.15', '0.7'])
      expect(d1['graph-region-alpha']).toBe('0.18')
      expect(mk({ translucency: 0.5 })[mode]['doc-sheet-alpha']).toBe('0.775')
    }
  })
  it('clamps overrides into range without throwing; non-numbers still throw', () => {
    const r = mk({}, { 'callout-alpha': '0.1', 'graph-grid-alpha': '4', 'doc-surface-alpha': '0.8', 'graph-region-alpha': '0.01' }).light
    expect(r['callout-alpha']).toBe('0.7')
    expect(r['graph-grid-alpha']).toBe('1')
    expect(r['doc-surface-alpha']).toBe('0.8')
    expect(r['graph-region-alpha']).toBe('0.05')
    expect(() => mk({}, { 'callout-alpha': 'abc' })).toThrow(ResolveError)
  })
  it('ownership and compose', () => {
    expect(ownerOf('doc-sheet-alpha')).toBe('shared')
    for (const n of ['doc-surface-alpha', 'graph-paper-alpha', 'graph-grid-alpha', 'graph-region-alpha', 'callout-alpha', 'doc-media-alpha']) {
      expect(ownerOf(n), n).toBe('ambience')
    }
    const ws = normalise({ id: 'w', name: 'W', layer: 'workspace', overrides: { any: { 'doc-sheet-alpha': '0.8', 'doc-surface-alpha': '0.8' } } })
    const amb = normalise({ id: 'a', name: 'A', layer: 'ambience', dials: { translucency: 1 } })
    const r = compose({ workspace: ws, ambience: amb })
    expect(r.manifest.overrides?.any?.['doc-sheet-alpha']).toBe('0.8')
    expect(resolve(r.manifest).light['doc-sheet-alpha']).toBe('0.8')
    expect(r.ignored.some((i) => i.path === 'overrides.any.doc-surface-alpha')).toBe(true)
  })
  it('does not change any pre-existing token of the ambience built-ins', () => {
    for (const n of ['osmosis', 'forest', 'ocean', 'ember']) {
      const b = builtinById(`builtin:${n}`)!
      const r = resolve(b)
      for (const mode of ['light', 'dark'] as const) {
        expect(Object.keys(r[mode]).length).toBe(TOKENS.length)
        for (const a of SIX) expect(r[mode][a]).toBeDefined()
      }
    }
  })
  it('keeps numbers out of the registry (LAYER_TOKENS is the only source)', () => {
    for (const t of ALPHA_TOKENS) expect(t.derive.toString()).not.toMatch(/0\.55|0\.85/)
  })
})
