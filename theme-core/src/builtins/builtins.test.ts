import { describe, expect, it } from 'vitest'
import { BUILTINS, DEFAULT_THEME_ID, DEFAULT_WORKSPACE_THEME_ID, REMOVED_BUILTINS, builtinById, isBuiltinId } from './index.js'
import { validate } from '../validate.js'
import { resolve } from '../resolve.js'
import { toCssVars, toLegacyTokens } from '../emit.js'
import { contrast, parseColour } from '../colour.js'

const OSMOSIS_LIGHT_8 = { '--accent': '#c65d22', '--accent-wash': '#faf1e9', '--bg': '#eef1e5', '--surface': '#ffffff', '--ink': '#17170f', '--muted': '#6b6b5f', '--line': '#e4e2d4', '--line-strong': '#c9c6b3' }
const OSMOSIS_DARK_8 = { '--accent': '#e2803f', '--accent-wash': '#2c2113', '--bg': '#17160f', '--surface': '#201e15', '--ink': '#f2efe2', '--muted': '#a19d8c', '--line': '#34311e', '--line-strong': '#4a4530' }
const FOREST_LIGHT_8 = { '--accent': '#2f7a4f', '--accent-wash': '#e8f3ea', '--bg': '#ecf0e6', '--surface': '#fbfcf8', '--ink': '#141a13', '--muted': '#5d6b5c', '--line': '#d8e0d2', '--line-strong': '#b8c6b0' }
const FOREST_DARK_8 = { '--accent': '#6fbf8a', '--accent-wash': '#16261b', '--bg': '#0f1511', '--surface': '#161f18', '--ink': '#e6efe6', '--muted': '#92a394', '--line': '#25332a', '--line-strong': '#36473c' }
const EMBER_LIGHT_8 = { '--accent': '#b3411f', '--accent-wash': '#f8e9df', '--bg': '#f2ebe0', '--surface': '#fffaf3', '--ink': '#1c1410', '--muted': '#75655a', '--line': '#e6d9c8', '--line-strong': '#cdb9a2' }
const EMBER_DARK_8 = { '--accent': '#ff8a3d', '--accent-wash': '#2e1a0f', '--bg': '#0d0b09', '--surface': '#16110d', '--ink': '#f6ece0', '--muted': '#a89583', '--line': '#2b2119', '--line-strong': '#443426' }

const get = (id: string) => builtinById(id)!

describe('builtins registry', () => {
  it('has unique ids in order', () => {
    const ids = BUILTINS.map((b) => b.id)
    expect(ids).toEqual(['builtin:osmosis', 'builtin:forest', 'builtin:ocean', 'builtin:ember', 'builtin:ws-clean'])
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('resolves every builtin without throwing', () => {
    for (const b of BUILTINS) expect(() => resolve(b)).not.toThrow()
  })
  it('builtinById / isBuiltinId / default', () => {
    expect(builtinById('builtin:forest')?.name).toBe('Forest')
    expect(builtinById('builtin:nope')).toBeUndefined()
    expect(isBuiltinId('builtin:x')).toBe(true)
    expect(isBuiltinId('custom-1')).toBe(false)
    expect(builtinById(DEFAULT_THEME_ID)).toBeDefined()
  })
  it('ws-clean is the workspace-layer default', () => {
    expect(DEFAULT_WORKSPACE_THEME_ID).toBe('builtin:ws-clean')
    expect(builtinById('builtin:ws-clean')?.layer).toBe('workspace')
    const b = get('builtin:ws-clean')
    expect(() => resolve(b)).not.toThrow()
    const r = validate({ ...b, id: 'copy-ws-clean' })
    expect(r.ok).toBe(true)
    expect(r.warnings).toEqual([])
  })
  it('removed builtins are gone', () => {
    expect(REMOVED_BUILTINS).toContain('builtin:slate')
    expect(REMOVED_BUILTINS).toContain('builtin:plum')
    for (const b of BUILTINS) expect(REMOVED_BUILTINS as readonly string[]).not.toContain(b.id)
  })
  it('all are human-authored with descriptions', () => {
    for (const b of BUILTINS) { expect(b.author).toBe('human'); expect(b.description).toBeTruthy() }
  })
})

describe('legacy parity', () => {
  it.each([
    ['builtin:osmosis', OSMOSIS_LIGHT_8, OSMOSIS_DARK_8],
    ['builtin:forest', FOREST_LIGHT_8, FOREST_DARK_8],
    ['builtin:ember', EMBER_LIGHT_8, EMBER_DARK_8],
  ])('%s legacy tokens', (id, light, dark) => {
    const t = toLegacyTokens(resolve(get(id)))
    expect(t.light).toEqual(light)
    expect(t.dark).toEqual(dark)
  })
  it('osmosis heat, good, bad', () => {
    const r = resolve(get('builtin:osmosis'))
    const l = toCssVars(r.light), d = toCssVars(r.dark)
    expect([0, 1, 2, 3, 4].map((i) => l[`--heat-${i}`])).toEqual(['#e4e2d4', '#e9c9a6', '#e3a468', '#d97a35', '#c65d22'])
    expect(l['--good']).toBe('#4c7a4a'); expect(l['--bad']).toBe('#a34b3f')
    expect([0, 1, 2, 3, 4].map((i) => d[`--heat-${i}`])).toEqual(['#2a2819', '#4a3a20', '#7a4e24', '#a85f2a', '#e2803f'])
    expect(d['--good']).toBe('#6fa06c'); expect(d['--bad']).toBe('#c76a5c')
  })
  it('forest and ember apply heat/good/bad to both modes', () => {
    for (const [id, heat4, good, bad] of [['builtin:forest', '#2f7a4f', '#2f7a4f', '#a6553c'], ['builtin:ember', '#b3411f', '#6e7f3c', '#b3411f']] as const) {
      const r = resolve(get(id))
      for (const m of [r.light, r.dark]) {
        const v = toCssVars(m)
        expect(v['--heat-4']).toBe(heat4); expect(v['--good']).toBe(good); expect(v['--bad']).toBe(bad)
      }
    }
  })
  it('keeps forest and ember css', () => {
    expect(get('builtin:forest').css).toBe('.panel { border-color: color-mix(in srgb, var(--accent) 18%, var(--line)); }')
    expect(get('builtin:ember').css).toContain('radial-gradient')
    expect(get('builtin:osmosis').css).toBeUndefined()
  })
  it('ocean is fully derived', () => {
    expect(get('builtin:ocean').overrides).toBeUndefined()
    expect(get('builtin:ocean').dials).toEqual({ roundness: 0.6, elevation: 0.35 })
  })
})

describe('contrast', () => {
  for (const b of BUILTINS) {
    it(`${b.id} text and muted text are legible`, () => {
      const r = resolve(b)
      for (const [mode, m] of [['light', r.light], ['dark', r.dark]] as const) {
        const surf = parseColour(m['color-surface']!)
        const text = contrast(parseColour(m['color-text']!), surf)
        const muted = contrast(parseColour(m['color-text-muted']!), surf)
        expect(text, `${b.id} ${mode} text ${text}`).toBeGreaterThanOrEqual(4.5)
        expect(muted, `${b.id} ${mode} muted ${muted}`).toBeGreaterThanOrEqual(3)
      }
    })
  }
})
