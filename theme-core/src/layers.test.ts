import { describe, expect, it } from 'vitest'
import { compose, OWNED_DIALS, ownerOf } from './layers.js'
import { DEFAULT_DIALS, normalise, type ThemeManifest } from './manifest.js'
import { TOKENS } from './registry/index.js'
import { resolve } from './resolve.js'
import { builtinById } from './builtins/index.js'

const wsClean = builtinById('builtin:ws-clean')!
const AMBIENCES = ['osmosis', 'forest', 'ocean', 'ember'].map((n) => builtinById(`builtin:${n}`)!)
const DOT = String.fromCharCode(183)

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o) }
  return o
}

describe('ownerOf', () => {
  it('is total over TOKENS', () => {
    for (const t of TOKENS) expect(['workspace', 'ambience', 'shared']).toContain(ownerOf(t.name))
  })
  it('spot checks', () => {
    const ws = ['radius-md', 'shadow-1', 'elevation-mode', 'corner-shape', 'motion-style', 'icon-sheet', 'button-primary-bg', 'font-body']
    for (const n of ws) expect(ownerOf(n), n).toBe('workspace')
    for (const n of ['font-math', 'doc-font-body', 'doc-measure']) expect(ownerOf(n), n).toBe('shared')
    for (const n of ['color-accent', 'color-border', 'surface-alpha', 'graph-grid', 'doc-page']) expect(ownerOf(n), n).toBe('ambience')
  })
  it('throws on unknown', () => { expect(() => ownerOf('nope')).toThrow() })
})

describe('OWNED_DIALS', () => {
  it('is disjoint and covers all dials', () => {
    const all = [...OWNED_DIALS.workspace, ...OWNED_DIALS.ambience]
    expect(new Set(all).size).toBe(all.length)
    expect([...all].sort()).toEqual(Object.keys(DEFAULT_DIALS).sort())
    expect(all).toHaveLength(13)
  })
})

describe('compose', () => {
  const mkWs = () => normalise({
    id: 'ws', name: 'W', layer: 'workspace',
    dials: { roundness: 0, contrast: 0.9 },
    fonts: { body: { stack: 'system-serif' } },
    overrides: { any: { 'corner-shape': 'bevel', 'color-accent': '#ff0000' } },
    css: '.w{}', workspace: { hooks: 1 },
  })
  const mkAmb = () => normalise({
    id: 'am', name: 'A', layer: 'ambience',
    seeds: { light: { accent: '#336699' } },
    dials: { contrast: 0.7, roundness: 1 },
    overrides: { any: { 'radius-md': '3px', 'color-border': '#aabbcc' } },
    css: '.a{}', ambience: { x: 1 },
  })

  it('identity for zero and one layer', () => {
    expect(compose({}).manifest).toBe(builtinById('builtin:osmosis'))
    expect(compose({}).ignored).toEqual([])
    const a = mkAmb()
    const r = compose({ ambience: a, workspace: null })
    expect(r.manifest).toBe(a)
    expect(r.ignored).toEqual([])
    const w = mkWs()
    expect(compose({ workspace: w }).manifest).toBe(w)
  })

  it('composes the full example', () => {
    const ws = mkWs(), amb = mkAmb()
    const { manifest: m, ignored } = compose({ workspace: ws, ambience: amb })
    expect(m.id).toBe('ws+am')
    expect(m.name).toBe(`W ${DOT} A`)
    expect(m.schema).toBe(1)
    expect(m.layer).toBeUndefined()
    expect(m.dials).toEqual({ roundness: 0, contrast: 0.7 })
    expect(m.fonts.body).toEqual({ stack: 'system-serif' })
    expect(m.seeds).toBe(amb.seeds)
    expect(m.overrides?.any).toEqual({ 'corner-shape': 'bevel', 'color-border': '#aabbcc' })
    expect(m.overrides?.light).toBeUndefined()
    expect(m.css).toBe('.w{}\n.a{}')
    expect(m.workspace).toBe(ws.workspace)
    expect(m.ambience).toBe(amb.ambience)
    const has = (layer: string, path: string) => ignored.some((i) => i.layer === layer && i.path === path)
    expect(has('workspace', 'dials.contrast')).toBe(true)
    expect(has('workspace', 'overrides.any.color-accent')).toBe(true)
    expect(has('ambience', 'dials.roundness')).toBe(true)
    expect(has('ambience', 'overrides.any.radius-md')).toBe(true)
    expect(ignored.some((i) => i.path === 'seeds')).toBe(false)
    expect(ignored).toHaveLength(4)
  })

  it('shared clash: ambience wins', () => {
    const ws = normalise({ id: 'w', name: 'W', overrides: { any: { 'font-math': 'serif' } } })
    const amb = normalise({ id: 'a', name: 'A', overrides: { any: { 'font-math': 'monospace' } } })
    expect(compose({ workspace: ws, ambience: amb }).manifest.overrides?.any?.['font-math']).toBe('monospace')
  })

  it('reports unknown tokens, ws seeds, graph and omits empty overrides', () => {
    const ws = normalise({ id: 'w', name: 'W', seeds: { light: { accent: '#111111' } }, graph: { styles: 1 }, overrides: { dark: { zzz: '1' } } })
    const amb = normalise({ id: 'a', name: 'A' })
    const { manifest, ignored } = compose({ workspace: ws, ambience: amb })
    expect(manifest.overrides).toBeUndefined()
    expect(manifest.css).toBeUndefined()
    expect(ignored.find((i) => i.path === 'overrides.dark.zzz')?.reason).toBe('unknown token')
    expect(ignored.some((i) => i.path === 'seeds')).toBe(true)
    expect(ignored.some((i) => i.path === 'graph')).toBe(true)
  })

  it('does not mutate frozen inputs', () => {
    const ws = deepFreeze(mkWs()), amb = deepFreeze(mkAmb())
    expect(() => compose({ workspace: ws, ambience: amb })).not.toThrow()
  })

  it('ws-clean + ambience resolves like the ambience alone (when it sets no workspace-owned dials; ocean sets roundness/elevation, which the workspace layer now owns)', () => {
    for (const x of AMBIENCES) {
      const a = resolve(compose({ workspace: wsClean, ambience: x }).manifest)
      const b = resolve(x)
      const wsDials = Object.keys(x.dials).some((k) => (OWNED_DIALS.workspace as readonly string[]).includes(k))
      for (const mode of ['light', 'dark'] as const) {
        if (!wsDials) expect(a[mode]).toEqual(b[mode])
      }
    }
  })

  it('records a workspace override of a shared token overwritten by the ambience layer', () => {
    const ws = normalise({ id: 'w2', name: 'W', layer: 'workspace', overrides: { any: { 'doc-measure': '60ch' } } })
    const amb = normalise({ id: 'a2', name: 'A', layer: 'ambience', overrides: { any: { 'doc-measure': '70ch' } } })
    const r = compose({ workspace: ws, ambience: amb })
    expect(r.manifest.overrides?.any?.['doc-measure']).toBe('70ch')
    expect(r.ignored).toContainEqual({
      layer: 'workspace', themeId: 'w2', path: 'overrides.any.doc-measure', reason: 'overridden by the ambience layer',
    })
  })

  it('ocean over ws-clean differs from ocean alone only in the documented workspace-owned tokens', () => {
    const ocean = builtinById('builtin:ocean')!
    const r = compose({ workspace: wsClean, ambience: ocean })
    expect(r.ignored.map((i) => [i.layer, i.path]).sort()).toEqual([
      ['ambience', 'dials.elevation'], ['ambience', 'dials.roundness'],
    ])
    const a = resolve(r.manifest)
    const b = resolve(ocean)
    const diff = (mode: 'light' | 'dark') =>
      Object.keys(b[mode]).filter((k) => a[mode][k] !== b[mode][k]).sort()
    // Intended consequence of workspace-owned dials (roundness, elevation) being dropped from an
    // ambience theme under a workspace theme. Elevation also lifts surface-raised/overlay in dark
    // mode: a cross-layer dependency by design.
    const common = [
      'radius-xs', 'radius-sm', 'radius-md', 'radius-lg', 'radius-xl', 'shadow-1', 'shadow-2', 'shadow-3',
      'panel-shadow', 'card-shadow', 'menu-shadow', 'modal-shadow',
      'panel-radius', 'card-radius', 'input-radius', 'button-radius', 'menu-radius', 'modal-radius',
    ]
    expect(diff('light')).toEqual([...common].sort())
    expect(diff('dark')).toEqual([...common, 'color-surface-raised', 'color-surface-overlay', 'card-bg', 'menu-bg', 'modal-bg'].sort())
  })

  it('a retro-like workspace over forest differs in shape tokens', () => {
    const forest = builtinById('builtin:forest')!
    const retro: ThemeManifest = normalise({
      id: 'retro', name: 'Retro', layer: 'workspace',
      dials: { roundness: 0 }, overrides: { any: { 'corner-shape': 'bevel' } },
    })
    const a = resolve(compose({ workspace: retro, ambience: forest }).manifest)
    const b = resolve(forest)
    expect(a.light['radius-md']).not.toBe(b.light['radius-md'])
    expect(a.light['corner-shape']).not.toBe(b.light['corner-shape'])
  })
})
