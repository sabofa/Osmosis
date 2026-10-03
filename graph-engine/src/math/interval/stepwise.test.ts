import { describe, expect, it, vi } from 'vitest'
import { parseExprString as p } from '../../parser/parseExpr'
import { compileScalar, floorMod } from '../compile'
import { makeScope } from '../scope'
import { CONTINUOUS, DEFINED, iv, PARTIAL, UNKNOWN, type Iv } from './core'
import type { Twin } from './elementary'
import {
  box, checkAround, checkComposed, doublesIn, fmt, interval, isEmptyIv, must, nextDown, nextUp, pointsOf, run1, run2, sameIv as same, show, signOf, stepDoubles, within, withZeroSigns,
} from './compose.testkit'
import * as S from './stepwise'
import { mulberry32, pointsIn, randomBox, zerosIn } from './testkit'

// The sweeps are a second or two on a quiet machine; the default 5 s is for a loaded one.
vi.setConfig({ testTimeout: 60_000 })

describe('stepwise twins are tight and honest on simple boxes', () => {
  it('floor, ceil, round, sign and step are bounded by their ends, continuous only where they do not jump', () => {
    expect(run1(S.floorT, 0.2, 0.8)).toEqual({ lo: 0, hi: 0, v: CONTINUOUS })
    expect(run1(S.floorT, 0.5, 1)).toMatchObject({ lo: 0, hi: 1, v: DEFINED })
    expect(run1(S.floorT, -1.5, -0.5)).toMatchObject({ lo: -2, hi: -1, v: DEFINED })
    expect(run1(S.floorT, -Infinity, 5)).toMatchObject({ lo: -Infinity, hi: 5, v: DEFINED })
    expect(run1(S.ceilT, 0.5, 1)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
    expect(run1(S.ceilT, 0.5, 1.5)).toMatchObject({ lo: 1, hi: 2, v: DEFINED })
    expect(run1(S.roundT, -2.5, -2.5)).toEqual({ lo: -3, hi: -3, v: CONTINUOUS })
    expect(run1(S.roundT, 0.5, 0.5)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
    expect(run1(S.roundT, 2.4, 2.6)).toMatchObject({ lo: 2, hi: 3, v: DEFINED })
    expect(run1(S.roundT, 2.1, 2.4)).toEqual({ lo: 2, hi: 2, v: CONTINUOUS })
    expect(run1(S.signT, -1, 1).v).toBe(DEFINED)
    expect(run1(S.signT, 2, 5)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
    expect(run1(S.signT, -5, -2)).toEqual({ lo: -1, hi: -1, v: CONTINUOUS })
    expect(run1(S.signT, 0, 1)).toMatchObject({ lo: 0, hi: 1, v: DEFINED })
    expect(run1(S.stepT, 0, 2)).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
    expect(run1(S.stepT, -1, 0)).toMatchObject({ lo: 0, hi: 1, v: DEFINED })
    expect(run1(S.stepT, -2, -1)).toEqual({ lo: 0, hi: 0, v: CONTINUOUS })
  })

  it('a weaker input keeps its verdict', () => {
    for (const t of [S.floorT, S.ceilT, S.roundT, S.signT, S.stepT]) {
      const a = iv()
      t(a, [iv(2.25, 2.5, PARTIAL)], 'radians')
      expect(a.v).toBe(PARTIAL)
      t(a, [iv(2.25, 2.5, DEFINED)], 'radians')
      expect(a.v).toBe(DEFINED)
      t(a, [iv(-Infinity, Infinity, UNKNOWN)], 'radians')
      expect(a.v).toBe(UNKNOWN)
    }
  })

  it('min and max are the componentwise bounds', () => {
    const r = (t: Twin, ...bs: [number, number][]) => {
      const out = iv()
      t(out, bs.map(([l, h]) => box(l, h)), 'radians')
      return out
    }
    expect(r(S.minT, [1, 3], [2, 5])).toEqual({ lo: 1, hi: 3, v: CONTINUOUS })
    expect(r(S.maxT, [1, 3], [2, 5])).toEqual({ lo: 2, hi: 5, v: CONTINUOUS })
    expect(r(S.minT, [4, 5], [1, 2], [3, 9])).toEqual({ lo: 1, hi: 2, v: CONTINUOUS })
    expect(r(S.maxT, [4, 5], [1, 2], [3, 9])).toEqual({ lo: 4, hi: 9, v: CONTINUOUS })
    expect(r(S.minT, [-Infinity, 1], [0, Infinity])).toEqual({ lo: -Infinity, hi: 1, v: CONTINUOUS })
    // an input that is NaN somewhere makes the answer NaN there; one that is NaN everywhere, everywhere
    const out = iv()
    S.minT(out, [iv(1, 2, PARTIAL), box(0, 5)], 'radians')
    expect(out).toEqual({ lo: 0, hi: 2, v: PARTIAL })
    S.maxT(out, [iv(Infinity, -Infinity, PARTIAL), box(0, 5)], 'radians')
    expect(isEmptyIv(out)).toBe(true)
    S.minT(out, [iv(Infinity, -Infinity, PARTIAL), box(-Infinity, Infinity)], 'radians')
    expect(isEmptyIv(out)).toBe(true)
  })

  it('hypot is the norm of the nearest and of the farthest corner', () => {
    expect(within(run2(S.hypotT, [3, 3], [4, 4]), 5, 5, 1e-14)).toBe(true)
    expect(run2(S.hypotT, [3, 3], [4, 4]).v).toBe(CONTINUOUS)
    expect(within(run2(S.hypotT, [0, 3], [4, 4]), 4, 5, 1e-14)).toBe(true)
    expect(within(run2(S.hypotT, [-3, 3], [-4, 4]), 0, 5, 1e-14)).toBe(true)
    expect(within(run2(S.hypotT, [-3, -3], [4, 4]), 5, 5, 1e-14)).toBe(true)
    const three = iv()
    S.hypotT(three, [box(1, 1), box(2, 2), box(2, 2)], 'radians')
    expect(within(three, 3, 3, 1e-14)).toBe(true)
    const four = iv()
    S.hypotT(four, [box(1, 1), box(1, 1), box(1, 1), box(1, 1)], 'radians')
    expect(within(four, 2, 2, 1e-14)).toBe(true)
    // any number of arguments is the norm of the corners, not only two and three
    const five = iv()
    S.hypotT(five, [box(1, 1), box(1, 1), box(1, 1), box(1, 1), box(1, 1)], 'radians')
    expect(within(five, Math.sqrt(5), Math.sqrt(5), 1e-14)).toBe(true)
    const one = iv()
    S.hypotT(one, [box(-3, 2)], 'radians')
    expect(within(one, 0, 3, 1e-14)).toBe(true)
    // hypot is never negative, and a box of zeros holds exactly +0
    expect(signOf(run2(S.hypotT, [-3, 3], [-4, 4]).lo)).toBe('+0')
    const zero = run2(S.hypotT, [-0, 0], [0, -0])
    expect(signOf(zero.lo) + signOf(zero.hi)).toBe('+0+0')
    // overflow keeps the verdict
    const big = run2(S.hypotT, [1.7e308, 1.7e308], [1.7e308, 1.7e308])
    expect(big.v).toBe(CONTINUOUS)
    expect(big.hi).toBe(Infinity)
  })

  it('hypot of an empty argument is NaN, except that an infinite argument makes hypot infinite (Math.hypot(NaN, Infinity) is Infinity)', () => {
    const empty = iv(Infinity, -Infinity, PARTIAL)
    const out = iv()
    S.hypotT(out, [{ ...empty }, box(1, 2)], 'radians')
    expect(isEmptyIv(out)).toBe(true)
    S.hypotT(out, [{ ...empty }, box(1, Infinity)], 'radians')
    expect(out).toEqual({ lo: Infinity, hi: Infinity, v: PARTIAL })
    S.hypotT(out, [box(-Infinity, 1), { ...empty }, box(0, 1)], 'radians')
    expect(out).toEqual({ lo: Infinity, hi: Infinity, v: PARTIAL })
    expect(Math.hypot(NaN, Infinity)).toBe(Infinity)
  })
})

describe('mod', () => {
  const m = (a: [number, number], b: [number, number]) => run2(S.modT, a, b)

  it('is x itself where no multiple is crossed, and jumps where one is', () => {
    const one = m([1, 2], [3, 3])
    expect(within(one, 1, 2, 1e-12) && one.v === CONTINUOUS).toBe(true)
    const jump = m([2, 4], [3, 3])
    expect(jump.v).toBe(DEFINED)
    // mod(x, 3) is in [0, 3) on [2, 4]; the twin holds that and not the [-1, 4] the plain composition gives
    expect(jump.lo).toBeGreaterThan(-1e-12)
    expect(jump.lo).toBeLessThan(1e-12)
    expect(jump.hi).toBeGreaterThanOrEqual(3 - 1e-12)
    expect(jump.hi).toBeLessThan(3 + 1e-12)
    const wide = m([0, 100], [3, 3])
    expect(wide.lo).toBeGreaterThan(-1e-12)
    expect(wide.hi).toBeLessThan(3 + 1e-12)
    expect(wide.v).toBe(DEFINED)
    // negative b: the result has the sign of b
    const negb = m([0, 100], [-3, -3])
    expect(negb.lo).toBeGreaterThan(-3 - 1e-12)
    expect(negb.hi).toBeLessThan(1e-12)
    expect(m([-10, 10], [2, 5]).hi).toBeLessThan(5 + 1e-12)
    expect(m([-10, 10], [2, 5]).lo).toBeGreaterThan(-1e-12)
  })

  it('a point is the scalar value exactly', () => {
    expect(m([7, 7], [3, 3])).toEqual({ lo: 1, hi: 1, v: CONTINUOUS })
    expect(m([-7, -7], [3, 3])).toEqual({ lo: 2, hi: 2, v: CONTINUOUS })
    expect(m([7, 7], [-3, -3])).toEqual({ lo: -2, hi: -2, v: CONTINUOUS })
    expect(m([3, 3], [3, 3])).toEqual({ lo: 0, hi: 0, v: CONTINUOUS })
    expect(m([7.5, 7.5], [2, 2])).toEqual({ lo: floorMod(7.5, 2), hi: floorMod(7.5, 2), v: CONTINUOUS })
    expect(isEmptyIv(m([3, 3], [0, 0]))).toBe(true)
    expect(isEmptyIv(m([Infinity, Infinity], [3, 3]))).toBe(true)
    expect(m([1e300, 1e300], [1e-10, 1e-10])).toEqual({ lo: -Infinity, hi: -Infinity, v: CONTINUOUS })
  })

  it('a divisor that reaches 0 is partial, and an empty argument is NaN everywhere', () => {
    expect(m([1, 2], [-1, 1]).v).toBe(PARTIAL)
    expect(m([1, 2], [0, 1]).v).toBe(PARTIAL)
    const out = iv()
    S.modT(out, [iv(Infinity, -Infinity, PARTIAL), box(1, 2)], 'radians')
    expect(isEmptyIv(out)).toBe(true)
    S.modT(out, [box(1, 2), iv(Infinity, -Infinity, PARTIAL)], 'radians')
    expect(isEmptyIv(out)).toBe(true)
  })

  it('mod never returns -0, so a bound that is exactly 0 never lies', () => {
    for (const [a, b] of [[-0, 3], [-0, -3], [0, -3], [0, 3], [3, 3], [-3, 3], [6, -3], [-6, -3]]) expect(Object.is(floorMod(a, b), -0), `mod(${fmt(a)}, ${fmt(b)})`).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Soundness against the scalar compile.
// ---------------------------------------------------------------------------

const UNARY = ['floor', 'ceil', 'round', 'sign', 'step'] as const
const UNARY_TWINS: Record<(typeof UNARY)[number], Twin> = { floor: S.floorT, ceil: S.ceilT, round: S.roundT, sign: S.signT, step: S.stepT }

describe('stepwise twins are sound over random boxes', () => {
  for (const name of UNARY) {
    it(name, () => {
      const rand = mulberry32(name.length * 7919 + name.charCodeAt(0))
      const f = compileScalar(p(`${name}(x)`), ['x'], makeScope())
      for (let i = 0; i < 500; i++) {
        const [lo, hi] = randomBox(rand)
        const r = run1(UNARY_TWINS[name], lo, hi)
        for (const x of pointsIn(lo, hi, rand, 6)) must(r, f(x), () => `${name} [${lo}, ${hi}] at ${x} gives ${f(x)}, twin ${show(r)}`)
      }
    })
  }

  it('mod, min, max and hypot over pairs', () => {
    const rand = mulberry32(8675309)
    const scope = makeScope()
    const fs = (['mod', 'min', 'max', 'hypot'] as const).map((n) => compileScalar(p(`${n}(x, y)`), ['x', 'y'], scope))
    const twins = [S.modT, S.minT, S.maxT, S.hypotT]
    for (let i = 0; i < 400; i++) {
      const a = randomBox(rand)
      const b = randomBox(rand)
      twins.forEach((t, k) => {
        const r = run2(t, a, b)
        for (const x of pointsIn(a[0], a[1], rand, 3)) {
          for (const y of pointsIn(b[0], b[1], rand, 3)) must(r, fs[k](x, y), () => `#${k} x [${a}] y [${b}] at (${x}, ${y}) gives ${fs[k](x, y)}, twin ${show(r)}`)
        }
      })
    }
  })
})

// ---------------------------------------------------------------------------
// Edge boxes: what the random generator rarely reaches. Infinite ends, both signs of zero,
// subnormals, integers and half-integers (where floor, ceil and round jump), the doubles at
// 2^52 and 2^53 (above them every double is whole), and the pieces of mod.
// ---------------------------------------------------------------------------

const EDGE_BOXES: [number, number][] = [
  [-Infinity, Infinity], [0, Infinity], [-Infinity, 0], [1, Infinity], [-Infinity, -1], [-0, Infinity], [-Infinity, -0], [Infinity, Infinity], [-Infinity, -Infinity],
  [0, 0], [-0, 0], [-0, -0], [-0, 2], [0, 2], [-2, 0], [-2, -0], [0, 1e-300], [-1e-300, -0], [-1e-300, 1e-300], [-5e-324, 5e-324], [0, 5e-324], [-5e-324, -0], [5e-324, 1e-300],
  [-1, 1], [0, 1], [-1, 0], [-1, -0], [-0, 1], [0.5, 1], [-1, -0.5], [1, 1], [-1, -1], [0.5, 2], [-3, -1], [1, 2], [0, 0.5], [-0.5, 0], [-0.5, -0], [-0.5, 0.5], [-0.7, 0.3], [-0.9, -0.1], [0.1, 0.9],
  [0.2, 0.8], [-0.8, -0.2], [0.5, 0.5], [-0.5, -0.5], [1.5, 1.5], [-1.5, -1.5], [2.5, 2.5], [-2.5, -2.5], [2.4, 2.6], [-2.6, -2.4], [1.4, 1.6], [0.4, 0.6], [-0.6, -0.4],
  [nextDown(0.5), 0.5], [0.5, nextUp(0.5)], [nextDown(0.5), nextUp(0.5)], [-nextUp(0.5), -nextDown(0.5)], [nextDown(1), nextUp(1)], [nextDown(-1), nextUp(-1)], [nextDown(2.5), nextUp(2.5)],
  [nextDown(1.5), nextUp(1.5)], [-nextUp(1.5), -nextDown(1.5)], [nextDown(3), nextUp(3)], [-nextUp(3), -nextDown(3)], [-nextDown(0.5), nextDown(0.5)],
  [2 ** 52 - 1, 2 ** 52 + 1], [2 ** 52 - 0.5, 2 ** 52], [2 ** 53 - 1, 2 ** 53 + 2], [2 ** 53, 2 ** 53 + 16], [-(2 ** 52) - 1, -(2 ** 52) + 1], [-(2 ** 53) - 2, -(2 ** 53) + 1], [4503599627370495.5, 4503599627370496],
  [1e15, 1e15 + 8], [1e300, 1e300], [-1e300, -1e300], [1e300, Infinity], [-1e300, 1e300], [1e154, 1e155], [-1e154, 1e155],
  [2.9, 3.1], [3, 3], [-3, -3], [2, 4], [-4, -2], [3, 3.5], [-3.5, -3], [0, 100], [-100, 100], [-100, 0], [99, 101], [-0.001, 0.001], [-3.001, -2.999],
]

describe('stepwise twins are sound on the edge boxes', () => {
  for (const name of UNARY) {
    it(name, () => {
      const rand = mulberry32(2026 + name.length + name.charCodeAt(1))
      const f = compileScalar(p(`${name}(x)`), ['x'], makeScope())
      for (const [lo, hi] of EDGE_BOXES) {
        for (const [l, h] of withZeroSigns(lo, hi)) {
          const r = run1(UNARY_TWINS[name], l, h)
          for (const x of pointsOf(l, h, rand)) {
            const y = f(x)
            must(r, y, () => `${name} over [${fmt(l)}, ${fmt(h)}] at ${fmt(x)} gives ${fmt(y)}, twin ${show(r)}`)
          }
        }
      }
    })
  }

  // two-argument twins over every pair of a smaller set of edge boxes
  const PAIR_BOXES: [number, number][] = [
    [-Infinity, Infinity], [0, Infinity], [-Infinity, 0], [1, Infinity], [-Infinity, -1], [0, 0], [-0, 0], [-0, -0], [-0, 2], [0, 2], [-2, 0], [-2, -0], [-1, 1], [-1e-300, 1e-300],
    [0.5, 2], [-3, -1], [1, 1], [-1, -1], [1, 2], [0.25, 4], [-5e-324, 5e-324], [5e-324, 5e-324], [-5e-324, -5e-324], [1e154, 1e155], [Infinity, Infinity], [-Infinity, -Infinity], [-1, 0], [0, 1], [-0.5, 0],
    [nextDown(1), nextUp(1)], [-0, 1], [3, 3], [-3, -3], [2, 4], [-4, -2], [1e300, 1e300], [1e-300, 1e-300], [3e10, 3e10], [1e-10, 1e-10], [-1e-320, -1e-320], [2.9, 3.1], [0, 100], [-100, 0],
  ]
  for (const name of ['mod', 'min', 'max', 'hypot'] as const) {
    it(`${name} over pairs of edge boxes`, () => {
      const rand = mulberry32(777 + name.length)
      const f = compileScalar(p(`${name}(x, y)`), ['x', 'y'], makeScope())
      const t = { mod: S.modT, min: S.minT, max: S.maxT, hypot: S.hypotT }[name]
      for (const [al, ah] of PAIR_BOXES) {
        for (const [bl, bh] of PAIR_BOXES) {
          for (const [a0, a1] of withZeroSigns(al, ah)) {
            for (const [b0, b1] of withZeroSigns(bl, bh)) {
              const r = run2(t, [a0, a1], [b0, b1])
              for (const x of pointsOf(a0, a1, rand, 2)) {
                for (const y of pointsOf(b0, b1, rand, 2)) {
                  const v = f(x, y)
                  must(r, v, () => `${name} a [${fmt(a0)}, ${fmt(a1)}] b [${fmt(b0)}, ${fmt(b1)}] at (${fmt(x)}, ${fmt(y)}) gives ${fmt(v)}, twin ${show(r)}`)
                }
              }
            }
          }
        }
      }
    })
  }

  it('min, max and hypot of three and four arguments', () => {
    const rand = mulberry32(31)
    const small: [number, number][] = [[-Infinity, Infinity], [0, 0], [-0, 0], [-0, -0], [-1, 1], [0.5, 2], [-3, -1], [-0, 2], [Infinity, Infinity]]
    const scope = makeScope()
    for (const name of ['min', 'max', 'hypot'] as const) {
      const f3 = compileScalar(p(`${name}(x, y, z)`), ['x', 'y', 'z'], scope)
      const f4 = compileScalar(p(`${name}(x, y, z, x)`), ['x', 'y', 'z'], scope)
      const t = { min: S.minT, max: S.maxT, hypot: S.hypotT }[name]
      for (const A of small) {
        for (const B of small) {
          for (const C of small) {
            const out = iv()
            t(out, [box(...A), box(...B), box(...C)], 'radians')
            for (const x of pointsOf(A[0], A[1], rand, 1)) {
              for (const y of pointsOf(B[0], B[1], rand, 1)) {
                for (const z of pointsOf(C[0], C[1], rand, 1)) {
                  const v = f3(x, y, z)
                  must(out, v, () => `${name} of three at (${fmt(x)}, ${fmt(y)}, ${fmt(z)}) gives ${fmt(v)}, twin ${show(out)}`)
                }
              }
            }
            const o4 = iv()
            t(o4, [box(...A), box(...B), box(...C), box(...A)], 'radians')
            for (const x of pointsOf(A[0], A[1], rand, 1)) {
              for (const y of pointsOf(B[0], B[1], rand, 1)) {
                const z = C[0]
                const v = f4(x, y, z)
                must(o4, v, () => `${name} of four at (${fmt(x)}, ${fmt(y)}, ${fmt(z)}, ${fmt(x)}) gives ${fmt(v)}, twin ${show(o4)}`)
              }
            }
          }
        }
      }
    }
  })

  // mod hands its jumps to the next twin: the doubles around every multiple, the underflow
  // where a / b is 0 for a negative a (mod(-1e-320, 3e10) is -1e-320, not 3e10), and the huge
  // quotients where floor(a / b) is the whole of a / b.
  it('mod at the doubles around its multiples and its extremes', () => {
    const rand = mulberry32(99)
    const f = compileScalar(p('mod(x, y)'), ['x', 'y'], makeScope())
    const bs = [3, -3, 1, 0.1, 7.5, 1e-3, 1e10, 3e10, 2 ** 40, 1e-10, 5e-324, 0.7]
    for (const b of bs) {
      for (let trial = 0; trial < 60; trial++) {
        const k = Math.floor((rand() * 2 - 1) * 12)
        const c = k * b
        let lo = c
        let hi = c
        for (let i = Math.floor(rand() * 4); i > 0; i--) lo = nextDown(lo)
        for (let i = Math.floor(rand() * 4); i > 0; i--) hi = nextUp(hi)
        if (rand() < 0.3) hi = c + Math.abs(b) * rand() * 1.5
        if (rand() < 0.2) lo = c - Math.abs(b) * rand() * 1.5
        for (const [l, h] of withZeroSigns(lo, hi)) {
          const r = run2(S.modT, [l, h], [b, b])
          const pts = pointsOf(l, h, rand, 6)
          for (let i = 0; i < 3; i++) pts.push(...[nextDown(c), nextUp(c), nextDown(nextDown(c)), nextUp(nextUp(c))].filter((x) => l <= x && x <= h))
          for (const x of pts) must(r, f(x, b), () => `mod over [${fmt(l)}, ${fmt(h)}] by ${b} at ${fmt(x)} gives ${fmt(f(x, b))}, twin ${show(r)}`)
        }
      }
    }
    // extremes
    const cases: [[number, number], [number, number]][] = [
      [[-1e-320, -1e-320], [3e10, 3e10]], [[-1e-320, 0], [3e10, 3e10]], [[-1e-320, 1e-320], [3e10, 3e10]], [[-5e-324, -5e-324], [3, 3]], [[-1e-20, -1e-20], [3, 3]],
      [[-1e-20, 1e-20], [3, 3]], [[1e300, 1e300], [1e-10, 1e-10]], [[-1e300, 1e300], [1e-10, 1e-10]], [[1e17, 1e17 + 64], [3, 3]], [[-1e17, 1e17], [3, 7]], [[1e300, 1e301], [3, 3]],
      [[2 ** 53, 2 ** 53 + 64], [3, 3]], [[1e15, 1e15 + 32], [3, 3]], [[1e15, 1e16], [0.1, 0.1]], [[-1e20, 1e20], [5e-324, 5e-324]], [[0, 100], [2, 3]], [[-100, 100], [-3, -2]],
      [[1, 100], [0.5, 100]], [[1, 100], [-100, -0.5]], [[1e-300, 1e300], [1e-300, 1e300]],
    ]
    for (const [a, b] of cases) {
      const r = run2(S.modT, a, b)
      for (const x of pointsOf(a[0], a[1], rand, 8)) {
        for (const y of pointsOf(b[0], b[1], rand, 8)) must(r, f(x, y), () => `mod a [${a.map(fmt)}] b [${b.map(fmt)}] at (${fmt(x)}, ${fmt(y)}) gives ${fmt(f(x, y))}, twin ${show(r)}`)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Windows of consecutive doubles, every double of the box tried: Math.hypot is not exactly
// monotone, and mod's rounding is the thing its range has to hold, and both show only where
// the box is a few ulps wide.
// ---------------------------------------------------------------------------

describe('hypot and mod over windows of consecutive doubles', () => {
  it('hypot over a few ulps of each argument', () => {
    const rand = mulberry32(60221)
    for (let t = 0; t < 6000; t++) {
      const a = Math.pow(10, rand() * 12 - 6) * (rand() < 0.5 ? -1 : 1)
      const b = Math.pow(10, rand() * 12 - 6) * (rand() < 0.5 ? -1 : 1)
      const a0 = stepDoubles(a, -Math.floor(rand() * 30))
      const a1 = stepDoubles(a, Math.floor(rand() * 30))
      const b0 = stepDoubles(b, -Math.floor(rand() * 30))
      const b1 = stepDoubles(b, Math.floor(rand() * 30))
      const out = run2(S.hypotT, [a0, a1], [b0, b1])
      for (const x of doublesIn(a0, a1, 12)) {
        for (const y of doublesIn(b0, b1, 12)) must(out, Math.hypot(x, y), () => `hypot a [${a0}, ${a1}] b [${b0}, ${b1}] at (${x}, ${y}), twin ${show(out)}`)
      }
    }
  })

  it('mod over a few ulps around multiples of b, and the quotients where it rounds', () => {
    const rand = mulberry32(60222)
    const bs = [3, -3, 1, 0.1, 0.7, 7.5, 1e-3, 1e10, 3e10, 2 ** 40, 1e-10, 1e-300, 5e-324, 1e300, 17, -0.3, 1 / 3]
    for (let t = 0; t < 6000; t++) {
      const b = bs[Math.floor(rand() * bs.length)] * (rand() < 0.2 ? -1 : 1)
      const bb = stepDoubles(b, Math.floor(rand() * 3))
      // the multiple: a few, a million, and up to 2^50 (the quotients where the analytic range takes over)
      const k = Math.floor((rand() * 2 - 1) * Math.pow(10, rand() * 15))
      const c = k * bb
      const lo = stepDoubles(c, -Math.floor(rand() * 5)) + (rand() < 0.3 ? -Math.abs(bb) * rand() * 2 : 0)
      const hi = Math.max(lo, stepDoubles(c, Math.floor(rand() * 5)) + (rand() < 0.3 ? Math.abs(bb) * rand() * 2 : 0))
      for (const [l, h] of withZeroSigns(lo, hi)) {
        const out = run2(S.modT, [l, h], [b, bb])
        const pts = [l, h, ...zerosIn(l, h), ...doublesIn(stepDoubles(c, -3), stepDoubles(c, 3), 7).filter((x) => x !== 0 && l <= x && x <= h)]
        for (let i = 0; i < 4; i++) pts.push(l + (h - l) * rand())
        for (const x of pts) {
          for (const y of [b, bb]) must(out, floorMod(x, y), () => `mod a [${fmt(l)}, ${fmt(h)}] b [${b}, ${bb}] at (${fmt(x)}, ${fmt(y)}), twin ${show(out)}`)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// The zero-bound invariant: a bound that is exactly a zero is a zero the function returns with
// that sign, or a side on which no zero is reached (lo === +0 says no -0 is attained, hi === -0
// says no +0 is). floor, ceil, round and sign produce zeros of their own.
// ---------------------------------------------------------------------------

describe('a zero bound is the signed zero the box holds', () => {
  const sg = (r: Iv) => signOf(r.lo) + signOf(r.hi)

  it('ceil of a negative fraction is -0, and of a box that holds both zeros is a box that holds both', () => {
    expect(Math.ceil(-0.5)).toBe(-0)
    expect(sg(run1(S.ceilT, -0.7, -0.2))).toBe('-0-0')
    // [-0.7, 0.3]: ceil(-0.7) is -0 and ceil(+0) is +0 and ceil(0.3) is 1. The bottom is not +0
    // (that would deny -0), and it is not the end zero -0 either (that would deny the +0 inside,
    // to a consumer that reads an end zero as exact): it is the double below 0, which holds both.
    const r = run1(S.ceilT, -0.7, 0.3)
    expect(r.lo).toBeLessThan(0)
    expect(r.lo).toBeGreaterThan(-1e-300)
    expect(r.hi).toBe(1)
    expect(sg(run1(S.ceilT, 0, 0))).toBe('+0+0')
    expect(sg(run1(S.ceilT, -0, -0))).toBe('-0-0')
    expect(signOf(run1(S.ceilT, 0, 0.5).lo)).toBe('+0')
    // a box that starts at -0 and goes up: the ceil of -0 is -0 and of the positives 1, and no
    // input gives +0 (the +0 input is not in the box), so the -0 is exact
    expect(sg(run1(S.ceilT, -0, 0.5))).toBe('-0+')
    // both ends zero: both zeros
    expect(sg(run1(S.ceilT, -0.7, 0))).toBe('-0+0')
    // a box that ends at +0 over a negative: ceil of a small negative is -0, so the top holds both
    expect(run1(S.ceilT, -1.5, 0).hi).toBeGreaterThan(0)
  })

  it('floor, round, sign and step keep the zero of the end that produced it, where it is the only one there', () => {
    expect(sg(run1(S.floorT, -0, -0))).toBe('-0-0')
    expect(sg(run1(S.floorT, 0.2, 0.8))).toBe('+0+0')
    expect(sg(run1(S.floorT, -0, 0.5))).toBe('-0+0')
    expect(signOf(run1(S.floorT, 0, 0.5).lo)).toBe('+0')
    expect(sg(run1(S.roundT, -0.3, -0.1))).toBe('-0-0')
    expect(sg(run1(S.roundT, -0.3, 0.3))).toBe('-0+0')
    expect(sg(run1(S.roundT, 0.1, 0.3))).toBe('+0+0')
    expect(sg(run1(S.signT, -0, -0))).toBe('-0-0')
    expect(sg(run1(S.signT, 0, 0))).toBe('+0+0')
    expect(signOf(run1(S.signT, 0, 1).lo)).toBe('+0')
    expect(signOf(run1(S.signT, -1, -0).hi)).toBe('-0')
    // a box that ends at +0 over a negative holds +0 and no -0 where no input gives it: exact
    expect(sg(run1(S.floorT, -1.5, 0))).toBe('-+0')
    expect(sg(run1(S.signT, -1, 0))).toBe('-+0')
    // a box that starts at -0: sign(-0) is -0, the positives give 1, no input gives +0: exact
    expect(sg(run1(S.signT, -0, 1))).toBe('-0+')
    expect(sg(run1(S.ceilT, -0, 1.5))).toBe('-0+')
    // but floor and round send small positives to +0: the bottom holds both zeros
    expect(run1(S.floorT, -0, 1.5).lo).toBeLessThan(0)
    expect(run1(S.roundT, -0, 1.5).lo).toBeLessThan(0)
    // the zero of the other sign is attained too: the bound moves off zero
    expect(run1(S.floorT, -0.5, 0.5).hi).toBeGreaterThan(0)
    expect(run1(S.signT, -1, 1).hi).toBe(1)
    expect(run1(S.roundT, -2, 0.3).hi).toBeGreaterThan(0)
    expect(run1(S.roundT, -2, 0).hi).toBeGreaterThan(0)
    expect(run1(S.floorT, -1.5, 0.2).hi).toBeGreaterThan(0)
    // step returns the literal 0: never -0
    expect(sg(run1(S.stepT, -2, -1))).toBe('+0+0')
    // a box written [+0, -0] holds both zeros
    expect(sg(run1(S.floorT, 0, -0))).toBe('-0+0')
    expect(sg(run1(S.ceilT, 0, -0))).toBe('-0+0')
    expect(sg(run1(S.signT, 0, -0))).toBe('-0+0')
    expect(sg(run1(S.roundT, 0, -0))).toBe('-0+0')
  })

  it('min and max keep the order -0 < +0 that Math.min and Math.max have', () => {
    const r = (t: Twin, a: [number, number], b: [number, number]) => {
      const out = iv()
      t(out, [box(...a), box(...b)], 'radians')
      return out
    }
    expect(sg(r(S.minT, [-0, -0], [0, 0]))).toBe('-0-0')
    expect(sg(r(S.minT, [0, 0], [0, 0]))).toBe('+0+0')
    expect(sg(r(S.maxT, [-0, -0], [0, 0]))).toBe('+0+0')
    expect(sg(r(S.maxT, [-0, -0], [-0, -0]))).toBe('-0-0')
    // min(x, 0) over x in [-1, -0] is at most -0: a box with no +0 holds no +0
    expect(signOf(r(S.minT, [-1, -0], [0, 0]).hi)).toBe('-0')
    // max(x, -0) over x in [+0, 1] is at least +0: max(+0, -0) is +0
    expect(signOf(r(S.maxT, [0, 1], [-0, -0]).lo)).toBe('+0')
    expect(signOf(r(S.maxT, [0, 1], [0, 0]).lo)).toBe('+0')
    // over x in [-0, 1]: -0 (x = -0) and +0 (x above) are both attained, and the bottom moves off zero
    expect(r(S.maxT, [-0, 1], [-0, -0]).lo).toBeLessThan(0)
    // min(x, 0) over [-1, 1]: -1 up to +0, and -0 at x = -0: the top moves off zero
    expect(r(S.minT, [-1, 1], [0, 0]).hi).toBeGreaterThan(0)
    // an argument written [+0, -0] holds both zeros
    expect(r(S.minT, [0, -0], [-1, 1]).hi).toBeGreaterThan(0)
    expect(r(S.maxT, [0, -0], [-1, 1]).lo).toBeLessThan(0)
  })

  it('1 / (floor, ceil, round, sign, step) reaches the infinity the scalar reaches', () => {
    const reciprocal = (t: Twin, lo: number, hi: number): Iv => {
      const out = iv()
      t(out, [box(lo, hi)], 'radians')
      return interval(p('1/x'), { x: out }, 'radians')
    }
    // [0.2, 0.8]: floor is +0 throughout, 1 / +0 is +inf: the answer holds +inf
    expect(reciprocal(S.floorT, 0.2, 0.8).hi).toBe(Infinity)
    // [-0.9, -0.1]: ceil is -0 throughout, 1 / -0 is -inf
    expect(reciprocal(S.ceilT, -0.9, -0.1).lo).toBe(-Infinity)
    // [0, 1]: sign is +0 at 0 and 1 above: 1 / sign is [1, +inf], and it does not hold -inf
    const c = reciprocal(S.signT, 0, 1)
    expect(c.hi).toBe(Infinity)
    expect(c.lo).toBeGreaterThan(0)
    // [-0, 1]: sign(-0) is -0
    expect(reciprocal(S.signT, -0, 1).lo).toBe(-Infinity)
  })
})

// ---------------------------------------------------------------------------
// Composition.
// ---------------------------------------------------------------------------

describe('composed stepwise twins stay sound', () => {
  const ONE_VAR = [
    '1/floor(x)', '1/ceil(x)', '1/round(x)', '1/sign(x)', '1/step(x)', 'floor(x)/x', 'ceil(x)/x', 'round(x)/x', 'sign(x)/x', 'step(x)/x', 'x - floor(x)', 'ceil(x) - x',
    'floor(1/x)', 'ceil(1/x)', 'round(1/x)', 'sign(1/x)', 'step(1/x)', '1/floor(1/x)', '1/ceil(1/x)', 'floor(x)^-1', 'ceil(x)^-1', 'round(x)^-1', 'sign(x)^-1', 'step(x)^-1',
    'mod(x, 3)', '1/mod(x, 3)', 'mod(x, -3)', '1/mod(x, -3)', 'mod(1/x, 1)', '1/mod(1/x, 1)', 'mod(x, 1/x)', 'mod(x, x)', 'mod(x, 0)', 'mod(0, x)', 'mod(-0, x)', 'mod(x, -0)',
    'mod(3, x)', 'mod(-3, x)', 'mod(x, 2) - mod(x, 3)', 'sqrt(mod(x, 3))', 'ln(mod(x, 3))', 'mod(x, 3)/x', 'mod(x, 0.5)', 'mod(x, 1)', 'mod(x, 1e-10)', 'mod(x, 1e300)', 'mod(1e300, x)',
    'floor(x)*ceil(x)', 'floor(ceil(x))', 'ceil(floor(x))', 'round(floor(x))', 'sign(floor(x))', 'sign(ceil(x))', 'sign(round(x))', 'floor(sign(x))', 'floor(step(x))', 'step(floor(x))',
    'step(x) * ln(x)', 'step(x)*ln(x)', 'step(-x)*ln(-x)', 'ln(step(x))', '1/step(x - 1)', 'sqrt(step(x) - 1)', 'step(x)^-1',
    'max(x, -x)', 'min(x, -x)', 'max(x, 0)', 'min(x, 0)', 'max(x, -0)', 'min(x, -0)', 'max(0, x)', 'min(0, x)', '1/max(x, 0)', '1/min(x, 0)', '1/max(x, -0)', '1/min(x, -0)', '1/min(0, x)',
    '1/max(0, x)', 'sqrt(max(x, 0))', 'ln(max(x, 0))', 'min(sin(x), cos(x))', 'max(sin(x), cos(x))', 'min(x, 1/x)', 'max(x, 1/x)', 'max(1/x, -1/x)', 'min(1/x, -1/x)', 'min(x, x^2)',
    'max(abs(x), 1)', 'min(abs(x), 1)', 'max(x, 1, -1)', 'min(x, 1, -1)', 'min(x, 0, 1/x)', 'max(x, -0, 0)', 'abs(max(x, 0)) - max(x, 0)', 'atan2(max(x, 0), -1)', 'atan2(min(x, 0), -1)',
    'hypot(x, 1/x)', 'hypot(x, 1)', 'hypot(x, 0)', '1/hypot(x, 0)', '1/hypot(x, 1/x)', 'hypot(x, -x)', 'hypot(x, x, x)', 'sqrt(hypot(x, 1))', 'ln(hypot(x, 0))', 'hypot(1/x, 1/x)',
    'hypot(x, 1, 2, 3)', 'hypot(floor(x), ceil(x))', 'hypot(sin(x), cos(x))', 'hypot(x, sqrt(x))', 'hypot(sqrt(x), 1)', 'hypot(x, ln(x))', 'hypot(1/x, ln(x))',
    'atan2(sign(x), -1)', 'atan2(-sign(x), -1)', 'log(floor(x))', 'log(ceil(x), 2)', 'exp(-1/floor(x))', 'exp(1/ceil(x))', 'sqrt(floor(x))', 'ln(round(x))', '1/sqrt(floor(x))', 'asin(sign(x))',
    'acos(sign(x))', 'atanh(sign(x))', 'acosh(ceil(x))', 'tan(floor(x))', 'sin(floor(x))/x', 'root(3, floor(x))', 'root(-3, ceil(x))', 'root(2, step(x))', 'cbrt(floor(x))', '1/cbrt(sign(x))',
    '1/root(5, round(x))', '1/root(4, sign(x))', '1/root(-5, ceil(x))', 'atan2(floor(x), ceil(x))', 'atan2(ceil(x), floor(x))', 'atan2(round(x), -1)', 'atan2(0, floor(x))', 'atan2(-0, ceil(x))',
  ]
  for (const src of ONE_VAR) {
    it(src, () => checkComposed(src))
    it(`${src} (degrees)`, () => checkComposed(src, 'degrees', [[0, 90], [-90, 90], [89, 91], [0, 180], [-0.5, 0.5], [-1, 1], [0, 0], [-0, 0], [-Infinity, Infinity], [0, 2], [-2, 0], [2.9, 3.1]]))
  }

  it('mod(x, 3) and 1 / mod(x, 3) near the multiples of 3', () => {
    const rand = mulberry32(3333)
    const boxes: [number, number][] = []
    for (const k of [-3, -2, -1, 0, 1, 2, 3, 100]) {
      const c = 3 * k
      boxes.push([c, c], [c - 0.1, c + 0.1], [c, c + 1], [c - 1, c], [nextDown(c), nextUp(c)], [nextDown(c), c], [c, nextUp(c)], [c - 3, c + 3])
    }
    for (const src of ['mod(x, 3)', '1/mod(x, 3)', 'mod(x, -3)', '1/mod(x, -3)', 'sqrt(mod(x, 3))', 'ln(mod(x, 3))', 'mod(x, 3)^-1']) {
      const f = compileScalar(p(src), ['x'], makeScope())
      for (const [lo, hi] of boxes) {
        for (const [l, h] of withZeroSigns(lo, hi)) {
          const r = interval(p(src), { x: box(l, h) }, 'radians')
          for (const x of pointsOf(l, h, rand, 6)) must(r, f(x), () => `${src} over [${fmt(l)}, ${fmt(h)}] at ${fmt(x)} gives ${fmt(f(x))}, twin ${show(r)}`)
        }
      }
    }
  })

  // The boxes a few ulps wide around each place a stepwise function jumps or a pole of its
  // reciprocal sits: round at +-0.5 and +-1.5, floor and ceil at the whole numbers and at 0 with
  // both of its signs, mod at the multiples of 3, min and max where their arguments cross.
  it('1 / floor, ceil, round, sign and step around the jumps, a few ulps wide', () => {
    const centres = [0, -0, 0.5, -0.5, 1.5, -1.5, 2.5, -2.5, 1, -1, 2, -2, 1e-300, -1e-300]
    for (const src of ['1/round(x)', '1/floor(x)', '1/ceil(x)', '1/sign(x)', '1/step(x)', 'round(x)/x', 'sign(x)/x', 'floor(x)/ceil(x)', 'atan2(round(x), -1)', 'atan2(floor(x), ceil(x))',
      'sqrt(round(x))', 'sqrt(ceil(x))', 'sqrt(floor(x))', 'exp(1/round(x))', 'ln(ceil(x))', 'tan(ceil(x))', 'atan2(sign(x), sign(-x))', '1/(ceil(x) - floor(x))', '1/(round(x) + sign(x))']) checkAround(src, centres)
  })

  it('mod and 1 / mod around the multiples of 3 and of 1/3, a few ulps wide', () => {
    const centres = [0, -0, 3, -3, 6, -6, 9, 300, 1 / 3, 1, -1, 2, 1e15]
    for (const src of ['mod(x, 3)', '1/mod(x, 3)', 'mod(x, -3)', '1/mod(x, -3)', 'sqrt(mod(x, 3))', 'ln(mod(x, 3))', 'atan2(mod(x, 3), -1)', 'mod(x, 1/3)', '1/mod(x, 1/3)', 'mod(x, 1)', '1/mod(x, 1)', 'mod(1/x, 1)']) checkAround(src, centres)
  })

  it('min, max and hypot where their arguments cross and where they are zero, a few ulps wide', () => {
    const centres = [0, -0, 1, -1, 1e-300, 5e-324, -5e-324]
    for (const src of ['max(x, -x)', 'min(x, -x)', '1/max(x, -x)', '1/min(x, -x)', 'min(x, 1/x)', 'max(x, 1/x)', 'hypot(x, 1/x)', '1/hypot(x, x)', 'min(x, 0)', 'max(x, 0)', '1/min(x, 0)', '1/max(x, 0)',
      '1/min(x, -0)', '1/max(x, -0)', 'atan2(min(x, 0), -1)', 'atan2(max(x, -0), -1)', 'sqrt(min(x, 0))', 'sqrt(max(x, -0))']) checkAround(src, centres)
  })

  // The composed answers on simple boxes are the tight ones: each twin's tightness survives the
  // next, and a verdict is the weakest of the chain's (never stronger than the box allows).
  it('composed stepwise twins stay tight where the function is nice, and say what they cannot know', () => {
    const at = (src: string, lo: number, hi: number) => interval(p(src), { x: box(lo, hi) }, 'radians')
    expect(at('1/floor(x)', 0.2, 0.8).v).toBe(PARTIAL)
    expect(at('1/floor(x)', 1.2, 1.8).v).toBe(CONTINUOUS)
    expect(within(at('1/floor(x)', 1.2, 1.8), 1, 1, 1e-14)).toBe(true)
    expect(at('1/floor(x)', 1.2, 2.8).v).toBe(DEFINED)
    expect(within(at('1/floor(x)', 1.2, 2.8), 0.5, 1, 1e-14)).toBe(true)
    expect(within(at('1/ceil(x)', 0.2, 0.8), 1, 1, 1e-14) && at('1/ceil(x)', 0.2, 0.8).v === CONTINUOUS).toBe(true)
    expect(at('1/sign(x)', 0, 1)).toMatchObject({ lo: expect.any(Number), hi: Infinity, v: PARTIAL })
    expect(at('1/sign(x)', 0, 1).lo).toBeGreaterThan(0.99)
    expect(at('1/sign(x)', 2, 3)).toMatchObject({ v: CONTINUOUS })
    expect(within(at('x - floor(x)', 0.25, 0.75), 0.25, 0.75, 1e-12) && at('x - floor(x)', 0.25, 0.75).v === CONTINUOUS).toBe(true)
    expect(within(at('mod(x, 3) + 1', 1, 2), 2, 3, 1e-12)).toBe(true)
    expect(within(at('hypot(x, 1/x)', 1, 2), Math.hypot(1, 0.5), Math.hypot(2, 1), 1e-12) && at('hypot(x, 1/x)', 1, 2).v === CONTINUOUS).toBe(true)
    expect(within(at('min(sin(x), cos(x))', 0, 0.5), 0, Math.sin(0.5), 1e-12) && at('min(sin(x), cos(x))', 0, 0.5).v === CONTINUOUS).toBe(true)
    expect(within(at('max(x, -x)', 1, 2), 1, 2, 1e-12)).toBe(true)
    // the dependency between the two x's costs a bound, never a verdict
    expect(at('max(x, -x)', -1, 1).v).toBe(CONTINUOUS)
    expect(at('max(x, -x)', -1, 1).lo).toBeLessThanOrEqual(0)
    expect(within(at('step(x) * ln(x)', 1, 2), 0, Math.log(2), 1e-12) && at('step(x) * ln(x)', 1, 2).v === CONTINUOUS).toBe(true)
    expect(at('step(x) * 5', 1, 2)).toMatchObject({ v: CONTINUOUS })
    expect(at('step(x) * 5', -1, 2).v).toBe(DEFINED)
  })
})

// ---------------------------------------------------------------------------
// Aliasing and history.
// ---------------------------------------------------------------------------

describe('twins read every input before writing out, and keep no state between calls', () => {
  const BOXES_SMALL: [number, number][] = [[0.25, 0.75], [-1, 1], [0, 2], [-0, 1], [1, 5], [-3, -1], [2, 4], [-Infinity, 1], [0, 0], [-10, 10], [40, 50], [-0.5, 0.5], [3, 3]]

  it('a unary twin with out aliasing its input gives the fresh answer', () => {
    for (const name of UNARY) {
      for (const [lo, hi] of BOXES_SMALL) {
        const fresh = iv()
        UNARY_TWINS[name](fresh, [box(lo, hi)], 'radians')
        const a = box(lo, hi)
        UNARY_TWINS[name](a, [a], 'radians')
        expect(same(a, fresh), `${name} [${fmt(lo)}, ${fmt(hi)}]: ${show(a)} vs ${show(fresh)}`).toBe(true)
      }
    }
  })

  it('a binary twin with out aliasing either input gives the fresh answer', () => {
    const twins: [string, Twin][] = [['mod', S.modT], ['min', S.minT], ['max', S.maxT], ['hypot', S.hypotT]]
    for (const [name, twin] of twins) {
      for (const [al, ah] of BOXES_SMALL) {
        for (const [bl, bh] of BOXES_SMALL) {
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

  it('an answer does not depend on which twins ran before it', () => {
    const rand = mulberry32(4242)
    const jobs: [number, number, number, number][] = []
    for (let i = 0; i < 200; i++) {
      const [a0, a1] = randomBox(rand)
      const [b0, b1] = randomBox(rand)
      jobs.push([a0, a1, b0, b1])
    }
    const once = (t: Twin, [a0, a1, b0, b1]: [number, number, number, number]) => {
      const out = iv()
      t(out, [box(a0, a1), box(b0, b1)], 'radians')
      return out
    }
    const twins = [S.modT, S.minT, S.maxT, S.hypotT]
    const fresh = twins.map((t) => jobs.map((j) => once(t, j)))
    for (let i = jobs.length - 1; i >= 0; i--) {
      // interleave every twin and the unary ones, in reverse
      for (const t of Object.values(UNARY_TWINS)) once(t, jobs[i])
      twins.forEach((t, k) => expect(same(once(t, jobs[i]), fresh[k][i]), `twin ${k} job ${i}`).toBe(true))
    }
  })
})

// ---------------------------------------------------------------------------
// The twin the registry holds is the one this file tests.
// ---------------------------------------------------------------------------

describe('the stepwise twins are in the interval evaluator', () => {
  it('floor(x) over a box through the registry is the twin', () => {
    const r = interval(p('floor(x)'), { x: box(0.5, 1) }, 'radians')
    expect(r).toMatchObject({ lo: 0, hi: 1, v: DEFINED })
  })
})
