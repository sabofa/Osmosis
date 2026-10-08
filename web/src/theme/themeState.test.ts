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
    const tokens: Record<'light' | 'dark', Record<string, string>> = { light: { ...p.tokens.light, '--accent': '#112233' }, dark: p.tokens.dark }
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

describe('readCache drops poisoned themes', () => {
  it('keeps good entries', () => {
    const st = mem()
    const good = { id: 'g', name: 'G', manifest: { ...forest, id: 'g', name: 'G' }, updated_at: 't' }
    const bad = { id: 'b', name: 'B', manifest: { id: 'b', name: 'B' }, updated_at: 't' }
    writeCache(st, { themes: [bad, good] as never, active_theme_id: 'g', location: null })
    const c = readCache(st)!
    expect(c.themes.map((t) => t.id)).toEqual(['g'])
  })
})

describe('presetToManifest keeps authored fields', () => {
  const rich = {
    ...forest,
    id: 'rich',
    name: 'Rich',
    dials: { ...forest.dials },
    fonts: { display: { stack: 'inter' as const } },
    graph: { styles: { a: 1 } },
    ambience: { x: 1 },
  } as typeof forest
  it('writes only the edited light accent', () => {
    const p = toPresetView('rich', 'Rich', rich)
    p.tokens = { ...p.tokens, light: { ...p.tokens.light, '--accent': '#112233' } }
    const m = presetToManifest(p)
    expect(m.dials).toEqual(rich.dials)
    expect(m.fonts).toEqual(rich.fonts)
    expect(m.graph).toEqual(rich.graph)
    expect(m.ambience).toEqual(rich.ambience)
    expect(m.seeds.light?.accent).toBe('#112233')
    expect(m.overrides?.light?.['color-accent']).toBe('#112233')
    expect(Object.keys(m.overrides?.light ?? {})).toEqual([...new Set([...Object.keys(rich.overrides?.light ?? {}), 'color-accent'])])
    expect(m.overrides?.dark).toEqual(rich.overrides?.dark)
  })
  it('no-change edit is deep-equal', () => {
    expect(presetToManifest(toPresetView('rich', 'Rich', rich))).toEqual(rich)
  })
  it('css-only edit changes only css', () => {
    const p = { ...toPresetView('rich', 'Rich', rich), customCss: 'a{b:c}' }
    expect(presetToManifest(p)).toEqual({ ...rich, css: 'a{b:c}' })
  })
})

describe('presetToManifest preserves every legacy token the editor showed', () => {
  const keys = ['--bg', '--surface', '--ink', '--muted', '--line', '--line-strong', '--accent', '--accent-wash']
  for (const id of ['builtin:osmosis', 'builtin:forest', 'builtin:ocean', 'builtin:ember']) {
    const m = builtinById(id)
    if (!m) continue
    it(`${id}: any single-token edit round-trips all legacy tokens`, () => {
      for (const mode of ['light', 'dark'] as const) {
        for (const key of keys) {
          for (const hex of ['#336699', '#ffeecc']) {
            const p = toPresetView(id, 'T', m)
            if (p.tokens[mode][key] === undefined) continue
            const tokens = { light: { ...p.tokens.light }, dark: { ...p.tokens.dark } }
            tokens[mode][key] = hex
            const edited = { ...p, tokens }
            const back = toLegacyTokens(resolve(presetToManifest(edited)))
            expect(back, `${id} ${mode} ${key} ${hex}`).toEqual(tokens)
          }
        }
      }
    })
    it(`${id}: a no-op edit leaves the manifest deep-equal`, () => {
      expect(presetToManifest(toPresetView(m.id, m.name, m))).toEqual(m)
    })
  }
})

describe('readCache validates entries individually', () => {
  const good = { id: 'g', name: 'G', manifest: { ...forest, id: 'g', name: 'G' }, updated_at: 't' }
  it('keeps a good theme beside a null manifest', () => {
    const raw = JSON.stringify({ themes: [{ id: 'n', name: 'N', manifest: null, updated_at: 't' }, good], active_theme_id: 'g', location: null })
    expect(readCache(mem({ 'osmosis:theme-cache': raw }))!.themes.map((t) => t.id)).toEqual(['g'])
  })
  it('returns null for invalid json, null, arrays and non-array themes', () => {
    for (const raw of ['{x', 'null', '[]', JSON.stringify({ themes: 'no' }), JSON.stringify({ themes: {} })]) {
      expect(readCache(mem({ 'osmosis:theme-cache': raw }))).toBeNull()
    }
  })
})
