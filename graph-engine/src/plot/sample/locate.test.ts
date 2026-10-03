import { describe, expect, it } from 'vitest'
import { locateZeros } from './locate'
import { troubleGenerators } from './structure'
import { expr, scopeOf } from './testkit'
import { LOCATE } from './tuning'

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
  it('does not trust a box the twin calls zero by its size alone (1/(exp(-700) (x - 0.5)))', () => {
    // The generator is about 1e-304 everywhere, inside the twin's zero band, and has a
    // simple zero at 0.5. Only a scalar that is exactly zero (or NaN) makes a box a stretch.
    near(zerosOf('1/(exp(-700)*(x - 0.5))', 0, 1).zeros, [0.5])
  })
  it('does not let that box hide two zeros between its samples (1/(exp(-700) (x - 0.5)(x - 0.52)))', () => {
    // Both zeros fall between two of a box's 16 samples, and g has the same sign at
    // both of those: only the bisection the scalar check forces finds them both.
    near(zerosOf('1/(exp(-700)*(x - 0.5)*(x - 0.52))', 0, 1).zeros, [0.5, 0.52])
  })
})

// The zeros of 1 - cos and 1 - sin are double, and flat: cos rounds to 1 within 1e-8 of
// them, so there is a plateau of exact zeros and no sign change to bisect. A double zero
// of a flat function is only located to about the square root of the epsilon, which is
// what the 1e-6 here allows. They are also the zeros the twin cannot exclude close to:
// the first of them used to use the budget up and drop every later one.
describe('locateZeros, hard double zeros', () => {
  const TAU = 2 * Math.PI
  it('finds the poles of 1/(1 - cos(x)), all three', () => near(zerosOf('1/(1 - cos(x))', -10, 10).zeros, [-TAU, 0, TAU], 1e-6))
  it('finds the poles of 1/(1 - sin(x)), all three', () => {
    near(zerosOf('1/(1 - sin(x))', -10, 10).zeros, [-3 * Math.PI / 2, Math.PI / 2, 5 * Math.PI / 2], 1e-6)
  })
  it('finds the double zero of an expanded square (1/(x^2 - 2x + 1))', () => near(zerosOf('1/(x^2 - 2*x + 1)', -3, 3).zeros, [1], 1e-6))
  it('does so in a narrow window too, without running out of budget', () => {
    // The twin's band around the double root grows as the window shrinks (about
    // 2 sqrt(2/w) boxes of the coarse width w); the coarse width is sub-pixel, not tiny.
    for (const [t0, t1] of [[0.9, 1.1], [0.5, 1.5], [0.995, 1.005], [0.999, 1.001], [0.9999, 1.0001]]) {
      const r = zerosOf('1/(x^2 - 2*x + 1)', t0, t1)
      near(r.zeros, [1], 1e-6)
      expect(r.truncated, `${t0}..${t1}`).toBe(false)
    }
  })
  // An even zero in a cluster with something else in it. The twin's band round an expanded
  // double root is wide, so on a wide window the root shares a cluster with a simple root
  // or with another double one, and phase 2 used to look for an even zero only in a
  // cluster that held nothing else.
  describe('an even zero that shares its cluster', () => {
    // [expression, windows, [zero, how exactly] ...]: an even zero of an expanded
    // polynomial is only as exact as the polynomial (1e-5); a simple one is exact.
    const EVEN = 1e-5
    const SIMPLE = 1e-11
    const cases: [string, [number, number][], [number, number][]][] = [
      ['1/(x^3 - 4*x^2 + 5*x - 2)', [[-3, 3], [-75, 75], [-300, 300]], [[1, EVEN], [2, SIMPLE]]],
      ['1/((x^2 - 2*x + 1)*(x - 1.03))', [[-3, 3], [-1, 3]], [[1, EVEN], [1.03, SIMPLE]]],
      ['1/(x^4 - 6*x^3 + 13*x^2 - 12*x + 4)', [[-3, 4], [-15, 15], [-75, 75]], [[1, EVEN], [2, EVEN]]],
    ]
    for (const [text, windows, want] of cases) {
      for (const [t0, t1] of windows) {
        it(`finds ${want.map(([w]) => w).join(' and ')} of ${text} on [${t0}, ${t1}]`, () => {
          const r = zerosOf(text, t0, t1)
          expect(r.zeros.map((z) => z.t)).toHaveLength(want.length)
          want.forEach(([w, tol], i) => expect(Math.abs(r.zeros[i].t - w)).toBeLessThan(tol))
          expect(r.truncated).toBe(false)
        })
      }
    }
  })
  it('does so well inside the budget on a view-sized window', () => {
    const scope = scopeOf()
    const counter = { points: 0, intervals: 0 }
    const r = locateZeros(troubleGenerators(expr('1/(x^2 - 2*x + 1)'), 'x', scope), 'x', scope, -3, 3, counter)
    near(r.zeros, [1], 1e-6)
    expect(counter.intervals).toBeLessThan(1500)
  })
  it('reports two zeros closer together than a coarse box, through the sign changes between samples', () => {
    // 1e-4 apart, and the coarse width of [0, 1] is 2.4e-4: one box holds both.
    const r = zerosOf('1/((x - 0.5)*(x - 0.5001))', 0, 1)
    near(r.zeros, [0.5, 0.5001])
    expect(r.truncated).toBe(false)
  })
  it('reports a plateau of exact zeros narrower than the coarse width as one zero (1/(1 - cos(x)) on a narrow window)', () => {
    // cos rounds to 1 within 1e-8 of 0, and on [-0.001, 0.001] the samples fall in that flat
    // spot: it is one pole, not a stretch with an end at each side of it.
    const r = zerosOf('1/(1 - cos(x))', -0.001, 0.001)
    expect(r.zeros).toHaveLength(1)
    expect(Math.abs(r.zeros[0].t)).toBeLessThan(1e-7)
  })
  it('still reports a stretch wider than the coarse width as its two ends', () => {
    // [3, 4) is a million coarse boxes wide on a range of 2 and still a stretch on 2^12.
    near(zerosOf('1/(floor(x) - 3)', 2.5, 4.5).zeros, [3, 4])
  })
  it('finds both families of tan(x) + 1/(1 - cos(x)), the tan poles to full precision', () => {
    const { zeros, truncated } = zerosOf('tan(x) + 1/(1 - cos(x))', -10, 10)
    const half = Math.PI / 2
    near(zeros, [-5 * half, -TAU, -3 * half, -half, 0, half, 3 * half, TAU, 5 * half], 1e-6)
    near(zeros.filter((z) => z.why === 'tan pole'), [-5 * half, -3 * half, -half, half, 3 * half, 5 * half])
    expect(truncated).toBe(false)
  })
  it('finds an even zero next to hard ones and in a window not centred on them', () => {
    near(zerosOf('1/(1 - cos(x)) + 1/(x - 3)^2', 1, 9).zeros, [3, TAU], 1e-6)
  })
  it('is not called truncated for one hard zero', () => {
    expect(zerosOf('1/(x^2 - 2*x + 1)', -3, 3).truncated).toBe(false)
    expect(zerosOf('1/(1 - cos(x))', -10, 10).truncated).toBe(false)
  })
})

describe('locateZeros, budgets', () => {
  it('never spends more twin evaluations than intervalsTotal, whatever the generators', () => {
    // The real budgets are far above what a coarse search needs on any one range, so
    // this one shrinks them: five generators with zeros that never settle, each of
    // which would take its whole 60, against a call total of 150.
    const was = [LOCATE.intervalsPerGenerator, LOCATE.intervalsTotal]
    LOCATE.intervalsPerGenerator = 60
    LOCATE.intervalsTotal = 150
    try {
      const scope = scopeOf()
      const counter = { points: 0, intervals: 0 }
      const text = [0, 0.1, 0.2, 0.3, 0.4].map((s) => `tan(1/(x - ${s}))`).join(' + ')
      const r = locateZeros(troubleGenerators(expr(text), 'x', scope), 'x', scope, -1, 1, counter)
      expect(counter.intervals).toBeLessThanOrEqual(150)
      expect(counter.intervals).toBeGreaterThan(60)
      expect(r.truncated).toBe(true)
      expect(r.zeros.length).toBeLessThanOrEqual(LOCATE.maxZeros)
    } finally {
      ;[LOCATE.intervalsPerGenerator, LOCATE.intervalsTotal] = was
    }
  })
  it('keeps the zeros nearest the centre of the range when there are too many (floor(x) over 141 steps)', () => {
    const r = zerosOf('floor(x)', -70.5, 70.5)
    expect(r.truncated).toBe(true)
    expect(r.zeros).toHaveLength(LOCATE.maxZeros)
    expect(Math.max(...r.zeros.map((z) => Math.abs(z.t)))).toBeLessThanOrEqual(32)
    near(r.zeros.slice(30, 35), [-2, -1, 0, 1, 2])
  })
  it('keeps an unchecked candidate out of budget only if g is exactly 0 there (tan(x) + 1/(x^2 + 1), total of 40)', () => {
    // x^2 + 1 has no zero. With the total spent the twin cannot be asked about the
    // minimum of |g| the samples find at 0, and that must not become a zero.
    const was = LOCATE.intervalsTotal
    LOCATE.intervalsTotal = 40
    try {
      const r = zerosOf('tan(x) + 1/(x^2 + 1)', -5, 5)
      expect(r.truncated).toBe(true)
      for (const z of r.zeros) expect(Math.abs(Math.cos(z.t)), `${z.t}`).toBeLessThan(1e-6)
    } finally {
      LOCATE.intervalsTotal = was
    }
  })
  it('does not drop what a cut search had not reached: the boxes still waiting are looked at with the scalar', () => {
    // One twin evaluation, then out of budget. The whole range is left, as one cluster,
    // and its 16 samples still see the four sign changes of cos(x) in [-5, 5].
    const was = LOCATE.intervalsPerGenerator
    LOCATE.intervalsPerGenerator = 1
    try {
      const r = zerosOf('tan(x)', -5, 5)
      expect(r.truncated).toBe(true)
      near(r.zeros, [-3 * Math.PI / 2, -Math.PI / 2, Math.PI / 2, 3 * Math.PI / 2])
    } finally {
      LOCATE.intervalsPerGenerator = was
    }
  })
  it('says so, and keeps real zeros, when zeros are crowded closer than a coarse box (tan(2000 x) over a view)', () => {
    // The poles are 1.6e-3 apart on a range of 10 whose coarse box is 2.4e-3: the
    // twin cannot separate them and 16 samples cannot count them (and there are far
    // more than 64; the tan(1/x) test above is the one that has fewer and is flagged
    // only for being crowded).
    const r = zerosOf('tan(2000*x)', -5, 5)
    expect(r.truncated).toBe(true)
    for (const z of r.zeros) expect(Math.abs(Math.cos(2000 * z.t))).toBeLessThan(1e-6)
  })
  it('does not call zeros that are well apart crowded, however many (floor(x) over 1001 steps)', () => {
    // 1001 steps is cut by the 64-zero cap, which is the cap and not crowding; 41 steps
    // are not cut at all.
    const r = zerosOf('floor(x)', -500.5, 500.5)
    expect(r.zeros).toHaveLength(LOCATE.maxZeros)
    expect(r.truncated).toBe(true)
    const small = zerosOf('floor(x)', -20.5, 20.5)
    expect(small.zeros).toHaveLength(41)
    expect(small.truncated).toBe(false)
  })
  it('keeps what it found of a generator it ran out of budget on, and flags it', () => {
    // cos(1/x) has no end of zeros; the zeros it did find are real ones.
    const r = zerosOf('tan(1/x)', -1, 1)
    expect(r.truncated).toBe(true)
    for (const z of r.zeros.filter((q) => Math.abs(q.t) > 1e-3)) {
      expect(Math.abs(Math.cos(1 / z.t))).toBeLessThan(1e-6)
    }
  })
})

describe('locateZeros, the rest', () => {
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
