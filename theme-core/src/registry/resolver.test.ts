import { describe, expect, it } from 'vitest'
import { createResolver, ResolveError, type ModeSeeds } from './resolver.js'
import { def } from './types.js'
import { DEFAULT_DIALS, DEFAULT_FONTS } from '../manifest.js'
import { parseColour } from '../colour.js'

const seeds: ModeSeeds = {
  canvas: parseColour('#ffffff'), ink: parseColour('#000000'), accent: parseColour('#ff0000'),
}
const base = { mode: 'light' as const, seeds, dials: DEFAULT_DIALS, fonts: DEFAULT_FONTS }

function chain(calls?: Record<string, number>) {
  const n = (k: string) => { if (calls) calls[k] = (calls[k] ?? 0) + 1 }
  return [
    def('a', 'shape', 'length', 'a', () => { n('a'); return '4px' }),
    def('b', 'shape', 'length', 'b', (c) => { n('b'); return `calc(${c.get('a')} * 2)` }),
    def('c', 'shape', 'string', 'c', (c) => { n('c'); return `[${c.get('b')}]` }),
  ]
}

describe('createResolver', () => {
  it('derives through dependencies', () => {
    const r = createResolver({ ...base, defs: chain() })
    expect(r.get('c')).toBe('[calc(4px * 2)]')
    expect(Object.keys(r.all())).toEqual(['a', 'b', 'c'])
  })
  it('override of a flows to dependents', () => {
    const r = createResolver({ ...base, defs: chain(), overrides: { a: '10px' } })
    expect(r.get('b')).toBe('calc(10px * 2)')
    expect(r.get('c')).toBe('[calc(10px * 2)]')
    expect([...r.overridden]).toEqual(['a'])
  })
  it('override of b leaves a alone', () => {
    const r = createResolver({ ...base, defs: chain(), overrides: { b: '7px' } })
    expect(r.get('a')).toBe('4px')
    expect(r.get('b')).toBe('7px')
    expect(r.get('c')).toBe('[7px]')
  })
  it('detects cycles', () => {
    const defs = [
      def('x', 'shape', 'length', 'x', (c) => c.get('y')),
      def('y', 'shape', 'length', 'y', (c) => c.get('x')),
    ]
    expect(() => createResolver({ ...base, defs }).get('x')).toThrow(ResolveError)
  })
  it('throws on unknown override name', () => {
    expect(() => createResolver({ ...base, defs: chain(), overrides: { zzz: '1px' } })).toThrow(ResolveError)
  })
  it('throws on bad override value, eagerly', () => {
    try {
      createResolver({ ...base, defs: chain(), overrides: { a: 'banana' } })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ResolveError)
      expect((e as ResolveError).token).toBe('a')
    }
  })
  it('throws on unknown get', () => {
    expect(() => createResolver({ ...base, defs: chain() }).get('nope')).toThrow(ResolveError)
  })
  it('memoises', () => {
    const calls: Record<string, number> = {}
    const r = createResolver({ ...base, defs: chain(calls) })
    r.get('c'); r.get('b'); r.all()
    expect(calls).toEqual({ a: 1, b: 1, c: 1 })
  })
  it('seed access', () => {
    const d = [def('s', 'colour', 'string', 's', (c) => `${c.hasSeed('good')}${c.seriesSeed(0)}`)]
    expect(createResolver({ ...base, defs: d }).get('s')).toBe('falsenull')
    const d2 = [def('s', 'colour', 'string', 's', (c) => String(c.seed('good')))]
    expect(() => createResolver({ ...base, defs: d2 }).get('s')).toThrow(ResolveError)
  })
})
