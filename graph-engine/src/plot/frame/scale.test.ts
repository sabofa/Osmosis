import { describe, expect, it } from 'vitest'
import { pxMapper, scaleOf } from './scale'

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

describe('pxMapper', () => {
  it('linear equals the explicit formula bit for bit', () => {
    const r = rng(11)
    for (let i = 0; i < 50; i++) {
      const xMin = (r() - 0.5) * 100
      const yMin = (r() - 0.5) * 100
      const bounds = { xMin, xMax: xMin + r() * 50 + 0.1, yMin, yMax: yMin + r() * 50 + 0.1 }
      const widthPx = Math.floor(r() * 1500) + 100
      const heightPx = Math.floor(r() * 900) + 100
      const v = (r() - 0.5) * 200
      const m = pxMapper({ bounds, widthPx, heightPx })
      const rx = widthPx / (bounds.xMax - bounds.xMin)
      const ry = heightPx / (bounds.yMax - bounds.yMin)
      expect(m.x(v)).toBe((v - bounds.xMin) * rx)
      expect(m.y(v)).toBe((v - bounds.yMin) * ry)
      expect(m.pxPerUnitX).toBe(rx)
      expect(m.pxPerUnitY).toBe(ry)
      expect(m.xInv(m.x(v))).toBeCloseTo(v, 9)
      expect(m.yInv(m.y(v))).toBeCloseTo(v, 9)
    }
  })

  it('log maps min to 0, max to the width, the geometric mean to the middle', () => {
    const bounds = { xMin: 0.01, xMax: 1e4, yMin: 2, yMax: 512 }
    const m = pxMapper({ bounds, widthPx: 800, heightPx: 600, xScale: 'log', yScale: 'log' })
    expect(Math.abs(m.x(0.01))).toBeLessThan(1e-9)
    expect(Math.abs(m.x(1e4) - 800)).toBeLessThan(1e-9)
    expect(Math.abs(m.x(Math.sqrt(0.01 * 1e4)) - 400)).toBeLessThan(1e-9)
    expect(Math.abs(m.y(Math.sqrt(2 * 512)) - 300)).toBeLessThan(1e-9)
    expect(m.pxPerUnitX).toBeCloseTo(800 / 6, 9)
    for (const v of [0.05, 3, 77, 9000]) expect(Math.abs(m.xInv(m.x(v)) - v) / v).toBeLessThan(1e-12)
  })

  it('mixes a log and a linear axis', () => {
    const m = pxMapper({ bounds: { xMin: 1, xMax: 100, yMin: -1, yMax: 1 }, widthPx: 200, heightPx: 100, xScale: 'log' })
    expect(Math.abs(m.x(10) - 100)).toBeLessThan(1e-9)
    expect(m.y(0)).toBe(50)
  })

  it('throws a RangeError naming a log axis with a bound <= 0', () => {
    expect(() => pxMapper({ bounds: { xMin: 0, xMax: 10, yMin: 1, yMax: 2 }, widthPx: 10, heightPx: 10, xScale: 'log' })).toThrow(RangeError)
    expect(() => pxMapper({ bounds: { xMin: 1, xMax: 10, yMin: -1, yMax: 2 }, widthPx: 10, heightPx: 10, yScale: 'log' })).toThrow(/y/)
  })
})
