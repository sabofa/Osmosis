import { describe, expect, it } from 'vitest'
import { scaleOf } from './scale'

// mulberry32: a seeded generator, no Math.random
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('scaleOf', () => {
  it('round trips forward/inverse on 100 seeded values per scale', () => {
    const r = rng(7)
    for (const kind of ['linear', 'log'] as const) {
      const s = scaleOf(kind)
      for (let i = 0; i < 100; i++) {
        const x = 10 ** (r() * 20 - 10)
        expect(Math.abs(s.inverse(s.forward(x)) - x) / x).toBeLessThan(1e-12)
      }
    }
  })

  it('valid table', () => {
    const lin = scaleOf('linear')
    const log = scaleOf('log')
    const cases: [number, boolean, boolean][] = [
      [0, true, false],
      [-1, true, false],
      [Number.NaN, false, false],
      [Number.POSITIVE_INFINITY, false, false],
      [1e-300, true, true],
    ]
    for (const [x, l, g] of cases) {
      expect(lin.valid(x)).toBe(l)
      expect(log.valid(x)).toBe(g)
    }
  })

  it('log forward is NaN off the domain; domain and absent kind', () => {
    const log = scaleOf('log')
    expect(Number.isNaN(log.forward(0))).toBe(true)
    expect(Number.isNaN(log.forward(-3))).toBe(true)
    expect(log.domainLo).toBe(0)
    expect(scaleOf('linear').domainLo).toBe(Number.NEGATIVE_INFINITY)
    expect(scaleOf(undefined).kind).toBe('linear')
  })
})
