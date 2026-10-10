import { describe, it, expect } from 'vitest'
import type { IconSheetRef } from 'theme-core'
import { ICON_NAMES, resolveIcon } from './iconSheet'

const refs: IconSheetRef[] = [{ kind: 'default' }, { kind: 'builtin', slug: 'x' }, { kind: 'asset', hash: 'abc' }]

describe('resolveIcon', () => {
  it('resolves every icon name for every sheet kind', () => {
    for (const ref of refs) for (const name of ICON_NAMES) expect(typeof resolveIcon(name, ref)).toBe('function')
  })
  it('non-default sheets fall back to the default glyphs', () => {
    for (const name of ICON_NAMES) expect(resolveIcon(name, refs[1])).toBe(resolveIcon(name, refs[0]))
  })
  it('unknown names give a fallback, never throw', () => {
    expect(() => resolveIcon('nope', refs[0])).not.toThrow()
    expect(typeof resolveIcon('nope', refs[0])).toBe('function')
    expect(typeof resolveIcon('toString', refs[0])).toBe('function')
    expect(resolveIcon('toString', refs[0])).toBe(resolveIcon('nope', refs[0]))
  })
})
