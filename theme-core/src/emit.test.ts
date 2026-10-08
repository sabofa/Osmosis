import { describe, expect, it } from 'vitest'
import { ALIASES, UnsafeValueError, toCssVars, toLegacyTokens, toStylesheet } from './emit.js'
import { migrate } from './migrate.js'
import { resolve } from './resolve.js'
import { tokenByName } from './registry/index.js'
import { normalise } from './manifest.js'

const light = { '--bg': '#ecf0e6', '--surface': '#fbfcf8', '--ink': '#141a13', '--muted': '#5d6b5c', '--line': '#d8e0d2', '--line-strong': '#b8c6b0', '--accent': '#2f7a4f', '--accent-wash': '#e8f3ea' }
const dark = { '--bg': '#0f1511', '--surface': '#161f18', '--ink': '#e6efe6', '--muted': '#92a394', '--line': '#25332a', '--line-strong': '#36473c', '--accent': '#6fbf8a', '--accent-wash': '#16261b' }

describe('emit', () => {
  const r = resolve(normalise({ id: 'a', name: 'A' }))
  it('aliases point at registry tokens', () => {
    for (const v of Object.values(ALIASES)) expect(tokenByName.has(v)).toBe(true)
  })
  it('toCssVars has tokens and aliases', () => {
    const v = toCssVars(r.light)
    expect(v['--bg']).toBe(r.light['color-canvas'])
    expect(v['--danger']).toBe(r.light['color-bad'])
    expect(v['--color-canvas']).toBe(r.light['color-canvas'])
    expect(v['--font-body']).toBe(r.light['font-body'])
  })
  it('skips aliases with absent targets', () => {
    expect(toCssVars({ 'color-bad': 'red' })).toEqual({ '--color-bad': 'red', '--bad': 'red', '--danger': 'red' })
  })
  it('stylesheet', () => {
    const s = toStylesheet(r.light, 'light', '.x{y:z}')
    expect(s.startsWith('html:root[data-theme]{')).toBe(true)
    expect(s.endsWith('.x{y:z}')).toBe(true)
    expect(s).toContain('--color-canvas:')
    expect(s).toContain('html:root[data-theme]{color-scheme:light}\n')
    expect(toStylesheet({ a: '1', b: '2' }, 'dark')).toBe('html:root[data-theme]{--a:1;--b:2}\nhtml:root[data-theme]{color-scheme:dark}\n')
  })
  it('selector defaults to html:root[data-theme] and is overridable', () => {
    expect(toStylesheet({ a: '1' }, 'light')).toBe('html:root[data-theme]{--a:1}\nhtml:root[data-theme]{color-scheme:light}\n')
    expect(toStylesheet({ a: '1' }, 'light', undefined, '.t')).toBe('.t{--a:1}\n.t{color-scheme:light}\n')
  })
  it('legacy exactness', () => {
    const rr = resolve(migrate({ id: 'f', name: 'F', tokens: { light, dark } }))
    expect(toLegacyTokens(rr)).toEqual({ light, dark })
  })
  it('heat override round-trips', () => {
    const rr = resolve(migrate({ id: 'f', name: 'F', tokens: { light: { ...light, '--heat-2': '#abcdef' }, dark } }))
    expect(toCssVars(rr.light)['--heat-2']).toBe('#abcdef')
  })
})

describe('emit guard', () => {
  it('refuses values that could break out of a declaration', () => {
    expect(() => toStylesheet({ 'color-x': 'red;}body{x:y' }, 'light')).toThrow(UnsafeValueError)
    for (const bad of ['a{b', 'a}b', 'a\nb', 'a/*b', 'a*/b']) {
      expect(() => toCssVars({ 'color-x': bad })).toThrow(UnsafeValueError)
    }
    try { toCssVars({ 'color-x': 'a;b' }) } catch (e) {
      expect((e as UnsafeValueError).token).toBe('color-x')
      expect((e as UnsafeValueError).value).toBe('a;b')
    }
  })
  it('still emits a normal map, and does not guard the css argument', () => {
    expect(toStylesheet({ 'color-x': 'oklch(0.5 0.1 20)' }, 'dark')).toContain('--color-x:oklch(0.5 0.1 20)')
    expect(toStylesheet({ 'color-x': 'red' }, 'light', 'a{b:c;} /* ok */')).toContain('a{b:c;} /* ok */')
  })
})

describe('emit guard: other line terminators', () => {
  it.each([0x0c, 0x2028, 0x2029])('rejects code point %i', (cp) => {
    expect(() => toCssVars({ 'color-x': 'a' + String.fromCharCode(cp) + 'b' })).toThrow(UnsafeValueError)
  })
})
