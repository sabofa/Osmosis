import { describe, expect, it, vi } from 'vitest'
import { parseExprString as p } from '../../parser/parseExpr'
import { compileScalar } from '../compile'
import { makeScope } from '../scope'
import { erf, erfc, gamma } from '../special'
import { CONTINUOUS, DEFINED, iv, PARTIAL, UNKNOWN } from './core'
import type { Twin } from './elementary'
import { box, checkAround, checkComposed, doublesIn, fmt, interval, isEmptyIv, must, nextDown, nextUp, pointsOf, run1, run2, sameIv as same, show, signOf, stepDoubles, within, withZeroSigns } from './compose.testkit'
import * as X from './special'
import { mulberry32, pointsIn, randomBox } from './testkit'

// The sweeps are a second or two on a quiet machine; the default 5 s is for a loaded one.
vi.setConfig({ testTimeout: 60_000 })

const GMIN = 0.8856031944108887
const X0 = 1.4616321449683622
const WHOLE = { lo: -Infinity, hi: Infinity }

describe('gamma is tight and honest on simple boxes', () => {
  it('a pole in the box makes it partial, and the whole line', () => {
    expect(run1(X.gammaT, -0.5, 0.5).v).toBe(PARTIAL) // pole at 0
    expect(run1(X.gammaT, -3, -2.5).v).toBe(PARTIAL) // pole at -3 (an end)
    expect(run1(X.gammaT, -3.5, -2.5)).toMatchObject({ ...WHOLE, v: PARTIAL })
    expect(run1(X.gammaT, -Infinity, 1)).toMatchObject({ ...WHOLE, v: PARTIAL })
    expect(run1(X.gammaT, -2, -1)).toMatchObject({ ...WHOLE, v: PARTIAL })
  })

  it('on (0, inf) it falls to its minimum at 1.4616 and then rises', () => {
    const g = run1(X.gammaT, 1, 3) // min inside: [GMIN, 2]
    expect(g.v === CONTINUOUS && Math.abs(g.lo - GMIN) < 1e-12 && Math.abs(g.hi - 2) < 1e-12).toBe(true)
    expect(within(run1(X.gammaT, 5, 10), 24, 362880, 1e-6)).toBe(true)
    expect(run1(X.gammaT, 5, 10).v).toBe(CONTINUOUS)
    // decreasing below the minimum: the high end is at the low end of the box
    expect(within(run1(X.gammaT, 0.5, 1), 1, Math.sqrt(Math.PI), 1e-12)).toBe(true)
    // a point is its value
    expect(within(run1(X.gammaT, 5, 5), 24, 24, 1e-11)).toBe(true)
    expect(within(run1(X.gammaT, 0.5, 0.5), Math.sqrt(Math.PI), Math.sqrt(Math.PI), 1e-12)).toBe(true)
    // the minimum is the minimum
    expect(Math.abs(gamma(X0) - GMIN)).toBeLessThan(1e-14)
    expect(gamma(nextUp(X0))).toBeGreaterThanOrEqual(GMIN * (1 - 1e-14))
  })

  it('on the negative side between poles the reflection gives a continuous, one-signed answer', () => {
    const neg = run1(X.gammaT, -0.9, -0.1) // reflection branch, continuous, negative
    expect(neg.v === CONTINUOUS && neg.hi < 0).toBe(true)
    expect(neg.lo).toBeLessThan(-10.6)
    const pos = run1(X.gammaT, -1.9, -1.1) // between -2 and -1 gamma is positive
    expect(pos.v === CONTINUOUS && pos.lo > 0).toBe(true)
    // gamma(-2.5) = -0.9453087204829419
    const point = run1(X.gammaT, -2.5, -2.5)
    expect(point.v).toBe(CONTINUOUS)
    expect(within(point, -0.9453087204829419, -0.9453087204829419, 1e-9)).toBe(true)
  })

  it('a box of one pole is NaN everywhere: empty', () => {
    for (const z of [0, -0, -1, -2, -17]) expect(isEmptyIv(run1(X.gammaT, z, z)), `${fmt(z)}`).toBe(true)
    expect(isEmptyIv(run1(X.gammaT, -0, 0))).toBe(true)
    expect(isEmptyIv(run1(X.gammaT, -Infinity, -Infinity))).toBe(true)
  })

  it('a box that starts at 0 holds the large values just above it, and is partial there', () => {
    for (const z of [0, -0]) {
      const r = run1(X.gammaT, z, 2)
      expect(r.v).toBe(PARTIAL)
      expect(r.hi).toBe(Infinity)
      expect(Math.abs(r.lo - GMIN)).toBeLessThan(1e-12)
    }
    expect(run1(X.gammaT, 0, 0.5).hi).toBe(Infinity)
    expect(run1(X.gammaT, 0, 0.5).lo).toBeGreaterThan(1.77)
  })

  it('overflow keeps the verdict: gamma is huge past 171.62, not undefined', () => {
    for (const [lo, hi] of [[172, 172], [171.5, 200], [1, 1000], [180, Infinity], [Infinity, Infinity]] as [number, number][]) {
      const r = run1(X.gammaT, lo, hi)
      expect(r.hi, `[${lo}, ${hi}]`).toBe(Infinity)
      expect(r.v, `[${lo}, ${hi}]`).toBe(CONTINUOUS)
    }
    expect(run1(X.gammaT, 171, 171).hi).toBeLessThan(1e307 * 8)
    expect(run1(X.gammaT, 5e-324, 5e-324)).toMatchObject({ lo: Infinity, hi: Infinity, v: CONTINUOUS })
    // far below zero the reflection underflows: the answer holds the zeros, not an infinity
    const far = run1(X.gammaT, -1000.4, -1000.1)
    expect(far.v).toBe(CONTINUOUS)
    expect(far.lo).toBeLessThan(0)
    expect(far.hi).toBeGreaterThan(0)
    expect(far.hi).toBeLessThan(1e-300)
  })

  it('an unknown or weak input keeps its verdict', () => {
    const out = iv()
    X.gammaT(out, [iv(2, 3, DEFINED)], 'radians')
    expect(out.v).toBe(DEFINED)
    X.gammaT(out, [iv(-0.9, -0.1, DEFINED)], 'radians')
    expect(out.v).toBe(DEFINED)
    X.gammaT(out, [iv(2, 3, PARTIAL)], 'radians')
    expect(out.v).toBe(PARTIAL)
    X.gammaT(out, [iv(-Infinity, Infinity, UNKNOWN)], 'radians')
    expect(out.v).toBe(UNKNOWN)
    X.gammaT(out, [iv(2, 3, UNKNOWN)], 'radians')
    expect(out.v).toBe(UNKNOWN)
  })
})

describe('erf and erfc are tight and honest on simple boxes', () => {
  it('erf over [0, 1] is [0, erf(1)], and erfc over [0, 1] is [erfc(1), 1]', () => {
    const e = run1(X.erfT, 0, 1)
    expect(within(e, 0, 0.8427007929497149, 1e-12) && e.v === CONTINUOUS).toBe(true)
    expect(signOf(e.lo)).toBe('+0')
    const c = run1(X.erfcT, 0, 1)
    expect(within(c, 0.15729920705028513, 1, 1e-12) && c.v === CONTINUOUS).toBe(true)
  })

  it('both are bounded by their limits and keep their ends at the infinities', () => {
    expect(run1(X.erfT, -Infinity, Infinity)).toMatchObject({ lo: -1, hi: 1, v: CONTINUOUS })
    expect(run1(X.erfT, 10, 20).hi).toBe(1)
    expect(run1(X.erfT, -20, -10).lo).toBe(-1)
    expect(run1(X.erfcT, -Infinity, Infinity)).toMatchObject({ lo: 0, hi: 2, v: CONTINUOUS })
    expect(run1(X.erfcT, 30, 40)).toEqual({ lo: 0, hi: 0, v: CONTINUOUS })
    expect(signOf(run1(X.erfcT, 30, Infinity).lo)).toBe('+0')
    expect(run1(X.erfcT, -20, -10).hi).toBe(2)
  })

  it('a zero image stays the zero it is', () => {
    expect(signOf(run1(X.erfT, 0, 1).lo)).toBe('+0')
    expect(signOf(run1(X.erfT, -0, 1).lo)).toBe('-0')
    expect(signOf(run1(X.erfT, -1, -0).hi)).toBe('-0')
    expect(signOf(run1(X.erfT, -1, 0).hi)).toBe('+0')
    expect(signOf(run1(X.erfT, -0, -0).lo) + signOf(run1(X.erfT, -0, -0).hi)).toBe('-0-0')
  })

  it('erfc switches branch at 2.5, as the scalar does (the twin widens the 1 - erf branch by its absolute error)', () => {
    const below = nextDown(2.5)
    expect(erfc(below)).toBe(1 - erf(below))
    expect(erfc(2.5)).not.toBe(1 - erf(2.5))
    // a box holding only the fraction branch is bounded to a relative error
    const r = run1(X.erfcT, 3, 4)
    expect(r.lo / erfc(4)).toBeGreaterThan(1 - 1e-13)
    // a box holding the 1 - erf branch carries the absolute error of that branch
    const s = run1(X.erfcT, 1, 2)
    expect(s.lo).toBeLessThan(erfc(2) - 1e-15)
    expect(s.lo).toBeGreaterThan(erfc(2) - 1e-13)
  })
})

describe('the integer functions are exact on a point and unknown on a box', () => {
  const twins: [string, Twin][] = [['choose', X.chooseT], ['perm', X.permT], ['gcd', X.gcdT], ['lcm', X.lcmT]]

  it('choose, perm, gcd and lcm over a single point are that value', () => {
    expect(run2(X.chooseT, [5, 5], [2, 2])).toEqual({ lo: 10, hi: 10, v: CONTINUOUS })
    expect(run2(X.permT, [5, 5], [2, 2])).toEqual({ lo: 20, hi: 20, v: CONTINUOUS })
    expect(run2(X.gcdT, [12, 12], [18, 18])).toEqual({ lo: 6, hi: 6, v: CONTINUOUS })
    expect(run2(X.lcmT, [4, 4], [6, 6])).toEqual({ lo: 12, hi: 12, v: CONTINUOUS })
    expect(run2(X.chooseT, [0, 0], [0, 0])).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
    // gamma beyond the integers
    expect(within(run2(X.chooseT, [5.5, 5.5], [2, 2]), choose55(), choose55(), 1e-9)).toBe(true)
  })

  it('over a wider box there is no cheap enclosure', () => {
    for (const [name, t] of twins) {
      expect(run2(t, [2, 5], [2, 2]), name).toEqual({ lo: -Infinity, hi: Infinity, v: UNKNOWN })
      expect(run2(t, [5, 5], [1, 3]), name).toEqual({ lo: -Infinity, hi: Infinity, v: UNKNOWN })
    }
  })

  it('a NaN point is empty, and an overflow keeps its verdict', () => {
    expect(isEmptyIv(run2(X.gcdT, [2.5, 2.5], [3, 3]))).toBe(true)
    expect(isEmptyIv(run2(X.lcmT, [2, 2], [3.5, 3.5]))).toBe(true)
    expect(isEmptyIv(run2(X.gcdT, [Infinity, Infinity], [3, 3]))).toBe(true)
    const big = run2(X.chooseT, [2000, 2000], [1000, 1000])
    expect(big.lo).toBe(Infinity)
    expect(big.v).toBe(CONTINUOUS)
  })

  it('the box [-0, +0] holds both zeros and gives the hull of the scalar at both', () => {
    const r = run2(X.lcmT, [-0, 0], [3, 3])
    expect(r.lo <= 0 && 0 <= r.hi).toBe(true)
    expect(r.v).toBe(CONTINUOUS)
  })

  it('a weaker verdict than the point is kept', () => {
    const out = iv()
    X.gcdT(out, [iv(12, 12, PARTIAL), box(18, 18)], 'radians')
    expect(out).toEqual({ lo: 6, hi: 6, v: PARTIAL })
    X.chooseT(out, [iv(5, 5, DEFINED), box(2, 2)], 'radians')
    expect(out.v).toBe(DEFINED)
  })
})

function choose55(): number {
  return gamma(6.5) / (gamma(3) * gamma(4.5))
}

// ---------------------------------------------------------------------------
// Soundness against the scalar compile.
// ---------------------------------------------------------------------------

const UNARY = ['gamma', 'erf', 'erfc'] as const
const TWINS: Record<(typeof UNARY)[number], Twin> = { gamma: X.gammaT, erf: X.erfT, erfc: X.erfcT }

// A box for the special functions: a centre anywhere in [-lo, hi] and a width from 1e-9 to 6.
function specialBox(rand: () => number, lo: number, hi: number): [number, number] {
  const c = lo + (hi - lo) * rand()
  const w = rand() < 0.1 ? 0 : Math.pow(10, rand() * 9.8 - 9)
  const a = c - w * rand()
  return [a, a + w]
}

describe('gamma, erf and erfc are sound over random boxes', () => {
  for (const name of UNARY) {
    it(name, () => {
      const rand = mulberry32(name.length * 7919 + name.charCodeAt(1))
      const f = compileScalar(p(`${name}(x)`), ['x'], makeScope())
      for (let i = 0; i < 500; i++) {
        const [lo, hi] = randomBox(rand)
        const r = run1(TWINS[name], lo, hi)
        for (const x of pointsIn(lo, hi, rand, 6)) must(r, f(x), () => `${name} [${lo}, ${hi}] at ${x} gives ${f(x)}, twin ${show(r)}`)
      }
    })
  }

  it('gamma over boxes where it varies: below zero between the poles, and up to its overflow', () => {
    const rand = mulberry32(2718)
    const f = compileScalar(p('gamma(x)'), ['x'], makeScope())
    for (const [from, to, count] of [[-40, 0, 1500], [0, 1, 800], [0.4, 3, 800], [1, 30, 800], [30, 175, 1200], [-176, -30, 600]] as [number, number, number][]) {
      for (let i = 0; i < count; i++) {
        const [lo, hi] = specialBox(rand, from, to)
        const r = run1(X.gammaT, lo, hi)
        for (const x of pointsIn(lo, hi, rand, 8)) must(r, f(x), () => `gamma [${lo}, ${hi}] at ${x} gives ${f(x)}, twin ${show(r)}`)
      }
    }
  })

  it('erf and erfc over boxes where they vary', () => {
    const rand = mulberry32(31415)
    const fe = compileScalar(p('erf(x)'), ['x'], makeScope())
    const fc = compileScalar(p('erfc(x)'), ['x'], makeScope())
    for (const [from, to, count] of [[-3, 3, 2000], [2.3, 2.7, 1500], [2.5, 8, 800], [-8, -2.4, 800], [8, 30, 500]] as [number, number, number][]) {
      for (let i = 0; i < count; i++) {
        const [lo, hi] = specialBox(rand, from, to)
        const re = run1(X.erfT, lo, hi)
        const rc = run1(X.erfcT, lo, hi)
        for (const x of pointsIn(lo, hi, rand, 8)) {
          must(re, fe(x), () => `erf [${lo}, ${hi}] at ${x} gives ${fe(x)}, twin ${show(re)}`)
          must(rc, fc(x), () => `erfc [${lo}, ${hi}] at ${x} gives ${fc(x)}, twin ${show(rc)}`)
        }
      }
    }
  })

  it('choose, perm, gcd and lcm over pairs of boxes', () => {
    const rand = mulberry32(161803)
    const scope = makeScope()
    const names = ['choose', 'perm', 'gcd', 'lcm'] as const
    const fs = names.map((n) => compileScalar(p(`${n}(x, y)`), ['x', 'y'], scope))
    const twins = [X.chooseT, X.permT, X.gcdT, X.lcmT]
    const whole = () => Math.round((rand() * 2 - 1) * 12)
    for (let i = 0; i < 600; i++) {
      // mostly points (whole or not), some boxes
      const pick = (): [number, number] => {
        const k = rand()
        if (k < 0.5) {
          const x = whole()
          return [x, x]
        }
        if (k < 0.7) {
          const x = (rand() * 2 - 1) * 12
          return [x, x]
        }
        return randomBox(rand)
      }
      const a = pick()
      const b = pick()
      twins.forEach((t, k) => {
        const r = run2(t, a, b)
        for (const x of pointsIn(a[0], a[1], rand, 3)) {
          for (const y of pointsIn(b[0], b[1], rand, 3)) must(r, fs[k](x, y), () => `${names[k]} x [${a}] y [${b}] at (${x}, ${y}) gives ${fs[k](x, y)}, twin ${show(r)}`)
        }
      })
    }
  })
})

// ---------------------------------------------------------------------------
// Edge boxes.
// ---------------------------------------------------------------------------

describe('gamma, erf and erfc are sound on the edge boxes', () => {
  const NEG_POLES = [-1, -2, -3, -5, -10, -30, -100, -170, -171, -172, -200]
  const GAMMA_BOXES: [number, number][] = [
    [-Infinity, Infinity], [0, Infinity], [-Infinity, 0], [1, Infinity], [-Infinity, -1], [-0, Infinity], [-Infinity, -0], [Infinity, Infinity], [-Infinity, -Infinity], [0.5, Infinity],
    [0, 0], [-0, 0], [-0, -0], [-0, 2], [0, 2], [-2, 0], [-2, -0], [0, 1e-300], [-1e-300, -0], [-1e-300, 1e-300], [-5e-324, 5e-324], [0, 5e-324], [-5e-324, -0], [5e-324, 5e-324],
    [-5e-324, -5e-324], [5e-324, 1], [1e-310, 1], [1e-300, 1e-290], [1e-320, 1e-310], [-1e-300, -5e-324], [-1e-310, -5e-324], [-1e-16, -1e-17], [-1e-10, -1e-12], [1e-16, 1e-10],
    [-1, 1], [0, 1], [-1, 0], [-1, -0.5], [-1, -1], [-1.5, -1.5], [-0.9, -0.1], [-0.5, -0], [-0.5, 0.5], [-3, -2.5], [-2.5, -2.1], [-3.5, -3.1], [-3.5, -2.5], [-2.5, -2.5], [-2.9, -2.1], [-0.99, -0.01],
    [0.25, 0.75], [0.5, 0.5], [nextDown(0.5), nextUp(0.5)], [nextDown(0.5), 0.5], [0.5, nextUp(0.5)], [0.3, 0.6], [0.1, 0.5], [0.001, 0.5],
    [1, 3], [1.4, 1.5], [X0, X0], [nextDown(X0), nextUp(X0)], [nextUp(X0), 2], [1, X0], [X0, 2], [nextDown(X0), X0], [1, 2], [2, 3], [1, 1], [2, 2], [3, 3], [5, 5], [5, 10], [20, 25], [24.5, 25.5],
    [100, 120], [170, 171.7], [171, 172], [171, 171], [172, 172], [171.5, 171.7], [171.6, 171.65], [171.62, 171.63], [171.7, 171.8], [nextDown(171.7), nextUp(171.7)], [172, 1e300], [100, Infinity], [1, 1000],
    [-171.5, -170.5], [-172.5, -171.5], [-170.7, -170.6], [-171, -170.5], [-200.3, -200.1], [-1000.4, -1000.1], [-1e6 - 0.5, -1e6 - 0.4], [-340000.5, -340000.4], [-0.5 - 2 ** 20, -(2 ** 20)],
    [-(2 ** 52) + 0.5, -(2 ** 52) + 1.5], [-1e300, -1e299], [-1e300, 1e300], [-(2 ** 53), -(2 ** 52)],
    ...NEG_POLES.flatMap((k): [number, number][] => [[k, k], [nextDown(k), nextUp(k)], [k, nextUp(k)], [nextDown(k), k], [k - 0.5, k + 0.5], [k + 0.1, k + 0.9], [k - 0.9, k - 0.1], [k + 1e-10, k + 1e-5], [k - 1e-5, k - 1e-10]]),
  ]
  const ERF_BOXES: [number, number][] = [
    [-Infinity, Infinity], [0, Infinity], [-Infinity, 0], [-0, Infinity], [-Infinity, -0], [Infinity, Infinity], [-Infinity, -Infinity], [0, 0], [-0, 0], [-0, -0], [-0, 1], [0, 1], [-1, -0], [-1, 0], [-1, 1],
    [5e-324, 5e-324], [-5e-324, 5e-324], [0, 5e-324], [-5e-324, -0], [1e-300, 1e-290], [1e-10, 1e-9],
    [0.5, 1], [1, 2], [2, 2.4], [2.4, 2.6], [2.5, 2.5], [nextDown(2.5), nextUp(2.5)], [nextDown(2.5), 2.5], [2.5, nextUp(2.5)], [2.49, 2.51], [-2.51, -2.49], [-nextUp(2.5), -nextDown(2.5)],
    [2, 3], [2.5, 3], [3, 4], [5, 6], [6, 6.1], [10, 20], [26, 28], [26.5, 27.5], [27, 27], [27.2, 27.3], [27.3, 100], [-30, -26], [-3, 3], [-27.3, 27.3], [-2.5, 2.5], [-1e-3, 1e-3], [1e300, 1e300], [-1e300, 1e300],
    [-8, -2.4], [-2.4, -1], [-6, -2.5], [-1, -1], [1, 1], [2, 2], [2.4, 2.4], [3, 3], [-2, -2],
  ]

  const cases: [(typeof UNARY)[number], [number, number][]][] = [['gamma', GAMMA_BOXES], ['erf', ERF_BOXES], ['erfc', ERF_BOXES]]
  for (const [name, boxes] of cases) {
    it(name, () => {
      const rand = mulberry32(2026 + name.length)
      const f = compileScalar(p(`${name}(x)`), ['x'], makeScope())
      for (const [lo, hi] of boxes) {
        for (const [l, h] of withZeroSigns(lo, hi)) {
          const r = run1(TWINS[name], l, h)
          for (const x of pointsOf(l, h, rand, 6)) {
            const y = f(x)
            must(r, y, () => `${name} over [${fmt(l)}, ${fmt(h)}] at ${fmt(x)} gives ${fmt(y)}, twin ${show(r)}`)
          }
        }
      }
    })
  }

  it('gamma at the doubles around every negative pole, and around the overflow', () => {
    const rand = mulberry32(5150)
    const f = compileScalar(p('gamma(x)'), ['x'], makeScope())
    const centres = [...Array.from({ length: 60 }, (_, i) => -i), 171, 171.6243, 171.62, 171.7, 0.5, X0]
    for (let trial = 0; trial < 3000; trial++) {
      const c = centres[Math.floor(rand() * centres.length)]
      let lo = c
      let hi = c
      for (let i = Math.floor(rand() * 6); i > 0; i--) lo = nextDown(lo)
      for (let i = Math.floor(rand() * 6); i > 0; i--) hi = nextUp(hi)
      if (rand() < 0.3) hi = c + Math.pow(10, -rand() * 12)
      if (rand() < 0.3) lo = c - Math.pow(10, -rand() * 12)
      const pts = [lo, hi, c, ...zerosOf(lo, hi)]
      let x = c
      for (let i = 0; i < 4; i++) pts.push((x = nextDown(x)))
      x = c
      for (let i = 0; i < 4; i++) pts.push((x = nextUp(x)))
      pts.push(lo + (hi - lo) * rand())
      for (const [l, h] of withZeroSigns(lo, hi)) {
        const r = run1(X.gammaT, l, h)
        for (const v of pts) if (l <= v && v <= h) must(r, f(v), () => `gamma over [${fmt(l)}, ${fmt(h)}] at ${fmt(v)} gives ${fmt(f(v))}, twin ${show(r)}`)
      }
    }
  })

  it('choose, perm, gcd and lcm over pairs of edge points and boxes', () => {
    const rand = mulberry32(8)
    const scope = makeScope()
    const VALUES = [-Infinity, -1e20, -7, -3, -2.5, -1, -0.5, -0, 0, 0.5, 1, 2, 2.5, 3, 4, 6, 7, 12, 170, 171, 172, 1000, 2 ** 53, 1e20, 1e300, Infinity]
    const names = ['choose', 'perm', 'gcd', 'lcm'] as const
    const fs = names.map((n) => compileScalar(p(`${n}(x, y)`), ['x', 'y'], scope))
    const twins = [X.chooseT, X.permT, X.gcdT, X.lcmT]
    for (const a of VALUES) {
      for (const b of VALUES) {
        twins.forEach((t, k) => {
          const r = run2(t, [a, a], [b, b])
          const v = fs[k](a, b)
          must(r, v, () => `${names[k]}(${fmt(a)}, ${fmt(b)}) gives ${fmt(v)}, twin ${show(r)}`)
        })
      }
    }
    // boxes holding the values
    for (const [al, ah] of [[-Infinity, Infinity], [0, 5], [-3, 3], [2, 2.5], [-0, 0], [1, Infinity], [-Infinity, -1]] as [number, number][]) {
      for (const b of VALUES) {
        twins.forEach((t, k) => {
          const r = run2(t, [al, ah], [b, b])
          for (const x of pointsOf(al, ah, rand, 3)) must(r, fs[k](x, b), () => `${names[k]} a [${al}, ${ah}] b ${fmt(b)} at ${fmt(x)} gives ${fmt(fs[k](x, b))}, twin ${show(r)}`)
        })
      }
    }
  })
})

// Windows of consecutive doubles, every double of the box tried: the scalar is not exactly
// monotone (the exact products at the whole numbers meet the Lanczos neighbours; the 1 - erf
// branch of erfc and the series of erf carry the rounding of exp(-x^2)), and that shows only
// where the box is a few ulps wide. The widenings of the twins are 4.5x to 7x what this finds.
describe('gamma, erf and erfc over windows of consecutive doubles', () => {
  const windows = (name: string, twin: Twin, f: (x: number) => number, centre: () => number, trials: number, spread: number) => {
    const rand = mulberry32(name.length * 104729 + trials)
    for (let t = 0; t < trials; t++) {
      const c = centre()
      const lo = stepDoubles(c, -Math.floor(rand() * spread))
      const hi = stepDoubles(c, Math.floor(rand() * spread))
      const out = run1(twin, lo, hi)
      for (const x of doublesIn(lo, hi, 60)) must(out, f(x), () => `${name} over [${fmt(lo)}, ${fmt(hi)}] at ${fmt(x)} gives ${fmt(f(x))}, twin ${show(out)}`)
      must(out, f(hi), () => `${name} at the high end ${fmt(hi)}, twin ${show(out)}`)
    }
  }
  const uniform = (rand: () => number, lo: number, hi: number) => () => lo + (hi - lo) * rand()

  it('gamma: the top, the middle, below 1/2, the whole numbers, the minimum, the overflow, the poles', () => {
    const rand = mulberry32(1729)
    windows('gamma top', X.gammaT, gamma, uniform(rand, 100, 171.7), 4000, 40)
    windows('gamma mid', X.gammaT, gamma, uniform(rand, 5, 100), 3000, 40)
    windows('gamma low', X.gammaT, gamma, uniform(rand, 0.5, 5), 3000, 40)
    windows('gamma sub', X.gammaT, gamma, uniform(rand, 0.001, 0.5), 3000, 40)
    windows('gamma neg', X.gammaT, gamma, uniform(rand, -40, -0.001), 3000, 40)
    windows('gamma whole', X.gammaT, gamma, () => Math.round(2 + rand() * 169), 4000, 40)
    windows('gamma negative whole', X.gammaT, gamma, () => -Math.round(rand() * 60), 4000, 40)
    windows('gamma minimum', X.gammaT, gamma, () => X0, 500, 400)
    windows('gamma branch at 1/2', X.gammaT, gamma, () => 0.5, 500, 400)
    windows('gamma overflow', X.gammaT, gamma, uniform(rand, 171.62, 171.72), 1000, 40)
  })

  it('erf and erfc: below, at and above the switch of erfc, and the tail', () => {
    const rand = mulberry32(2048)
    for (const [name, lo, hi] of [['a', 0.001, 0.5], ['b', 0.5, 1.5], ['c', 1.5, 2.5], ['d', 2.49, 2.51], ['e', 2.5, 6], ['f', 6, 27.5], ['g', -6, -0.001]] as [string, number, number][]) {
      windows(`erf ${name}`, X.erfT, erf, uniform(rand, lo, hi), 4000, 40)
      windows(`erfc ${name}`, X.erfcT, erfc, uniform(rand, lo, hi), 4000, 40)
    }
    windows('erfc switch', X.erfcT, erfc, () => 2.5, 1000, 60)
  })
})

function zerosOf(lo: number, hi: number): number[] {
  const out: number[] = []
  if (lo <= 0 && 0 <= hi) out.push(0, -0)
  return out
}

// ---------------------------------------------------------------------------
// Composition.
// ---------------------------------------------------------------------------

describe('composed special twins stay sound', () => {
  const ONE_VAR = [
    'gamma(1/x)', '1/gamma(x)', '1/gamma(1/x)', 'gamma(x + 1)', 'gamma(x - 1)', 'gamma(x)*gamma(1 - x)', 'gamma(x)/gamma(x + 1)', 'gamma(x + 1)/gamma(x)', 'gamma(-x)', 'gamma(x)*gamma(-x)',
    'gamma(abs(x))', 'gamma(x^2)', 'gamma(x^2 + 1)', 'gamma(exp(x))', 'gamma(ln(x))', 'gamma(sqrt(x))', 'gamma(sin(x))', 'gamma(1/x)^-1', 'gamma(floor(x))', 'gamma(ceil(x))', 'gamma(round(x))',
    'gamma(sign(x))', 'gamma(step(x))', 'gamma(gamma(x))', 'gamma(erf(x))', 'gamma(erfc(x))', 'gamma(x)^2', 'gamma(x)^-1', 'ln(gamma(x))', 'sqrt(gamma(x))', 'exp(gamma(x))', 'exp(-gamma(x))',
    'atan(gamma(x))', 'sin(gamma(x))', 'gamma(x)*0', 'gamma(x) - gamma(x)', 'gamma(x)/gamma(x)', 'abs(gamma(x))', 'floor(gamma(x))', 'ceil(gamma(x))', 'sign(gamma(x))', 'step(gamma(x))',
    'min(gamma(x), 1)', 'max(gamma(x), 1)', 'mod(gamma(x), 1)', 'hypot(gamma(x), 1)', 'gamma(x + 0.5)', 'gamma(x + 170)', 'gamma(171.5 + x)', 'gamma(x - 170)', 'gamma(1/x + 171)',
    'erf(1/x)', '1/erf(x)', '1/erfc(x)', 'erfc(1/x)', 'erf(x)/x', 'erfc(x)/x', 'erf(x)^-1', 'erfc(x)^-1', 'erfc(erf(x))', 'erf(erfc(x))', 'erf(erf(x))', 'ln(erfc(x))', 'ln(erf(x))', 'sqrt(erf(x))', 'sqrt(erfc(x))',
    'sqrt(erfc(-x))', 'ln(1 - erf(x))', '1 - erf(x) - erfc(x)', 'erf(x) + erfc(x)', 'erf(x) - erfc(x)', 'erf(x)*erfc(x)', 'erf(-x) + erf(x)', 'erf(x^2)', 'erfc(x^2)', 'erfc(-x^2)', 'erf(exp(x))', 'erfc(exp(x))',
    'erfc(ln(x))', 'erf(ln(x))', 'erf(gamma(x))', 'erfc(gamma(x))', 'erf(sin(x))', 'erf(tan(x))', 'exp(-x^2)/erfc(x)', 'exp(x^2)*erfc(x)', 'exp(x^2)*erfc(x)/x', 'erf(floor(x))', 'erfc(ceil(x))', 'erf(sign(x))',
    'erf(round(x))', 'erfc(step(x))', 'atanh(erf(x))', 'acosh(1 + erfc(x))', 'asin(erf(x))', 'acos(erf(x))', 'asin(erfc(x))', 'acos(erfc(x))', '1/(1 - erf(x))', '1/(1 + erf(x))', '1/(2 - erfc(x))',
    'erf(x)^3', 'erfc(x)^-2', 'tanh(erf(x))', 'cosh(erfc(x))', 'root(3, erf(x))', 'root(2, erfc(x))', 'cbrt(erf(x))', 'atan2(erf(x), erfc(x))', 'atan2(erf(x), -1)', 'atan2(gamma(x), -1)',
    'choose(floor(x), 2)', 'choose(x, 2)', 'perm(floor(x), 2)', 'gcd(round(x), 6)', 'lcm(round(x), 6)', 'gcd(floor(x), ceil(x))', 'lcm(floor(x), 4)', 'choose(5, floor(x))', 'perm(5, ceil(x))',
    '1/choose(x, 2)', '1/perm(x, 2)', '1/gcd(x, 6)', '1/lcm(x, 6)', 'choose(x, x)', 'perm(x, x)', 'gcd(x, x)', 'lcm(x, x)', 'choose(gamma(x), 1)', 'choose(x + 1, 1)',
  ]
  for (const src of ONE_VAR) {
    it(src, () => checkComposed(src))
  }

  // The boxes a few ulps wide around the poles of gamma (0 with both signs, and the negative
  // whole numbers), where a bound that is an infinity, a zero, or a partial verdict has to be right.
  it('1 / gamma, gamma(1/x) and x! around the poles, a few ulps wide', () => {
    const centres = [0, -0, -1, -2, -3, -10, -170, -171, 1, 2, 171, 172, 0.5, 1.4616321449683622]
    for (const src of ['gamma(x)', '1/gamma(x)', 'x*gamma(x)', 'gamma(x + 1)', 'gamma(1/x)', '1/gamma(1/x)', 'gamma(x)*gamma(-x)', 'abs(gamma(x))^-1', 'sqrt(gamma(x))', 'ln(gamma(x))', 'atan2(gamma(x), -1)',
      'gamma(x)/gamma(x + 1)', 'erf(gamma(x))', 'erfc(1/gamma(x))']) checkAround(src, centres)
  })

  it('erf and erfc around 0 and their switch, 1 / erf(x) and erf(1/x) a few ulps wide', () => {
    const centres = [0, -0, 1e-300, -1e-300, 2.5, -2.5, 2.4999999999999996, 27, 27.3, -27]
    for (const src of ['erf(x)', 'erfc(x)', '1/erf(x)', '1/erfc(x)', 'erf(1/x)', 'erfc(1/x)', 'sqrt(erf(x))', 'ln(erfc(x))', 'atan2(erf(x), -1)', 'erf(x)/x', 'erfc(x)^-1', 'ln(erf(x))']) checkAround(src, centres)
  })

  it('x! is gamma(x + 1): exact at whole numbers, and the twin holds the exact value', () => {
    for (const k of [0, 1, 2, 3, 5, 10, 20, 100, 170]) {
      const at = interval(p('gamma(x + 1)'), { x: box(k, k) }, 'radians')
      const f = compileScalar(p('gamma(x + 1)'), ['x'], makeScope())
      expect(at.lo <= f(k) && f(k) <= at.hi, `${k}!`).toBe(true)
      expect(at.v, `${k}!`).toBe(CONTINUOUS)
    }
    // the factorial of -1 is NaN: the point box is partial, and the box through it is
    expect(interval(p('gamma(x + 1)'), { x: box(-1, -1) }, 'radians').v).toBe(PARTIAL)
    expect(interval(p('gamma(x + 1)'), { x: box(-1.5, -0.5) }, 'radians').v).toBeLessThanOrEqual(CONTINUOUS)
  })

  it('x! on a box of whole numbers is tight', () => {
    const f = interval(p('gamma(x + 1)'), { x: box(2, 3) }, 'radians')
    expect(within(f, 2, 6, 1e-9) && f.v === CONTINUOUS).toBe(true)
    const g = interval(p('gamma(x) * gamma(1 - x)'), { x: box(0.25, 0.75) }, 'radians')
    expect(g.v).toBe(CONTINUOUS)
    expect(g.lo).toBeGreaterThan(0)
    const e = interval(p('erf(1/x)'), { x: box(1, 2) }, 'radians')
    expect(within(e, erf(0.5), erf(1), 1e-12) && e.v === CONTINUOUS).toBe(true)
  })

  it('1 / gamma(x) is partial where gamma has a pole, and the whole line there', () => {
    const r = interval(p('1/gamma(x)'), { x: box(-0.5, 0.5) }, 'radians')
    expect(r.v).toBe(PARTIAL)
    expect(r.lo).toBe(-Infinity)
    expect(r.hi).toBe(Infinity)
    // away from a pole 1/gamma is tight: gamma over [1, 3] is [0.8856, 2], and 1/gamma [0.5, 1.129]
    const tight = interval(p('1/gamma(x)'), { x: box(1, 3) }, 'radians')
    expect(within(tight, 0.5, 1 / GMIN, 1e-9)).toBe(true)
    expect(tight.v).toBe(CONTINUOUS)
  })

  it('erf(1/x) near 0 holds the limits at +-1 and the verdict says the box reaches the pole of 1/x', () => {
    const r = interval(p('erf(1/x)'), { x: box(-0.5, 0.5) }, 'radians')
    expect(r.v).toBe(PARTIAL)
    expect(r.lo).toBeLessThanOrEqual(-1 + 1e-14)
    expect(r.hi).toBeGreaterThanOrEqual(1 - 1e-14)
    const pos = interval(p('erf(1/x)'), { x: box(0, 1) }, 'radians')
    expect(pos.hi).toBeLessThanOrEqual(1)
    expect(pos.hi).toBeGreaterThan(1 - 1e-14)
    expect(pos.lo).toBeGreaterThan(0.84)
  })
})

describe('twins read every input before writing out, and keep no state between calls', () => {
  const BOXES_SMALL: [number, number][] = [[0.25, 0.75], [-1, 1], [0, 2], [-0, 1], [1, 5], [-3, -1], [-2.5, -2.1], [3, 3.5], [-Infinity, 1], [0, 0], [-10, 10], [150, 200], [-0.9, -0.1], [2.4, 2.6]]

  it('a unary twin with out aliasing its input gives the fresh answer', () => {
    for (const name of UNARY) {
      for (const [lo, hi] of BOXES_SMALL) {
        const fresh = iv()
        TWINS[name](fresh, [box(lo, hi)], 'radians')
        const a = box(lo, hi)
        TWINS[name](a, [a], 'radians')
        expect(same(a, fresh), `${name} [${fmt(lo)}, ${fmt(hi)}]: ${show(a)} vs ${show(fresh)}`).toBe(true)
      }
    }
  })

  it('a binary twin with out aliasing either input gives the fresh answer', () => {
    const twins: [string, Twin][] = [['choose', X.chooseT], ['perm', X.permT], ['gcd', X.gcdT], ['lcm', X.lcmT]]
    const pts: [number, number][] = [[5, 5], [2, 2], [12, 12], [18, 18], [2.5, 2.5], [-0, 0], [1, 3]]
    for (const [name, twin] of twins) {
      for (const [al, ah] of pts) {
        for (const [bl, bh] of pts) {
          const fresh = iv()
          twin(fresh, [box(al, ah), box(bl, bh)], 'radians')
          const a = box(al, ah)
          twin(a, [a, box(bl, bh)], 'radians')
          expect(same(a, fresh), `${name} aliasing the first`).toBe(true)
          const b = box(bl, bh)
          twin(b, [box(al, ah), b], 'radians')
          expect(same(b, fresh), `${name} aliasing the second`).toBe(true)
        }
      }
    }
  })

  it('gammaOf is the twin, and aliasing it is fine', () => {
    for (const [lo, hi] of BOXES_SMALL) {
      const fresh = iv()
      X.gammaT(fresh, [box(lo, hi)], 'radians')
      const a = box(lo, hi)
      X.gammaOf(a, a)
      expect(same(a, fresh), `[${fmt(lo)}, ${fmt(hi)}]`).toBe(true)
    }
  })

  it('an answer does not depend on which twins ran before it (gamma uses sin and keeps scratch of its own)', () => {
    const rand = mulberry32(4242)
    const jobs: [number, number][] = []
    for (let i = 0; i < 200; i++) jobs.push(specialBox(rand, -30, 30))
    const fresh = jobs.map(([lo, hi]) => run1(X.gammaT, lo, hi))
    for (let i = jobs.length - 1; i >= 0; i--) {
      const [lo, hi] = jobs[i]
      const junk = iv()
      X.erfT(junk, [box(lo, hi)], 'radians')
      X.erfcT(junk, [box(lo, hi)], 'radians')
      X.chooseT(junk, [box(2, 2), box(1, 1)], 'radians')
      interval(p('sin(x) + 1/x'), { x: box(lo, hi) }, 'degrees')
      expect(same(run1(X.gammaT, lo, hi), fresh[i]), `[${lo}, ${hi}]`).toBe(true)
    }
  })
})
