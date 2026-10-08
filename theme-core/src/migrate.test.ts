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
})
