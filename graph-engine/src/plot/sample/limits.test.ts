import { describe, expect, it } from 'vitest'
import { classify, oneSided } from './limits'
import { pointFnOf, scopeOf } from './testkit'
import type { PointFn } from './types'

const c = (text: string, tc: number, defs = '', angle: 'radians' | 'degrees' = 'radians') =>
  classify(pointFnOf(text, 'x', scopeOf(defs, angle)), tc, 0.1, { x: 40, y: 40 }, { points: 0, intervals: 0 })

describe('classify', () => {
  it('poles', () => {
    expect(c('1/x', 0).kind).toBe('pole')
    expect(c('1/x^2', 0).kind).toBe('pole')
    expect(c('tan(x)', Math.PI / 2).kind).toBe('pole')
    expect(c('tan(x)', 90, '', 'degrees').kind).toBe('pole')
  })
  it('holes, with the limit', () => {
    for (const [text, at, limit] of [['(x^2 - 1)/(x - 1)', 1, 2], ['sin(x)/x', 0, 1], ['sin(x - pi)/(x - pi)', Math.PI, 1], ['x sin(1/x)', 0, 0]] as const) {
      const r = c(text, at)
      expect(r.kind, text).toBe('hole')
      if (r.kind === 'hole') {
        expect(r.limit.y).toBeCloseTo(limit, 6)
        expect(r.value).toBeNull()
      }
    }
  })
  it('a removable point with its own value', () => {
    const r = c('{x = 1: 5, x}', 1)
    expect(r).toMatchObject({ kind: 'hole', limit: { x: 1, y: expect.closeTo(1, 6) }, value: { x: 1, y: 5 } })
  })
  it('jumps, with the value at the seam', () => {
    expect(c('floor(x)', 1)).toMatchObject({ kind: 'jump', left: { y: expect.closeTo(0, 9) }, right: { y: expect.closeTo(1, 9) }, value: { y: 1 } })
    expect(c('{x < 0: x^2, x + 1}', 0)).toMatchObject({ kind: 'jump', value: { y: 1 } })
    expect(c('{x <= 0: x^2, x + 1}', 0)).toMatchObject({ kind: 'jump', value: { y: 0 } })
  })
  it('edges', () => {
    expect(c('sqrt(x)', 0)).toMatchObject({ kind: 'edge', defined: 'right', limit: { y: expect.closeTo(0, 3) } })
    expect(c('ln(x)', 0)).toMatchObject({ kind: 'edge', defined: 'right', limit: null })
    expect(c('{0 < x <= 3: 2}', 0)).toMatchObject({ kind: 'edge', defined: 'right', limit: { y: expect.closeTo(2, 9) } })
    expect(c('{0 < x <= 3: 2}', 3)).toMatchObject({ kind: 'edge', defined: 'left', limit: { y: expect.closeTo(2, 9) } })
  })
  it('regular points and the honest unknowns', () => {
    expect(c('{x < 1: x, x}', 1).kind).toBe('regular')
    expect(c('sin(1/x)', 0).kind).toBe('unknown')
    expect(c('x^0.1', 0).kind).toBe('unknown') // converges too slowly to call within the offsets; the sampler reaches the edge itself
  })
})

const side = (text: string, tc: number, which: -1 | 1, scale = 40, defs = '', angle: 'radians' | 'degrees' = 'radians') =>
  oneSided(pointFnOf(text, 'x', scopeOf(defs, angle)), tc, which, 0.1, { x: scale, y: scale }, { points: 0, intervals: 0 })

describe('oneSided', () => {
  it('signs a divergence by which way the curve runs off', () => {
    expect(side('1/x', 0, -1)).toEqual({ kind: 'diverge', sign: -1 })
    expect(side('1/x', 0, 1)).toEqual({ kind: 'diverge', sign: 1 })
    expect(side('ln(x)', 0, 1)).toEqual({ kind: 'diverge', sign: -1 })
  })
  it('reads a side that is not there as undefined', () => {
    expect(side('sqrt(x)', 0, -1)).toEqual({ kind: 'undefined' })
    expect(side('ln(x)', 0, -1)).toEqual({ kind: 'undefined' })
  })
  it('converges geometrically where the window is too wide for a finer view', () => {
    // sqrt(x) at 400 px per unit spreads 0.22 px over the last four samples, but its
    // differences halve and the tail past the last is a thirtieth of a pixel.
    const s = side('sqrt(x)', 0, 1, 400)
    expect(s.kind).toBe('converge')
    // the limit is extrapolated past the last sample, to the true 0 and not to sqrt(6e-9)
    if (s.kind === 'converge') expect(Math.abs(s.at.y)).toBeLessThan(1e-9)
    // and at 4000 px the tail is a third of a pixel: honestly not called
    expect(side('sqrt(x)', 0, 1, 4000).kind).toBe('unknown')
  })
  it('does not call a slow convergence a divergence, and a sample that overflows stays unknown', () => {
    expect(side('x^0.1', 0, 1).kind).toBe('unknown')
    expect(side('exp(1/x^2)', 0, 1).kind).toBe('unknown')
  })
  it('signs a curve that runs off along x by x', () => {
    const along: PointFn = (t, out) => {
      out[0] = 1 / t
      out[1] = 0
    }
    const px = { x: 40, y: 40 }
    const counter = { points: 0, intervals: 0 }
    expect(oneSided(along, 0, 1, 0.1, px, counter)).toEqual({ kind: 'diverge', sign: 1 })
    expect(oneSided(along, 0, -1, 0.1, px, counter)).toEqual({ kind: 'diverge', sign: -1 })
  })
  it('is unknown for a step or a scale it cannot read', () => {
    const p = pointFnOf('x', 'x', scopeOf())
    const counter = { points: 0, intervals: 0 }
    for (const h0 of [0, -1, NaN, Infinity]) expect(oneSided(p, 0, 1, h0, { x: 40, y: 40 }, counter).kind).toBe('unknown')
    expect(oneSided(p, 0, 1, 0.1, { x: 0, y: 40 }, counter).kind).toBe('unknown')
    expect(counter.points).toBe(0)
  })
})

describe('classify, accounting', () => {
  const run = (text: string, tc: number, angle: 'radians' | 'degrees' = 'radians') => {
    const counter = { points: 0, intervals: 0 }
    const result = classify(pointFnOf(text, 'x', scopeOf('', angle)), tc, 0.1, { x: 40, y: 40 }, counter)
    return { result, counter }
  }
  it('counts every evaluation: 13 offsets a side and the point itself', () => {
    expect(run('1/x', 0).counter).toEqual({ points: 27, intervals: 0 })
  })
  it('stops the offsets short of the cancellation noise, further out at a large tc', () => {
    // 9e-8 is the floor at tc = 90: 0.1 / 4^10 = 9.5e-8 is the last offset above it, so 11 a side
    expect(run('tan(x)', 90, 'degrees').counter.points).toBe(23)
  })
  it('is deterministic', () => {
    expect(run('sin(x)/x', 0)).toEqual(run('sin(x)/x', 0))
  })
  it('gives a hole the middle of its two limits, so x is the point and not the last offset', () => {
    const { result } = run('(x^2 - 1)/(x - 1)', 1)
    expect(result).toMatchObject({ kind: 'hole', limit: { x: expect.closeTo(1, 12) } })
  })
})

describe('classify, functions periodic in 1/x', () => {
  // The offsets are h0 / 4^k, so 1/x sits at 4^k / h0 on every one of them. At h0 = 0.1
  // and 0.08, pi / x is a whole number of pi from k = 2 on: sin(pi/x) reads 0 at every
  // sample and the lattice alone would call 0 a hole. The sample off the lattice that a
  // converging side takes (h sqrt 2) must agree, and does not.
  const aliased = (text: string, h0: number) =>
    classify(pointFnOf(text, 'x', scopeOf()), 0, h0, { x: 40, y: 40 }, { points: 0, intervals: 0 })
  for (const h0 of [0.1, 0.08]) {
    for (const text of ['sin(pi/x)', 'cos(pi/x)', 'tan(pi/x)', '1/x - floor(1/x)']) {
      it(`${text} at 0 is not a hole (h0 = ${h0})`, () => {
        expect(aliased(text, h0).kind).toBe('unknown')
      })
    }
  }
  it('a real limit still passes the off-lattice sample, and the sample is counted', () => {
    const run = (text: string, tc: number) => {
      const counter = { points: 0, intervals: 0 }
      const result = classify(pointFnOf(text, 'x', scopeOf()), tc, 0.1, { x: 40, y: 40 }, counter)
      return { kind: result.kind, points: counter.points }
    }
    // 13 offsets a side, one confirming sample on each converging side, and the point
    expect(run('sin(x)/x', 0)).toEqual({ kind: 'hole', points: 13 + 13 + 2 + 1 })
    expect(run('sqrt(x)', 0)).toEqual({ kind: 'edge', points: 13 + 13 + 1 + 1 })
    expect(run('1/x', 0)).toEqual({ kind: 'pole', points: 27 }) // a divergence is not confirmed
  })
})

describe('classify, distances that overflow when squared', () => {
  it('1/x^30 is a pole: 1e247 px squared is not Infinity', () => {
    expect(c('1/x^30', 0).kind).toBe('pole')
  })
})
