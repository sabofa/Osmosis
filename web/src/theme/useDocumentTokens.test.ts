import { describe, it, expect } from 'vitest'
import { builtinById, DEFAULT_THEME_ID } from 'theme-core'
import { documentTokensFor } from './useDocumentTokens'

const osmosis = builtinById(DEFAULT_THEME_ID)!
const forest = builtinById('builtin:forest')!

describe('documentTokensFor', () => {
  it('is deterministic for the same manifest and mode', () => {
    expect(documentTokensFor(osmosis, 'light')).toEqual(documentTokensFor(osmosis, 'light'))
  })
  it('differs between light and dark', () => {
    const l = documentTokensFor(osmosis, 'light')
    const d = documentTokensFor(osmosis, 'dark')
    expect(d.mode).toBe('dark')
    expect(d.colors.page).not.toBe(l.colors.page)
  })
  it('changes with the manifest (key and tokens)', () => {
    const a = documentTokensFor(osmosis, 'light')
    const b = documentTokensFor(forest, 'light')
    expect(b.key).not.toBe(a.key)
    expect(b).not.toEqual(a)
  })
  it('reflects an edited copy of a manifest', () => {
    const edited = { ...osmosis, dials: { ...osmosis.dials, typeScale: 1.5 } }
    const a = documentTokensFor(osmosis, 'light')
    const b = documentTokensFor(edited, 'light')
    expect(b.scale.ratio).toBe(1.5)
    expect(b.key).not.toBe(a.key)
  })
})
