import { describe, it, expect } from 'vitest'
import { builtinById, resolve, toLegacyTokens, DEFAULT_THEME_ID } from 'theme-core'
import { activeManifest, toPresetView, presetToManifest, readCache, writeCache, type StorageLike } from './themeState'

const osmosis = builtinById(DEFAULT_THEME_ID)!
const forest = builtinById('builtin:forest')!

function mem(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  }
}

describe('activeManifest', () => {
  const custom = [{ id: 'mine', manifest: { ...forest, id: 'mine', name: 'Mine' } }]
  it('falls back to osmosis for null, unknown and removed ids', () => {
    expect(activeManifest(custom, null)).toBe(osmosis)
    expect(activeManifest(custom, 'nope')).toBe(osmosis)
    expect(activeManifest(custom, 'builtin:slate')).toBe(osmosis)
    expect(activeManifest(custom, 'builtin:plum')).toBe(osmosis)
  })
  it('finds builtins and custom themes', () => {
    expect(activeManifest(custom, 'builtin:forest')).toBe(forest)
    expect(activeManifest(custom, 'mine')).toBe(custom[0].manifest)
  })
})

describe('preset view', () => {
  it('exposes legacy tokens and css', () => {
    const p = toPresetView(forest.id, forest.name, forest, true)
    expect(p.tokens).toEqual(toLegacyTokens(resolve(forest)))
    expect(p.customCss).toBe(forest.css ?? '')
    expect(p.builtin).toBe(true)
    expect(p.manifest).toBe(forest)
  })
  it('keeps the manifest when tokens are unchanged, renaming it', () => {
    const p = toPresetView('x', 'X', forest)
    const m = presetToManifest({ ...p, name: 'Renamed' })
    expect(m.name).toBe('Renamed')
    expect(m.seeds).toEqual(forest.seeds)
  })
  it('migrates a legacy-edited preset back to the same values', () => {
    const p = toPresetView('x', 'X', osmosis)
    const tokens = { light: { ...p.tokens.light, '--accent': '#112233' }, dark: p.tokens.dark }
    const m = presetToManifest({ ...p, tokens })
    expect(m.id).toBe('x')
    const back = toLegacyTokens(resolve(m))
    for (const k of Object.keys(tokens.light)) expect(back.light[k]).toBe(tokens.light[k])
    for (const k of Object.keys(tokens.dark)) expect(back.dark[k]).toBe(tokens.dark[k])
  })
})

describe('cache', () => {
  it('round-trips the new shape', () => {
    const s = mem()
    const v = { themes: [{ id: 'a', name: 'A', manifest: forest, updated_at: 't' }], active_theme_id: 'a', location: { lat: 1, lon: 2 } }
    writeCache(s, v)
    expect(readCache(s)).toEqual(v)
  })
  it('rejects the old shape and garbage', () => {
    const old = { themes: [{ id: 'a', name: 'A', tokens: {}, customCss: '' }], activeId: 'a' }
    expect(readCache(mem({ 'osmosis:theme-cache': JSON.stringify(old) }))).toBeNull()
    expect(readCache(mem({ 'osmosis:theme-cache': '{nope' }))).toBeNull()
    expect(readCache(mem())).toBeNull()
  })
})
