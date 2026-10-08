import { describe, it, expect } from 'vitest'
import { migrate, MigrateError } from './migrate.js'

const row = () => ({
  id: 'forest-copy', name: 'F',
  tokens: {
    light: { '--bg': '#ecf0e6', '--surface': '#fbfcf8', '--ink': '#141a13', '--muted': '#5d6b5c', '--line': '#d8e0d2', '--line-strong': '#b8c6b0', '--accent': '#2f7a4f', '--accent-wash': '#e8f3ea' } as Record<string, string>,
    dark: { '--bg': '#0f1511', '--surface': '#161f18', '--ink': '#e6efe6', '--muted': '#92a394', '--line': '#25332a', '--line-strong': '#36473c', '--accent': '#6fbf8a', '--accent-wash': '#16261b' } as Record<string, string>,
  },
  custom_css: '.panel{}',
})
const code = (f: () => unknown) => { try { f() } catch (e) { return (e as MigrateError).code } return null }

describe('migrate', () => {
  it('maps legacy tokens', () => {
    const m = migrate(row())
    expect(m.seeds.light?.canvas).toBe('#ecf0e6')
    expect(m.overrides?.light?.['color-canvas']).toBe('#ecf0e6')
    expect(m.overrides?.light?.['color-text-muted']).toBe('#5d6b5c')
    expect(m.overrides?.dark?.['color-border-strong']).toBe('#36473c')
    expect(m.css?.endsWith('.panel{}')).toBe(true)
    expect(m.author).toBeUndefined()
  })
  it('unknown keys go to css', () => {
    const r = row(); r.tokens.light['--foo'] = '1px'
    expect(migrate(r).css).toContain(':root[data-theme="light"]{--foo:1px;}')
  })
  it('manifest keeps reserved slots', () => {
    const ambience = { foo: 1 }
    expect(migrate({ schema: 1, id: 'a', name: 'A', ambience }).ambience).toBe(ambience)
  })
  it('errors', () => {
    expect(code(() => migrate({ schema: 1, id: 'a', name: 'A', x: 1 }))).toBe('unknown_field')
    expect(code(() => migrate(5))).toBe('not_object')
    expect(code(() => migrate({ id: 'a', name: 'A' }))).toBe('unknown_shape')
    expect(code(() => migrate({ id: 'a', name: 'A', tokens: { light: {} } }))).toBe('invalid_tokens')
    expect(code(() => migrate({ id: 'a', name: 'A', tokens: { light: { '--bg': 1 }, dark: {} } }))).toBe('invalid_tokens')
  })

  it('inherited Object.prototype names are unknown keys', () => {
    for (const k of ['constructor', 'toString', 'hasOwnProperty']) {
      const m = migrate({ id: 'a', name: 'A', tokens: { light: { [k]: 'x' }, dark: {} } })
      expect(m.css).toBe(`:root[data-theme="light"]{${k}:x;}`)
      expect(m.overrides).toBeUndefined()
    }
  })
  it('--bad wins over --danger regardless of key order', () => {
    for (const toks of [{ '--bad': 'red', '--danger': 'pink' }, { '--danger': 'pink', '--bad': 'red' }]) {
      expect(migrate({ id: 'a', name: 'A', tokens: { light: toks, dark: {} } }).overrides?.light?.['color-bad']).toBe('red')
    }
  })
  it('danger alone maps to color-bad', () => {
    expect(migrate({ id: 'a', name: 'A', tokens: { light: { '--danger': 'pink' }, dark: {} } }).overrides?.light?.['color-bad']).toBe('pink')
  })
  it('maps dark seeds', () => {
    const m = migrate(row())
    expect(m.seeds.dark).toEqual({ canvas: '#0f1511', surface: '#161f18', ink: '#e6efe6', accent: '#6fbf8a' })
  })
  it('maps good/bad/danger/heat', () => {
    const t = { '--good': 'g', '--bad': 'b', '--heat-0': 'h0', '--heat-1': 'h1', '--heat-2': 'h2', '--heat-3': 'h3', '--heat-4': 'h4' }
    const o = migrate({ id: 'a', name: 'A', tokens: { light: t, dark: {} } }).overrides?.light
    expect(o).toEqual({ 'color-good': 'g', 'color-bad': 'b', 'color-heat-0': 'h0', 'color-heat-1': 'h1', 'color-heat-2': 'h2', 'color-heat-3': 'h3', 'color-heat-4': 'h4' })
  })
  it('dark unknown key goes in dark block; css order light, dark, custom', () => {
    const m = migrate({ id: 'a', name: 'A', tokens: { light: { '--l': '1' }, dark: { '--d': '2' } }, custom_css: '.x{}' })
    expect(m.css).toBe(':root[data-theme="light"]{--l:1;}\n:root[data-theme="dark"]{--d:2;}\n.x{}')
  })
  it('invalid_manifest cases', () => {
    expect(code(() => migrate({ schema: 1, id: 5, name: 'A' }))).toBe('invalid_manifest')
    expect(code(() => migrate({ schema: 1, id: 'a', name: '' }))).toBe('invalid_manifest')
    expect(code(() => migrate({ id: 5, name: 'A', tokens: { light: {}, dark: {} } }))).toBe('invalid_manifest')
    expect(code(() => migrate({ id: 'a', name: '', tokens: { light: {}, dark: {} } }))).toBe('invalid_manifest')
  })
  it('manifest shape checks', () => {
    const base = { schema: 1, id: 'a', name: 'A' }
    const bad: Record<string, unknown>[] = [
      { seeds: [] }, { seeds: null }, { dials: [] }, { dials: 3 }, { fonts: null }, { fonts: [] },
      { overrides: [] }, { overrides: { any: [] } }, { overrides: { light: { a: 1 } } }, { overrides: { dark: null } },
      { css: 5 }, { graph: [] }, { graph: 'x' }, { description: 1 }, { author: 'bot' },
    ]
    for (const b of bad) expect(code(() => migrate({ ...base, ...b }))).toBe('invalid_manifest')
    const ok = { ...base, seeds: {}, dials: {}, fonts: {}, overrides: { any: { a: 'b' }, light: {}, dark: {} }, css: '', graph: {}, description: 'd', author: 'claude', ambience: 1, sounds: [], assets: 'x' }
    expect(code(() => migrate(ok))).toBeNull()
  })
  it('schema-1 keeps identity of author/graph/assets', () => {
    const graph = { papers: {} }, assets = { a: 1 }
    const m = migrate({ schema: 1, id: 'a', name: 'A', author: 'human', graph, assets })
    expect(m.author).toBe('human'); expect(m.graph).toBe(graph); expect(m.assets).toBe(assets)
  })
  it('manifest keeps seeds/dials/fonts and does not mutate input', () => {
    const deepFreeze = <T,>(o: T): T => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(deepFreeze) } return o }
    const input = deepFreeze({ schema: 1, id: 'a', name: 'A', seeds: { light: { canvas: '#fff' } }, dials: { baseSize: 15 }, fonts: { body: 'inter' } })
    const m = migrate(input)
    expect(m.seeds).toEqual({ light: { canvas: '#fff' } })
    expect(m.dials).toEqual({ baseSize: 15 })
    expect(m.fonts).toEqual({ body: 'inter' })
  })
})

describe('migrate: layer + workspace', () => {
  const m = (extra: Record<string, unknown>) => ({ schema: 1, id: 'a', name: 'A', ...extra })
  it('accepts layer workspace and ambience', () => {
    expect(migrate(m({ layer: 'workspace' })).layer).toBe('workspace')
    expect(migrate(m({ layer: 'ambience' })).layer).toBe('ambience')
  })
  it('rejects a bad layer', () => {
    try { migrate(m({ layer: 'nope' })); expect.unreachable() } catch (e) { expect((e as MigrateError).code).toBe('invalid_manifest') }
  })
  it('keeps the workspace slot unchecked and by identity', () => {
    const ws = { x: 1 }
    expect(migrate(m({ workspace: ws })).workspace).toBe(ws)
  })
})
