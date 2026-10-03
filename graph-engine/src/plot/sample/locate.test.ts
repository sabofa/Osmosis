import { describe, expect, it } from 'vitest'
import { locateZeros } from './locate'
import { troubleGenerators } from './structure'
import { expr, scopeOf } from './testkit'

function zerosOf(text: string, t0: number, t1: number, defs = '', angle: 'radians' | 'degrees' = 'radians') {
  const scope = scopeOf(defs, angle)
  const counter = { points: 0, intervals: 0 }
  return locateZeros(troubleGenerators(expr(text), 'x', scope), 'x', scope, t0, t1, counter)
}
const near = (zs: { t: number }[], want: number[], tol = 1e-11) => {
  expect(zs.map((z) => z.t)).toHaveLength(want.length)
  want.forEach((w, i) => expect(Math.abs(zs[i].t - w)).toBeLessThan(tol * Math.max(1, Math.abs(w))))
}

describe('locateZeros', () => {
  it('finds tan poles, in radians and in degrees', () => {
    near(zerosOf('tan(x)', -5, 5).zeros, [-3 * Math.PI / 2, -Math.PI / 2, Math.PI / 2, 3 * Math.PI / 2])
    near(zerosOf('tan(x)', -300, 300, '', 'degrees').zeros, [-270, -90, 90, 270])
  })
  it('finds an even zero no sign change shows (1/x^2)', () => near(zerosOf('1/x^2', -3, 3).zeros, [0]))
  it('finds the hole of (x^2 - 1)/(x - 1)', () => near(zerosOf('(x^2 - 1)/(x - 1)', -3, 3).zeros, [1]))
  it('finds floor steps, a log edge, a sqrt edge and the asin edges', () => {
    near(zerosOf('floor(x)', -2.5, 2.5).zeros, [-2, -1, 0, 1, 2])
    near(zerosOf('ln(x)', -2, 2).zeros, [0])
    near(zerosOf('sqrt(x - 2)', 0, 4).zeros, [2])
    near(zerosOf('asin(x)', -2, 2).zeros, [-1, 1])
  })
  it('finds the gamma poles in range', () => near(zerosOf('gamma(x)', -3.5, 0.5).zeros, [-3, -2, -1, 0]))
  it('marks piecewise and domain seams as seams', () => {
    const r = zerosOf('{0 < x <= 3: 2}', -1, 4)
    near(r.zeros, [0, 3])
    expect(r.zeros.every((z) => z.origin === 'seam')).toBe(true)
  })
  it('resolves parameters and user functions', () => {
    near(zerosOf('f(x)', -5, 5, 'f(x) = 1/(x - a)\n@param a = 2 range [0, 5]').zeros, [2])
  })
  it('gives both ends of a stretch where a generator is zero (1/floor(x))', () => {
    const ts = zerosOf('1/floor(x)', -0.5, 1.5).zeros.map((z) => z.t)
    expect(ts.some((t) => Math.abs(t) < 1e-9)).toBe(true)
    expect(ts.some((t) => Math.abs(t - 1) < 1e-9)).toBe(true)
  })
  it('stops at the cap where zeros accumulate (tan(1/x)) and says so', () => {
    const r = zerosOf('tan(1/x)', -1, 1)
    expect(r.truncated).toBe(true)
    expect(r.zeros.length).toBeLessThanOrEqual(64)
  })
  it('counts its evaluations and is deterministic', () => {
    const scope = scopeOf()
    const a = { points: 0, intervals: 0 }
    const b = { points: 0, intervals: 0 }
    const gens = troubleGenerators(expr('tan(x) + 1/(x - 1)'), 'x', scope)
    expect(locateZeros(gens, 'x', scope, -5, 5, a)).toEqual(locateZeros(gens, 'x', scope, -5, 5, b))
    expect(a).toEqual(b)
    expect(a.intervals).toBeGreaterThan(0)
  })
})

describe('locateZeros, beyond the table', () => {
  it('reports a stretch of zeros by its two ends, without running out of budget (1/(floor(x) - 3))', () => {
    // floor(x) - 3 is zero on all of [3, 4): no sign change and no point, so a
    // bisection to the last double would never finish. Its ends are the answer.
    const r = zerosOf('1/(floor(x) - 3)', 2.5, 4.5)
    near(r.zeros, [3, 4])
    expect(r.truncated).toBe(false)
  })
  it('finds where a stretch of zeros ends when the range starts inside it (1/max(x - 1, 0))', () => {
    // The generator is zero on all of [0, 1]; its end at 1 is the trouble spot, and
    // the start of the range, inside the stretch, is the sampler's.
    const r = zerosOf('1/max(x - 1, 0)', 0, 3)
    near(r.zeros, [1])
    expect(r.truncated).toBe(false)
  })
  it('does not call an ordinary range truncated', () => {
    for (const text of ['tan(x)', 'floor(x)', 'gamma(x)', '1/x^2']) expect(zerosOf(text, -3.5, 3.5).truncated, text).toBe(false)
  })
  it('leaves a zero at the very end of the range to the sampler', () => {
    expect(zerosOf('ln(x)', 0, 2).zeros).toEqual([])
    expect(zerosOf('ln(x)', -2, 0).zeros).toEqual([])
  })
  it('joins the zeros two generators share, a seam winning and both reasons kept', () => {
    // 2x - 2 and x - 1 are different generators with the same zero.
    const r = zerosOf('{x < 1: 1/(2x - 2), 0}', -1, 3)
    near(r.zeros, [1])
    expect(r.zeros[0].origin).toBe('seam')
    expect(r.zeros[0].why.split('+').sort()).toEqual(['condition', 'denominator'])
  })
  it('keeps a natural origin when no seam shares the zero', () => {
    const r = zerosOf('1/(x - 1) + ln(x - 2)', 0, 4)
    near(r.zeros, [1, 2])
    expect(r.zeros.map((z) => [z.origin, z.why])).toEqual([
      ['natural', 'denominator'],
      ['natural', 'ln domain'],
    ])
  })
  it('finds a double zero a generator has by cancellation, and the zeros of a long product', () => {
    near(zerosOf('1/(x - 2)^2', 0, 4).zeros, [2])
    near(zerosOf('1/((x - 1)(x - 2)(x - 3))', 0, 4).zeros, [1, 2, 3])
  })
  it('locates a zero near a large t to the same relative precision', () => {
    near(zerosOf('1/(x - 123456.789)', 123000, 124000).zeros, [123456.789])
  })
  it('spends nothing on no generators', () => {
    const counter = { points: 0, intervals: 0 }
    expect(locateZeros([], 'x', scopeOf(), -1, 1, counter)).toEqual({ zeros: [], truncated: false })
    expect(counter).toEqual({ points: 0, intervals: 0 })
  })
  it('does not swallow an error from compiling a generator', () => {
    const scope = scopeOf()
    const gens = [{ expr: expr('1/(x - nope)'), origin: 'natural' as const, why: 'denominator' }]
    expect(() => locateZeros(gens, 'x', scope, -1, 1, { points: 0, intervals: 0 })).toThrow(/nope/)
  })
})
