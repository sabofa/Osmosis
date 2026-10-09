import { describe, it, expect } from 'vitest'
import { builtinById, BUILTINS, resolve, DEFAULT_DIALS, DEFAULT_SEEDS } from 'theme-core'
import type { ThemeManifest } from 'theme-core'
import type { ThemePreset } from '../hooks/useThemePresets'
import { startManifest, setSeed, setDial, setFont, setCss, setName, countOverrides, clearOverrides, reportFor, setLayer, dialVisible, seedsVisible, fontVisible, layerNote, workspaceOverrides } from './themeEditorModel'

const fresh = () => startManifest(null)
const presetOf = (m: ThemeManifest, builtin?: boolean): ThemePreset => ({
  id: m.id,
  name: m.name,
  tokens: { light: {}, dark: {} },
  customCss: '',
  builtin,
  manifest: m,
})

describe('startManifest', () => {
  it('fresh theme has a custom id and both seed sets', () => {
    const m = fresh()
    expect(m.id).toMatch(/^custom-[a-z0-9]{6}$/)
    expect(m.seeds.light).toEqual(DEFAULT_SEEDS.light)
    expect(m.seeds.dark).toEqual(DEFAULT_SEEDS.dark)
    expect(m.author).toBe('human')
  })
  it('builtin source yields a new non-builtin id and copy name', () => {
    const b = BUILTINS[0]
    const m = startManifest(null, presetOf(b, true))
    expect(m.id.startsWith('builtin:')).toBe(false)
    expect(m.id).toMatch(/^custom-/)
    expect(m.name).toBe(`${b.name} copy`)
    expect(m).not.toBe(b)
  })
  it('existing preset is deep-copied', () => {
    const b = builtinById(BUILTINS[0].id)!
    const m = startManifest(presetOf(b))
    expect(m).toEqual(b)
    expect(m.seeds).not.toBe(b.seeds)
  })
})

describe('setSeed', () => {
  it('deriveOther removes the other mode key and dark derives from light', () => {
    const m0 = fresh()
    const before = resolve(m0).dark['color-canvas']
    const m = setSeed(m0, 'light', 'canvas', '#ffeedd', true)
    expect(m.seeds.light?.canvas).toBe('#ffeedd')
    expect(m.seeds.dark && 'canvas' in m.seeds.dark).toBe(false)
    expect(m0.seeds.dark?.canvas).toBe(DEFAULT_SEEDS.dark.canvas)
    expect(resolve(m).dark['color-canvas']).not.toBe(before)
  })
  it('without deriveOther leaves the other mode alone', () => {
    const m = setSeed(fresh(), 'light', 'canvas', '#ffeedd', false)
    expect(m.seeds.dark?.canvas).toBe(DEFAULT_SEEDS.dark.canvas)
  })
  it('empty or invalid removes the key', () => {
    expect(setSeed(fresh(), 'light', 'ink', '', false).seeds.light).not.toHaveProperty('ink')
    expect(setSeed(fresh(), 'light', 'ink', 'nope', false).seeds.light).not.toHaveProperty('ink')
  })
})

describe('setDial', () => {
  it('clamps and drops defaults', () => {
    expect(setDial(fresh(), 'contrast', 5).dials.contrast).toBe(1)
    expect(setDial(fresh(), 'contrast', -1).dials.contrast).toBe(0)
    expect(setDial(fresh(), 'typeScale', 9).dials.typeScale).toBe(1.333)
    expect(setDial(fresh(), 'baseSize', 2).dials.baseSize).toBe(13)
    const m = setDial(setDial(fresh(), 'baseSize', 16), 'baseSize', DEFAULT_DIALS.baseSize)
    expect(m.dials).not.toHaveProperty('baseSize')
  })
  it('twilightBlend boolean', () => {
    expect(setDial(fresh(), 'twilightBlend', true).dials.twilightBlend).toBe(true)
    expect(setDial(setDial(fresh(), 'twilightBlend', true), 'twilightBlend', false).dials).not.toHaveProperty('twilightBlend')
  })
})

describe('fonts, css, name', () => {
  it('sets and clears', () => {
    const m = setFont(fresh(), 'body', 'system-serif')
    expect(m.fonts.body).toEqual({ stack: 'system-serif' })
    expect(setFont(m, 'body', null).fonts).not.toHaveProperty('body')
    expect(setCss(fresh(), '.a{}').css).toBe('.a{}')
    expect(setCss(setCss(fresh(), '.a{}'), '').css).toBeUndefined()
    expect(setName(fresh(), 'Hi').name).toBe('Hi')
  })
})

describe('overrides', () => {
  const withOv = (): ThemeManifest => ({
    ...fresh(),
    overrides: { any: { '--a': '#fff' }, light: { '--b': '#000', '--c': '#111' }, dark: {} },
  })
  it('counts and clears', () => {
    expect(countOverrides(fresh())).toBe(0)
    expect(countOverrides(withOv())).toBe(3)
    expect(countOverrides(clearOverrides(withOv()))).toBe(0)
  })
})

describe('reportFor', () => {
  it('flags an out-of-range dial', () => {
    const m = { ...fresh(), dials: { contrast: 4 } }
    expect(reportFor(m).ok).toBe(false)
  })
  it('accepts builtin ids for display', () => {
    expect(reportFor(builtinById(BUILTINS[0].id)!).errors).toEqual([])
  })
  it('every produced manifest resolves', () => {
    let m = fresh()
    m = setSeed(m, 'light', 'accent', '#123456', true)
    m = setDial(m, 'roundness', 0.9)
    m = setFont(m, 'mono', 'system-mono')
    for (const x of [m, startManifest(null, presetOf(BUILTINS[0], true))]) {
      expect(() => resolve(x)).not.toThrow()
    }
  })
})

describe('layer', () => {
  it('setLayer sets and clears the key without mutating', () => {
    const m = fresh()
    const w = setLayer(m, 'workspace')
    expect(w.layer).toBe('workspace')
    expect('layer' in m).toBe(false)
    const back = setLayer(w, null)
    expect('layer' in back).toBe(false)
    expect(w.layer).toBe('workspace')
    expect(setLayer(w, 'ambience').layer).toBe('ambience')
  })
  it('visibility follows OWNED_DIALS', () => {
    expect(dialVisible(undefined, 'contrast')).toBe(true)
    expect(dialVisible('workspace', 'roundness')).toBe(true)
    expect(dialVisible('workspace', 'contrast')).toBe(false)
    expect(dialVisible('ambience', 'roundness')).toBe(false)
    expect(dialVisible('ambience', 'saturation')).toBe(true)
    expect(seedsVisible('workspace')).toBe(false)
    expect(seedsVisible('ambience')).toBe(true)
    expect(seedsVisible(undefined)).toBe(true)
    expect(fontVisible('ambience', 'body')).toBe(false)
    expect(fontVisible('ambience', 'math')).toBe(true)
    expect(fontVisible('workspace', 'body')).toBe(true)
    expect(layerNote(undefined)).toBeNull()
    expect(layerNote('workspace')).toContain('colours come from the ambience theme')
  })
  it('hiding keeps values', () => {
    const m = setDial(fresh(), 'contrast', 0.9)
    expect(setLayer(m, 'workspace').dials.contrast).toBe(0.9)
  })
})

describe('workspaceOverrides', () => {
  it('only when a workspace theme is active and the edited layer is not workspace', () => {
    expect(workspaceOverrides(undefined, true)).toBe(true)
    expect(workspaceOverrides('ambience', true)).toBe(true)
    expect(workspaceOverrides('workspace', true)).toBe(false)
    expect(workspaceOverrides(undefined, false)).toBe(false)
    expect(workspaceOverrides('ambience', false)).toBe(false)
  })
})
