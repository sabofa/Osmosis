import { describe, expect, it } from 'vitest'
import { parseStyleSet, serialiseStyleSet, styleSetPath, THEME_IDS } from './styleSets'

const GOOD = { all: { set: { 'style.line.looseness': 0.3 } }, byType: { space: { set: { 'paint.value.terminatorSoftness': 0.4 } } } }

describe('serialiseStyleSet / parseStyleSet', () => {
  it('saves and parses back to an equal set', () => {
    const parsed = parseStyleSet(JSON.stringify(GOOD))
    expect('styles' in parsed).toBe(true)
    if (!('styles' in parsed)) return
    const text = serialiseStyleSet(parsed.styles)
    const again = parseStyleSet(text)
    expect(again).toEqual(parsed)
  })
  it('writes sorted keys, 2-space indent, a trailing LF', () => {
    const text = serialiseStyleSet({ byType: { space: { set: { 'b.x': 1, 'a.y': 2 } } }, all: { set: {} } } as never)
    expect(text.endsWith('}\n')).toBe(true)
    expect(text.indexOf('"all"')).toBeLessThan(text.indexOf('"byType"'))
    expect(text.indexOf('"a.y"')).toBeLessThan(text.indexOf('"b.x"'))
    expect(text).toContain('\n  "all"')
    expect(serialiseStyleSet({})).toBe('{}\n')
  })
  it('refuses bad JSON', () => {
    const r = parseStyleSet('{ nope')
    expect('error' in r && r.error.length > 0).toBe(true)
  })
  it('refuses a non-object', () => {
    expect('error' in parseStyleSet('[1]')).toBe(true)
    expect('error' in parseStyleSet('3')).toBe(true)
  })
  it('refuses an unknown path', () => {
    const r = parseStyleSet(JSON.stringify({ all: { set: { 'style.nope.nothing': 1 } } }))
    expect('error' in r && r.error.includes('style.nope.nothing')).toBe(true)
  })
  it('refuses an out-of-range value', () => {
    const r = parseStyleSet(JSON.stringify({ all: { set: { 'style.line.looseness': 99 } } }))
    expect('error' in r).toBe(true)
  })
  it('refuses a non-integer where an integer is needed', () => {
    const r = parseStyleSet(JSON.stringify({ all: { set: { 'style.seed': 1.5 } } }))
    expect('error' in r).toBe(true)
  })
  it('refuses an unknown top-level key', () => {
    expect('error' in parseStyleSet(JSON.stringify({ bogus: {} }))).toBe(true)
  })
})

describe('styleSetPath', () => {
  it('gives the repo path of each built-in theme', () => {
    for (const id of THEME_IDS) expect(styleSetPath(id)).toBe(`graph-engine/src/style/theme/builtinStyles/${id}.json`)
  })
  it('refuses anything else', () => {
    for (const bad of ['../x', 'Slate', 'foo', 'slate/../../etc', '', 'slate.json', 'slate\n']) expect(styleSetPath(bad)).toBeNull()
  })
})
