import { describe, expect, it } from 'vitest'
import { BUILTIN_THEME_STYLES, loadBuiltinStyles } from './builtinStyles'

describe('builtinStyles', () => {
  it('has the four built-in themes, frozen', () => {
    expect(Object.keys(BUILTIN_THEME_STYLES)).toEqual(['builtin:slate', 'builtin:forest', 'builtin:ember', 'builtin:plum'])
    expect(Object.isFrozen(BUILTIN_THEME_STYLES)).toBe(true)
    expect(Object.isFrozen(BUILTIN_THEME_STYLES['builtin:slate'])).toBe(true)
  })
  it('refuses an invalid set loudly, naming the theme', () => {
    expect(() => loadBuiltinStyles({ slate: { all: { set: { 'style.nope.nothing': 1 } } } })['builtin:slate']).toThrow(/slate/)
    expect(() => loadBuiltinStyles({ ember: { all: { set: { 'style.line.looseness': 99 } } } })['builtin:ember']).toThrow(/ember/)
    expect(() => loadBuiltinStyles({ plum: { bogus: 1 } })['builtin:plum']).toThrow(/plum/)
  })
  it('accepts a valid set', () => {
    const t = loadBuiltinStyles({ forest: { all: { set: { 'style.line.looseness': 0.3 } } } })
    expect(t['builtin:forest']?.all?.set?.['style.line.looseness']).toBe(0.3)
  })
})
