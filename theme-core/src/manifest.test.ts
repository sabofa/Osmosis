import { describe, it, expect } from 'vitest'
import { normalise, DEFAULT_DIALS, FONT_STACKS, ID_RE, DEFAULT_SEEDS } from './manifest.js'
import { parseColour } from './colour.js'

describe('manifest', () => {
  it('normalise fills defaults', () => {
    expect(normalise({ id: 'a', name: 'A' })).toEqual({ schema: 1, id: 'a', name: 'A', seeds: {}, dials: {}, fonts: {} })
  })
  it('normalise keeps reserved slots by identity', () => {
    const ambience = { x: 1 }
    expect(normalise({ id: 'a', name: 'A', ambience }).ambience).toBe(ambience)
  })
  it('default dials are in range', () => {
    const { typeScale, baseSize, ...ratios } = DEFAULT_DIALS
    for (const v of Object.values(ratios)) {
      if (typeof v === 'number') { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
    }
    expect(typeScale).toBeGreaterThanOrEqual(1.125); expect(typeScale).toBeLessThanOrEqual(1.333)
    expect(baseSize).toBeGreaterThanOrEqual(13); expect(baseSize).toBeLessThanOrEqual(18)
  })
  it('font stacks end in a generic family', () => {
    for (const v of Object.values(FONT_STACKS)) expect(v).toMatch(/(sans-serif|serif|monospace)$/)
  })
  it('font stacks have exactly the seven keys', () => {
    expect(Object.keys(FONT_STACKS).sort()).toEqual(['inter', 'latin-modern-math', 'space-grotesk', 'stix-two', 'system-mono', 'system-sans', 'system-serif'])
  })
  it('ID_RE', () => {
    expect(ID_RE.test('forest')).toBe(true)
    expect(ID_RE.test('a_b-1')).toBe(true)
    for (const bad of ['Builtin', '-x', '', 'a'.repeat(65)]) expect(ID_RE.test(bad)).toBe(false)
  })
  it('default seeds parse', () => {
    for (const m of ['light', 'dark'] as const)
      for (const h of Object.values(DEFAULT_SEEDS[m])) expect(() => parseColour(h)).not.toThrow()
  })
})

describe('manifest layer + workspace slot', () => {
  it('normalise keeps workspace by identity and layer', () => {
    const ws = { anything: [1] }
    const m = normalise({ id: 'a', name: 'A', layer: 'workspace', workspace: ws })
    expect(m.workspace).toBe(ws)
    expect(m.layer).toBe('workspace')
  })
})
