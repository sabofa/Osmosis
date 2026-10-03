import { describe, expect, it, vi } from 'vitest'
import { parseExprString as p } from '../../parser/parseExpr'
import type { Expr } from '../../parser/types'
import { compileScalar } from '../compile'
import { makeScope } from '../scope'
import { add, div, mul, neg, powGeneral, powInt, sub } from './arith'
import { CONTINUOUS, DEFINED, iv, PARTIAL, setBox, UNKNOWN, type Iv } from './core'
import * as E from './elementary'
import { admits, mulberry32, pointsIn, randomBox, zerosIn } from './testkit'

// The sweeps are a second or two on a quiet machine; the default 5 s is for a loaded one.
vi.setConfig({ testTimeout: 60_000 })

type Angle = 'radians' | 'degrees'

const box = (lo: number, hi: number): Iv => setBox(iv(), lo, hi)
const fmt = (x: number): string => (Object.is(x, -0) ? '-0' : String(x))
const show = (r: Iv): string => `[${fmt(r.lo)}, ${fmt(r.hi)}] v${r.v}`
const run1 = (t: E.Twin, lo: number, hi: number, angle: Angle = 'radians') => {
  const out = iv()
  t(out, [box(lo, hi)], angle)
  return out
}
const within = (r: Iv, lo: number, hi: number, tol = 1e-12) => r.lo >= lo - tol && r.lo <= lo + tol && r.hi >= hi - tol && r.hi <= hi + tol
const isEmptyIv = (r: Iv) => r.lo > r.hi && r.v === PARTIAL
const HALF_PI = Math.PI / 2
// The soundness check, with its message built only when it fails (a sweep makes
// millions of checks, and an expect() with a template string for each is slow).
function must(r: Iv, y: number, why: () => string): void {
  if (!admits(r, y)) throw new Error(why())
}

describe('elementary twins are tight and honest on simple boxes', () => {
  it('sin and cos find their extremes', () => {
    expect(within(run1(E.sinT, 0, 1), 0, Math.sin(1))).toBe(true)
    expect(within(run1(E.sinT, 1, 2), Math.sin(1), 1)).toBe(true)
    expect(within(run1(E.cosT, 3, 3.5), -1, Math.cos(3.5) > Math.cos(3) ? Math.cos(3.5) : Math.cos(3))).toBe(true)
    expect(run1(E.sinT, -10, 10)).toMatchObject({ lo: -1, hi: 1, v: CONTINUOUS })
    expect(within(run1(E.sinT, 0, 30, 'degrees'), 0, 0.5, 1e-12)).toBe(true)
  })

  it('tan is partial across a pole and monotone between', () => {
    expect(run1(E.tanT, 1, 2)).toMatchObject({ lo: -Infinity, hi: Infinity, v: PARTIAL })
    const r = run1(E.tanT, 0, 1)
    expect(within(r, 0, Math.tan(1)) && r.v === CONTINUOUS).toBe(true)
  })

  it('sec, csc and cot are partial only at their own poles', () => {
    expect(run1(E.secT, 1, 2).v).toBe(PARTIAL)
    expect(run1(E.secT, -1, 1).v).toBe(CONTINUOUS)
    expect(run1(E.cscT, -1, 1).v).toBe(PARTIAL)
    expect(run1(E.cotT, 1, 2).v).toBe(CONTINUOUS)
    expect(run1(E.cotT, 3, 3.5).v).toBe(PARTIAL)
  })

  it('domain edges make a twin partial and clip its bounds', () => {
    expect(run1(E.sqrtT, -1, 4)).toMatchObject({ v: PARTIAL })
    expect(within(run1(E.sqrtT, -1, 4), 0, 2)).toBe(true)
    expect(run1(E.lnT, -1, 1)).toMatchObject({ lo: -Infinity, v: PARTIAL })
    expect(run1(E.asinT, 0.5, 2).v).toBe(PARTIAL)
    expect(run1(E.acoshT, 0, 2).v).toBe(PARTIAL)
    expect(run1(E.atanhT, -1, 0).v).toBe(PARTIAL)
    const empty = run1(E.lnT, -3, -1)
    expect(empty.lo > empty.hi && empty.v === PARTIAL).toBe(true)
  })

  it('abs and cosh bottom out at 0', () => {
    expect(within(run1(E.absT, -2, 1), 0, 2)).toBe(true)
    expect(within(run1(E.coshT, -1, 2), 1, Math.cosh(2))).toBe(true)
  })

  it('atan2 is defined but may jump across the negative x-axis and at the origin', () => {
    const t = (yl: number, yh: number, xl: number, xh: number) => {
      const out = iv()
      E.atan2T(out, [box(yl, yh), box(xl, xh)], 'radians')
      return out
    }
    expect(t(1, 2, 1, 2).v).toBe(CONTINUOUS)
    expect(t(-1, 1, -2, -1).v).toBeLessThan(CONTINUOUS)
    expect(t(-1, 1, -1, 1).v).toBeLessThan(CONTINUOUS)
  })

  it('cbrt and root(n, x)', () => {
    expect(within(run1(E.cbrtT, -8, 27), -2, 3)).toBe(true)
    const out = iv()
    E.rootT(out, [box(3, 3), box(-27, 8)], 'radians')
    expect(within(out, -3, 2) && out.v === CONTINUOUS).toBe(true)
    E.rootT(out, [box(2, 2), box(-1, 4)], 'radians')
    expect(out.v).toBe(PARTIAL)
  })
})

// The scalar each twin must enclose: the kernel's own compile of the built-in.
const UNARY = ['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'sqrt', 'abs', 'exp', 'ln', 'log', 'cbrt'] as const
type UnaryName = (typeof UNARY)[number]
const TWINS: Record<UnaryName, E.Twin> = {
  sin: E.sinT, cos: E.cosT, tan: E.tanT, sec: E.secT, csc: E.cscT, cot: E.cotT,
  asin: E.asinT, acos: E.acosT, atan: E.atanT,
  sinh: E.sinhT, cosh: E.coshT, tanh: E.tanhT, asinh: E.asinhT, acosh: E.acoshT, atanh: E.atanhT,
  sqrt: E.sqrtT, abs: E.absT, exp: E.expT, ln: E.lnT, log: E.logT, cbrt: E.cbrtT,
}

describe('elementary twins are sound over random boxes', () => {
  for (const angle of ['radians', 'degrees'] as const) {
    for (const name of UNARY) {
      it(`${name} (${angle})`, () => {
        const rand = mulberry32(name.length * 7919 + (angle === 'degrees' ? 1 : 0))
        const f = compileScalar(p(`${name}(x)`), ['x'], makeScope({ angle }))
        for (let i = 0; i < 500; i++) {
          const [lo, hi] = randomBox(rand)
          const r = run1(TWINS[name], lo, hi, angle)
          for (const x of pointsIn(lo, hi, rand, 6)) {
            must(r, f(x), () => `${name} [${lo}, ${hi}] at ${x} gives ${f(x)}, twin ${JSON.stringify(r)}`)
          }
        }
      })
    }
  }

  it('log(a, b), atan2(y, x) and root(n, x)', () => {
    const rand = mulberry32(31337)
    const scope = makeScope()
    const log2 = compileScalar(p('log(x, y)'), ['x', 'y'], scope)
    const at2 = compileScalar(p('atan2(x, y)'), ['x', 'y'], scope)
    const rt = compileScalar(p('root(x, y)'), ['x', 'y'], scope)
    for (let i = 0; i < 300; i++) {
      const [al, ah] = randomBox(rand)
      const [bl, bh] = randomBox(rand)
      const n = Math.round(rand() * 8 - 4)
      const rl = iv()
      E.logT(rl, [box(al, ah), box(bl, bh)], 'radians')
      const ra = iv()
      E.atan2T(ra, [box(al, ah), box(bl, bh)], 'radians')
      const rr = iv()
      E.rootT(rr, [box(n, n), box(bl, bh)], 'radians')
      for (const x of pointsIn(al, ah, rand, 3)) {
        for (const y of pointsIn(bl, bh, rand, 3)) {
          must(rl, log2(x, y), () => `log(${x}, ${y}) twin ${JSON.stringify(rl)}`)
          must(ra, at2(x, y), () => `atan2(${x}, ${y}) twin ${JSON.stringify(ra)}`)
        }
      }
      for (const y of pointsIn(bl, bh, rand, 6)) must(rr, rt(n, y), () => `root(${n}, ${y}) twin ${JSON.stringify(rr)}`)
    }
  })
})

// ---------------------------------------------------------------------------
// Edge boxes: what the random generator rarely reaches. Infinite ends, both signs
// of zero, subnormals, the doubles on either side of every pole, the edge of the
// range the trig twins trust, and the domain edges. Test points include the
// infinities and the signed zeros a box admits (a box with an infinite end really
// may produce that infinity, and 1 / +0 and 1 / -0 differ).
// ---------------------------------------------------------------------------

const f64 = new Float64Array(1)
const u64 = new BigUint64Array(f64.buffer)
function nextUp(x: number): number {
  if (Number.isNaN(x) || x === Infinity) return x
  if (x === 0) return Number.MIN_VALUE
  f64[0] = x
  u64[0] += x > 0 ? 1n : -1n
  return f64[0]
}
function nextDown(x: number): number {
  return -nextUp(-x)
}

const LARGE = 2 ** 20
const NEAR_POLES = [HALF_PI, Math.PI, 3 * HALF_PI, 2 * Math.PI, -HALF_PI, -Math.PI, 90, 180, 270, 360, -90, -180, 45, 1, -1, LARGE, 1e7]
const SPECIAL: number[] = [
  -Infinity, -1e300, -1e154, -1e7, -1e6, -7, -2, -0.5, -5e-324, 5e-324, 0.5, 2, 3, 7, 1e6, 1e154, 1e300, Infinity,
  ...NEAR_POLES.flatMap((x) => [x, nextUp(x), nextDown(x)]),
]

const EDGE_BOXES: [number, number][] = [
  // infinite ends
  [-Infinity, Infinity], [0, Infinity], [-Infinity, 0], [1, Infinity], [-Infinity, -1], [-0, Infinity], [-Infinity, -0],
  [Infinity, Infinity], [-Infinity, -Infinity], [-1, Infinity], [-Infinity, 1], [LARGE, Infinity],
  // zeros and subnormals
  [0, 0], [-0, 0], [-0, -0], [-0, 2], [0, 2], [-2, 0], [-2, -0], [0, 1e-300], [-1e-300, -0], [-1e-300, 1e-300],
  [-5e-324, 5e-324], [5e-324, 1e-300], [0, 5e-324], [-5e-324, -0], [1e-320, 1],
  // the unit scale and the domain edges of asin, acos, acosh, atanh, ln
  [-1, 1], [0, 1], [-1, 0], [0.5, 1], [-1, -0.5], [1, 1], [-1, -1], [0.5, 2], [-3, -1], [1, 2], [0, 0.5], [-2, -1], [2, 3], [1, 5],
  [1, nextUp(1)], [nextDown(1), 1], [-1, nextUp(-1)], [nextDown(-1), -1], [nextDown(1), nextUp(1)], [0.5, 1.5], [-0.5, 0.5],
  [nextDown(1), Infinity], [-Infinity, nextUp(-1)], [-1, -0],
  // the trig poles, their neighbours, and the periods
  [HALF_PI - 1e-9, HALF_PI + 1e-9], [HALF_PI, HALF_PI], [HALF_PI, 2], [1, HALF_PI], [Math.PI, Math.PI], [3, 3.5], [-Math.PI, Math.PI],
  [0, 2 * Math.PI], [0, 6.28], [-HALF_PI, HALF_PI], [HALF_PI, 3 * HALF_PI], [nextUp(HALF_PI), nextUp(nextUp(HALF_PI))],
  [HALF_PI, nextUp(HALF_PI)], [nextDown(HALF_PI), HALF_PI], [2 * Math.PI, 2 * Math.PI], [0, Math.PI], [0, 4], [4, 5], [5, 6.2],
  [-HALF_PI, -HALF_PI], [-Math.PI, -Math.PI], [3 * HALF_PI, 3 * HALF_PI], [Math.PI - 1e-3, Math.PI + 1e-3],
  // degrees: poles at 90, 180, 270, 360
  [0, 90], [90, 90], [180, 180], [0, 180], [-90, 90], [89, 91], [270, 270], [360, 360], [45, 45], [-90, -90], [0, 360], [89.5, 90],
  [nextDown(90), nextUp(90)], [nextDown(180), nextUp(180)], [179, 181], [269.9, 270.1], [30, 150], [0, 30], [-1, 1e-3],
  // large arguments, the edge of the trusted range, overflow
  [1e6, 1e6 + 1], [LARGE - 1, LARGE], [LARGE, LARGE + 1], [1e7, 1e7 + 0.1], [-1e6, -1e6 + 1], [1e300, 1e300], [1e154, 1e155],
  [1e300, 1.5e308], [-1e154, 1e155], [700, 800], [709, 710], [-800, -700], [-746, -745], [17, 19], [-30, -20], [20, 40],
]

const pointsOf = (lo: number, hi: number, rand: () => number): number[] => {
  const pts = [lo, hi, (lo + hi) / 2, ...SPECIAL].filter((x) => x !== 0 && lo <= x && x <= hi)
  for (const z of zerosIn(lo, hi)) pts.push(z)
  if (Number.isFinite(lo) && Number.isFinite(hi)) for (const x of pointsIn(lo, hi, rand, 4)) if (x !== 0) pts.push(x)
  return pts
}

describe('elementary twins are sound on the edge boxes', () => {
  for (const angle of ['radians', 'degrees'] as const) {
    for (const name of UNARY) {
      it(`${name} (${angle})`, () => {
        const rand = mulberry32(2026 + name.length)
        const f = compileScalar(p(`${name}(x)`), ['x'], makeScope({ angle }))
        for (const [lo, hi] of EDGE_BOXES) {
          const r = run1(TWINS[name], lo, hi, angle)
          for (const x of pointsOf(lo, hi, rand)) {
            const y = f(x)
            must(r, y, () => `${name} over [${fmt(lo)}, ${fmt(hi)}] at ${fmt(x)} gives ${fmt(y)}, twin ${show(r)}`)
          }
        }
      })
    }
  }

  // two-argument twins over every pair of a smaller set of edge boxes
  const PAIR_BOXES: [number, number][] = [
    [-Infinity, Infinity], [0, Infinity], [-Infinity, 0], [1, Infinity], [-Infinity, -1], [0, 0], [-0, 0], [-0, -0], [-0, 2], [0, 2], [-2, 0], [-2, -0],
    [-1, 1], [-1e-300, 1e-300], [0.5, 2], [-3, -1], [1, 1], [-1, -1], [1, 2], [0.25, 4], [-5e-324, 5e-324], [1e154, 1e155], [Infinity, Infinity], [-Infinity, -Infinity],
    [-1, 0], [0, 1], [-0.5, 0], [nextDown(1), nextUp(1)], [-0, 1],
  ]
  const angles: Angle[] = ['radians', 'degrees']
  for (const angle of angles) {
    it(`atan2 (${angle})`, () => {
      const rand = mulberry32(777)
      const f = compileScalar(p('atan2(x, y)'), ['x', 'y'], makeScope({ angle }))
      for (const [yl, yh] of PAIR_BOXES) {
        for (const [xl, xh] of PAIR_BOXES) {
          const out = iv()
          E.atan2T(out, [box(yl, yh), box(xl, xh)], angle)
          for (const y of pointsOf(yl, yh, rand)) {
            for (const x of pointsOf(xl, xh, rand)) {
              const v = f(y, x)
              must(out, v, () => `atan2 y [${fmt(yl)}, ${fmt(yh)}] x [${fmt(xl)}, ${fmt(xh)}] at (${fmt(y)}, ${fmt(x)}) gives ${fmt(v)}, twin ${show(out)}`)
            }
          }
        }
      }
    })
  }

  it('log(a, b)', () => {
    const rand = mulberry32(778)
    const f = compileScalar(p('log(x, y)'), ['x', 'y'], makeScope())
    for (const [al, ah] of PAIR_BOXES) {
      for (const [bl, bh] of PAIR_BOXES) {
        const out = iv()
        E.logT(out, [box(al, ah), box(bl, bh)], 'radians')
        for (const x of pointsOf(al, ah, rand)) {
          for (const y of pointsOf(bl, bh, rand)) {
            const v = f(x, y)
            must(out, v, () => `log a [${fmt(al)}, ${fmt(ah)}] b [${fmt(bl)}, ${fmt(bh)}] at (${fmt(x)}, ${fmt(y)}) gives ${fmt(v)}, twin ${show(out)}`)
          }
        }
      }
    }
  })

  it('root(n, x) for every whole n, and for a box of n', () => {
    const rand = mulberry32(779)
    const f = compileScalar(p('root(x, y)'), ['x', 'y'], makeScope())
    const NS = [-1e300, -7, -6, -5, -4, -3, -2, -1, -0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 1e300, 0.5, -0.5, 2.5, Infinity, -Infinity]
    for (const n of NS) {
      for (const [bl, bh] of EDGE_BOXES) {
        const out = iv()
        E.rootT(out, [box(n, n), box(bl, bh)], 'radians')
        for (const y of pointsOf(bl, bh, rand)) {
          const v = f(n, y)
          must(out, v, () => `root(${fmt(n)}, x) over [${fmt(bl)}, ${fmt(bh)}] at ${fmt(y)} gives ${fmt(v)}, twin ${show(out)}`)
        }
      }
    }
    // a box of indices: every whole n in it, and an empty answer only when it holds none
    for (const [nl, nh] of [[2, 4], [-3, -1], [0.2, 0.9], [-1, 1], [3, 3.5], [-Infinity, Infinity], [-0.5, 0.5], [2.5, 2.75]] as [number, number][]) {
      for (const [bl, bh] of PAIR_BOXES) {
        const out = iv()
        E.rootT(out, [box(nl, nh), box(bl, bh)], 'radians')
        for (const n of [nl, nh, ...[-3, -2, -1, 0, 1, 2, 3, 4].filter((k) => nl <= k && k <= nh)]) {
          for (const y of pointsOf(bl, bh, rand)) {
            const v = f(n, y)
            must(out, v, () => `root(${fmt(n)}, x) over n [${nl}, ${nh}] x [${fmt(bl)}, ${fmt(bh)}] at ${fmt(y)} gives ${fmt(v)}, twin ${show(out)}`)
          }
        }
      }
    }
  })
})

// The poles and peaks of the trig twins at the true positions j * pi/2, from pi to 50
// digits, up to the edge of the range they trust (2^20 radians): the box is the double
// nearest the true position and a few ulps either side, and every double in it is tried.
// (With the slack in `hits` removed this test fails: a box that holds a pole is answered as
// pole-free, because the computed position j * pi/2 is a few 1e-10 off at 1e6.)
describe('trig poles and peaks are found where they really are', () => {
  const PI_50 = 314159265358979323846264338327950288419716939937510n
  const SCALE = 10n ** 50n
  function nearestDouble(j: bigint): number {
    const big = (PI_50 * j) / 2n
    const a = big < 0n ? -big : big
    const v = Number(`${a / SCALE}.${(a % SCALE).toString().padStart(50, '0')}`)
    return big < 0n ? -v : v
  }
  const NAMES = ['sin', 'cos', 'tan', 'sec', 'csc', 'cot'] as const

  for (const angle of ['radians', 'degrees'] as const) {
    it(`sin, cos, tan, sec, csc, cot around j * pi/2 (${angle})`, () => {
      const rand = mulberry32(5150)
      const fs = NAMES.map((n) => compileScalar(p(`${n}(x)`), ['x'], makeScope({ angle })))
      for (let trial = 0; trial < 1500; trial++) {
        const j = BigInt(Math.floor((rand() < 0.5 ? rand() : rand() * rand() * rand()) * 2 * 667000) - 667000)
        const c = angle === 'degrees' ? Number(j) * 90 : nearestDouble(j)
        let lo = c
        let hi = c
        const steps = Math.floor(rand() * 5)
        const below = Math.floor(rand() * (steps + 1))
        for (let i = 0; i < below; i++) lo = nextDown(lo)
        for (let i = 0; i < steps - below; i++) hi = nextUp(hi)
        if (rand() < 0.3) {
          // wider, ending a hair before or after the pole
          const w = Math.pow(10, -rand() * 12)
          lo = c - (rand() < 0.5 ? w : 0)
          hi = c + (rand() < 0.5 ? w : 0)
          if (rand() < 0.3) hi = c - w * 0.1
          if (rand() < 0.3) lo = c + w * 0.1
          if (!(lo <= hi)) [lo, hi] = [hi, lo]
        }
        const pts = [lo, hi, ...zerosIn(lo, hi)]
        let x = c
        for (let i = 0; i < 4; i++) {
          x = nextDown(x)
          pts.push(x)
        }
        x = c
        for (let i = 0; i < 4; i++) {
          x = nextUp(x)
          pts.push(x)
        }
        pts.push(c, lo + (hi - lo) * rand())
        const inside = pts.filter((v) => lo <= v && v <= hi)
        NAMES.forEach((name, k) => {
          const r = run1(TWINS[name], lo, hi, angle)
          for (const v of inside) must(r, fs[k](v), () => `${name} ${angle} [${fmt(lo)}, ${fmt(hi)}] at ${fmt(v)} gives ${fmt(fs[k](v))}, twin ${show(r)}`)
        })
      }
    })
  }
})

// ---------------------------------------------------------------------------
// What the contract and the rulings pin on particular boxes.
// ---------------------------------------------------------------------------

describe('infinities, poles and signed zeros', () => {
  it('ln over a box reaching 0 holds the scalar infinity, and a box at 0 is not empty', () => {
    expect(run1(E.lnT, 0, 1)).toMatchObject({ lo: -Infinity, v: PARTIAL })
    expect(run1(E.lnT, -0, 1)).toMatchObject({ lo: -Infinity, v: PARTIAL })
    for (const [lo, hi] of [[0, 0], [-0, -0], [-0, 0], [-1, 0], [-1, -0]] as [number, number][]) {
      const r = run1(E.lnT, lo, hi)
      expect(r.lo, `ln over [${fmt(lo)}, ${fmt(hi)}]`).toBe(-Infinity)
      expect(r.v).toBe(PARTIAL)
      expect(r.lo <= r.hi).toBe(true)
      const l10 = run1(E.logT, lo, hi)
      expect(l10.lo).toBe(-Infinity)
      expect(l10.v).toBe(PARTIAL)
    }
    expect(isEmptyIv(run1(E.lnT, -2, -1e-300))).toBe(true)
    expect(isEmptyIv(run1(E.logT, -2, -1e-300))).toBe(true)
  })

  it('atanh at the poles', () => {
    expect(run1(E.atanhT, 1, 1)).toMatchObject({ lo: Infinity, hi: Infinity, v: PARTIAL })
    expect(run1(E.atanhT, -1, -1)).toMatchObject({ lo: -Infinity, hi: -Infinity, v: PARTIAL })
    expect(run1(E.atanhT, 0.5, 1)).toMatchObject({ hi: Infinity, v: PARTIAL })
    expect(run1(E.atanhT, -1, 1)).toMatchObject({ lo: -Infinity, hi: Infinity, v: PARTIAL })
    expect(run1(E.atanhT, 0.25, 0.5).v).toBe(CONTINUOUS)
    expect(isEmptyIv(run1(E.atanhT, 1.5, 2))).toBe(true)
  })

  it('acosh, asin and acos are defined at their closed domain edges', () => {
    expect(run1(E.acoshT, 1, 2).v).toBe(CONTINUOUS)
    expect(run1(E.asinT, -1, 1).v).toBe(CONTINUOUS)
    expect(run1(E.acosT, -1, 1).v).toBe(CONTINUOUS)
    expect(isEmptyIv(run1(E.asinT, 1.5, 2))).toBe(true)
    expect(isEmptyIv(run1(E.acoshT, -3, 0.5))).toBe(true)
  })

  it('tan across a pole is the whole line, and the double nearest pi/2 is inside it', () => {
    expect(run1(E.tanT, 1, 2)).toMatchObject({ lo: -Infinity, hi: Infinity })
    expect(run1(E.tanT, HALF_PI - 1e-12, HALF_PI + 1e-12)).toMatchObject({ lo: -Infinity, hi: Infinity, v: PARTIAL })
    const r = run1(E.tanT, HALF_PI, HALF_PI)
    expect(admits(r, Math.tan(HALF_PI))).toBe(true)
    expect(run1(E.tanT, 0, 90, 'degrees').v).toBe(PARTIAL)
    expect(run1(E.tanT, 0, 89, 'degrees').v).toBe(CONTINUOUS)
  })

  it('a trig twin over an infinite argument is partial (sin(inf) is NaN)', () => {
    for (const t of [E.sinT, E.cosT, E.tanT, E.secT, E.cscT, E.cotT]) {
      for (const angle of ['radians', 'degrees'] as const) {
        for (const [lo, hi] of [[0, Infinity], [-Infinity, 0], [-Infinity, Infinity], [Infinity, Infinity], [-Infinity, -1e300]] as [number, number][]) {
          const r = run1(t, lo, hi, angle)
          expect(r.v, `${angle} over [${lo}, ${hi}]`).toBeLessThanOrEqual(PARTIAL)
          expect(admits(r, Number.NaN)).toBe(true)
        }
      }
    }
  })

  it('a large finite argument is still defined: the range, not a pole', () => {
    expect(run1(E.sinT, 1e7, 1e7 + 1)).toMatchObject({ lo: -1, hi: 1, v: CONTINUOUS })
    expect(run1(E.cosT, 1e300, 1e300)).toMatchObject({ lo: -1, hi: 1, v: CONTINUOUS })
  })

  it('sec, csc and cot give the scalar values at the zeros they have', () => {
    // csc(+-0) = +-inf, cot(+-0) = +-inf
    for (const t of [E.cscT, E.cotT]) {
      for (const z of [0, -0]) {
        const r = run1(t, z, z)
        expect(r.v).toBe(PARTIAL)
        expect(r.lo, `${z === 0 ? '+0' : '-0'}`).toBe(-Infinity)
        expect(r.hi).toBe(Infinity)
      }
    }
    // one-sided where the zero has the sign of the side the box lies on
    const up = run1(E.cscT, 0, 1)
    expect(up).toMatchObject({ hi: Infinity, v: PARTIAL })
    expect(up.lo).toBeGreaterThan(1.18)
    expect(up.lo).toBeLessThan(1.19)
    // but not when the zero is the other sign: x = -0 gives -inf too
    expect(run1(E.cscT, -0, 1)).toMatchObject({ lo: -Infinity, hi: Infinity, v: PARTIAL })
    const cot = run1(E.cotT, 0, 1)
    expect(cot).toMatchObject({ hi: Infinity, v: PARTIAL })
    expect(cot.lo).toBeGreaterThan(0.64)
    expect(cot.lo).toBeLessThan(0.65)
  })

  it('cot between its poles is monotone, so its bounds are the values at the ends', () => {
    // a quotient of the ranges of cos and sin would give [-7.02, 6.22] here (cos is at its
    // greatest where sin is not at its least); cot decreases from cot(0.5) to cot(3)
    expect(within(run1(E.cotT, 0.5, 3), 1 / Math.tan(3), 1 / Math.tan(0.5), 1e-12)).toBe(true)
    expect(run1(E.cotT, 0.5, 3).v).toBe(CONTINUOUS)
    // across the pole of tan: cot is 0 there and the answer straddles it
    expect(within(run1(E.cotT, 1, 2), 1 / Math.tan(2), 1 / Math.tan(1), 1e-12)).toBe(true)
    expect(within(run1(E.cotT, 20, 160, 'degrees'), 1 / Math.tan(160 * (Math.PI / 180)), 1 / Math.tan(20 * (Math.PI / 180)), 1e-12)).toBe(true)
  })

  it('cot is continuous through the pole of tan', () => {
    const r = run1(E.cotT, HALF_PI - 0.1, HALF_PI + 0.1)
    expect(r.v).toBe(CONTINUOUS)
    expect(r.lo).toBeLessThan(0)
    expect(r.hi).toBeGreaterThan(0)
    expect(run1(E.cotT, 80, 100, 'degrees').v).toBe(CONTINUOUS)
    expect(run1(E.cotT, 170, 190, 'degrees').v).toBe(PARTIAL)
  })

  it('atan2 at the signed zeros', () => {
    const t = (yl: number, yh: number, xl: number, xh: number, angle: Angle = 'radians') => {
      const out = iv()
      E.atan2T(out, [box(yl, yh), box(xl, xh)], angle)
      return out
    }
    // atan2(+-0, -1) = +-pi
    const pos = t(0, 0, -1, -1)
    expect(admits(pos, Math.PI) && !admits(pos, -Math.PI)).toBe(true)
    const negz = t(-0, -0, -1, -1)
    expect(admits(negz, -Math.PI) && !admits(negz, Math.PI)).toBe(true)
    // a box that holds +0 below nothing: on the cut but on one side of it, so continuous
    const upper = t(0, 1, -2, -1)
    expect(upper.v).toBe(CONTINUOUS)
    expect(within(upper, Math.atan2(1, -1), Math.PI, 1e-12)).toBe(true)
    const lower = t(-1, -0, -2, -1)
    expect(lower.v).toBe(CONTINUOUS)
    expect(within(lower, -Math.PI, Math.atan2(-1, -1), 1e-12)).toBe(true)
    // the other zero signs jump
    expect(t(-0, 1, -2, -1).v).toBe(DEFINED)
    expect(t(-1, 0, -2, -1).v).toBe(DEFINED)
    expect(t(-1, 1, -2, -1).v).toBe(DEFINED)
    // the origin
    expect(t(0, 1, 0, 1).v).toBe(DEFINED)
    expect(within(t(0, 1, 0, 1), 0, HALF_PI, 1e-12)).toBe(true)
    // the right half-plane and the upper half-plane are continuous
    expect(t(-1, 1, 1, 2).v).toBe(CONTINUOUS)
    expect(t(1, 2, -1, 1).v).toBe(CONTINUOUS)
    expect(within(t(1, 2, -1, 1), Math.atan2(1, 1), Math.atan2(1, -1), 1e-12)).toBe(true)
    // atan2(y, +-0) with y of one sign is +-pi/2
    expect(within(t(1, 2, 0, 0), HALF_PI - Math.atan(0), HALF_PI, 1e-12)).toBe(true)
    // degrees
    expect(within(t(1, 1, 1, 1, 'degrees'), 45, 45, 1e-12)).toBe(true)
    expect(within(t(0, 0, -1, -1, 'degrees'), 180, 180, 1e-12)).toBe(true)
    // an infinite end is a direction, not a NaN
    expect(t(1, Infinity, 1, Infinity).v).toBe(CONTINUOUS)
    expect(within(t(1, Infinity, 1, Infinity), 0, HALF_PI, 1e-12)).toBe(true)
  })

  // A bound that is exactly a zero claims that signed zero and no other (1 / +0 and 1 / -0
  // differ, sqrt(-0) is -0, atan2(+-0, -1) is +-pi), so a twin may only emit one when it is
  // so: sin(+-0), sqrt(+-0) and ln(1) are exact, but a box with 0 strictly inside holds both
  // zeros, and atan2(-5e-324, 2) underflows to -0. The chain sweep found each of these.
  it('a zero bound is the signed zero the box holds, never a claim about the other', () => {
    const sign = (x: number) => (Object.is(x, -0) ? '-0' : Object.is(x, 0) ? '+0' : x < 0 ? '-' : '+')
    // a zero end gives that zero, exactly
    expect(sign(run1(E.sinT, 0, 1).lo)).toBe('+0')
    expect(sign(run1(E.sinT, -0, 1).lo)).toBe('-0')
    expect(sign(run1(E.sinT, -1, 0).hi)).toBe('+0')
    expect(sign(run1(E.sinT, -1, -0).hi)).toBe('-0')
    expect(sign(run1(E.sinT, 0, 1, 'degrees').lo)).toBe('+0')
    expect(sign(run1(E.sinT, -1, -0, 'degrees').hi)).toBe('-0')
    expect(sign(run1(E.atanT, -0, 1, 'degrees').lo)).toBe('-0')
    expect(sign(run1(E.sqrtT, 0, 4).lo)).toBe('+0')
    expect(sign(run1(E.sqrtT, -0, 4).lo)).toBe('-0')
    expect(sign(run1(E.lnT, 1, 2).lo)).toBe('+0')
    expect(sign(run1(E.acosT, 0, 1).lo)).toBe('+0')
    expect(sign(run1(E.acoshT, 1, 2).lo)).toBe('+0')
    expect(sign(run1(E.absT, -0, 3).lo)).toBe('+0')
    expect(sign(run1(E.absT, -3, 2).lo)).toBe('+0')
    // a box that ends at a zero and reaches below it: sqrt has that zero and NaN
    expect(run1(E.sqrtT, -1, 0)).toMatchObject({ v: PARTIAL })
    expect(sign(run1(E.sqrtT, -1, 0).lo) + sign(run1(E.sqrtT, -1, 0).hi)).toBe('+0+0')
    expect(sign(run1(E.sqrtT, -1, -0).lo) + sign(run1(E.sqrtT, -1, -0).hi)).toBe('-0-0')
    // 0 strictly inside holds both zeros, so no bound may be exactly one of them
    const inside = run1(E.sqrtT, -1, 4)
    expect(inside.lo).toBeLessThan(0)
    expect(inside.lo).toBeGreaterThan(-1e-300)
    // a degree end that underflows when scaled is not a zero end
    expect(run1(E.sinT, -5e-324, 1, 'degrees').lo).toBeLessThan(0)
    expect(run1(E.sinT, -1, 5e-324, 'degrees').hi).toBeGreaterThan(0)
    // and a zero end with the box reaching past it holds the other zero too: x * pi/180
    // underflows to a zero with the sign of x (found by the chain sweep, sqrt(tan(x))^-1)
    expect(run1(E.sinT, -0, 1, 'degrees').lo).toBeLessThan(0)
    expect(run1(E.sinT, -1, 0, 'degrees').hi).toBeGreaterThan(0)
    expect(run1(E.tanT, -0.5, 0, 'degrees').hi).toBeGreaterThan(0)
    // a point box, or a box on its zero's own side, stays exact
    expect(sign(run1(E.sinT, -0, -0, 'degrees').lo) + sign(run1(E.sinT, -0, -0, 'degrees').hi)).toBe('-0-0')
    expect(sign(run1(E.tanT, 0, 0.5, 'degrees').lo)).toBe('+0')
    expect(sign(run1(E.tanT, -0.5, -0, 'degrees').hi)).toBe('-0')
    // atan2 underflows: its bounds are never exact zeros
    const a2 = iv()
    E.atan2T(a2, [box(0, 1), box(1, 2)], 'radians')
    expect(a2.lo).toBeLessThan(0)
    const a3 = iv()
    E.atan2T(a3, [box(-1, 0), box(1, 2)], 'radians')
    expect(a3.hi).toBeGreaterThan(0)
  })

  it('overflow keeps its verdict and becomes an infinite bound', () => {
    for (const t of [E.expT, E.sinhT, E.coshT]) {
      const r = run1(t, 800, 800)
      expect(r.v).toBe(CONTINUOUS)
      expect(r.hi).toBe(Infinity)
      const wide = run1(t, 1, 1000)
      expect(wide.v).toBe(CONTINUOUS)
      expect(wide.hi).toBe(Infinity)
    }
    expect(run1(E.sinhT, -1000, 1)).toMatchObject({ lo: -Infinity, v: CONTINUOUS })
    expect(run1(E.expT, -1000, -800).lo).toBe(0)
    expect(run1(E.expT, -1000, -800).v).toBe(CONTINUOUS)
  })

  it('exp, abs, cosh and sqrt never go below their own floor', () => {
    expect(run1(E.expT, -1000, 1).lo).toBe(0)
    expect(run1(E.absT, -3, 2).lo).toBe(0)
    expect(run1(E.absT, -3, 2).hi).toBe(3)
    expect(run1(E.coshT, -3, 2).lo).toBe(1)
    expect(run1(E.sqrtT, 0, 4).lo).toBe(0)
    expect(run1(E.sinT, 1, 2).hi).toBe(1)
    expect(run1(E.cosT, -1, 1).hi).toBe(1)
    expect(run1(E.tanhT, 17, 40).hi).toBe(1)
  })

  it('an empty input is an empty, partial answer', () => {
    const empty = iv(Infinity, -Infinity, PARTIAL)
    for (const name of UNARY) {
      for (const angle of ['radians', 'degrees'] as const) {
        const out = iv(0, 1, CONTINUOUS)
        TWINS[name](out, [{ ...empty }], angle)
        expect(isEmptyIv(out), `${name} ${angle}`).toBe(true)
      }
    }
    const out = iv()
    E.atan2T(out, [empty, box(0, 1)], 'radians')
    expect(isEmptyIv(out)).toBe(true)
    E.atan2T(out, [box(0, 1), empty], 'radians')
    expect(isEmptyIv(out)).toBe(true)
    E.logT(out, [empty, box(2, 3)], 'radians')
    expect(isEmptyIv(out)).toBe(true)
    E.logT(out, [box(2, 3), empty], 'radians')
    expect(isEmptyIv(out)).toBe(true)
    E.rootT(out, [box(3, 3), empty], 'radians')
    expect(isEmptyIv(out)).toBe(true)
    E.rootT(out, [empty, box(1, 3)], 'radians')
    expect(isEmptyIv(out)).toBe(true)
  })

  it('the verdict is the weakest of the input and the twin', () => {
    const unknown = iv(-Infinity, Infinity, UNKNOWN)
    for (const name of UNARY) {
      for (const angle of ['radians', 'degrees'] as const) {
        const out = iv()
        TWINS[name](out, [{ ...unknown }], angle)
        expect(out.v, `${name} ${angle}`).toBe(UNKNOWN)
      }
    }
    for (const name of UNARY) {
      const out = iv()
      TWINS[name](out, [iv(0.25, 0.5, DEFINED)], 'radians')
      expect(out.v, `${name} of a DEFINED box`).toBeLessThanOrEqual(DEFINED)
      TWINS[name](out, [iv(0.25, 0.5, PARTIAL)], 'radians')
      expect(out.v, `${name} of a PARTIAL box`).toBeLessThanOrEqual(PARTIAL)
    }
    const out = iv()
    E.atan2T(out, [iv(1, 2, DEFINED), box(1, 2)], 'radians')
    expect(out.v).toBe(DEFINED)
    E.atan2T(out, [box(1, 2), iv(1, 2, PARTIAL)], 'radians')
    expect(out.v).toBe(PARTIAL)
    E.logT(out, [iv(2, 3, DEFINED), box(2, 3)], 'radians')
    expect(out.v).toBe(DEFINED)
    E.rootT(out, [box(3, 3), iv(1, 2, DEFINED)], 'radians')
    expect(out.v).toBe(DEFINED)
    E.rootT(out, [iv(3, 3, DEFINED), box(1, 2)], 'radians')
    expect(out.v).toBe(DEFINED)
    E.rootT(out, [box(2, 4), box(1, 2)], 'radians')
    expect(out.v).toBe(UNKNOWN)
  })
})

describe('degrees', () => {
  it('trig scales its argument by pi/180, inverse trig its result by 180/pi', () => {
    expect(within(run1(E.sinT, 30, 30, 'degrees'), 0.5, 0.5)).toBe(true)
    expect(within(run1(E.cosT, 60, 60, 'degrees'), 0.5, 0.5)).toBe(true)
    expect(within(run1(E.tanT, 45, 45, 'degrees'), 1, 1)).toBe(true)
    expect(within(run1(E.secT, 60, 60, 'degrees'), 2, 2)).toBe(true)
    expect(within(run1(E.cscT, 30, 30, 'degrees'), 2, 2)).toBe(true)
    expect(within(run1(E.cotT, 45, 45, 'degrees'), 1, 1)).toBe(true)
    expect(within(run1(E.asinT, 0.5, 0.5, 'degrees'), 30, 30)).toBe(true)
    expect(within(run1(E.acosT, 0.5, 0.5, 'degrees'), 60, 60)).toBe(true)
    expect(within(run1(E.atanT, 1, 1, 'degrees'), 45, 45)).toBe(true)
    expect(within(run1(E.sinT, 0, 90, 'degrees'), 0, 1)).toBe(true)
    expect(within(run1(E.cosT, 0, 180, 'degrees'), -1, 1)).toBe(true)
  })

  it('hyperbolic, root and log twins ignore the unit', () => {
    for (const t of [E.sinhT, E.coshT, E.tanhT, E.asinhT, E.sqrtT, E.expT, E.lnT, E.cbrtT, E.absT]) {
      const a = run1(t, 0.5, 2, 'radians')
      const b = run1(t, 0.5, 2, 'degrees')
      expect(b).toEqual(a)
    }
  })

  it('the unit matches the compile at the same box', () => {
    const rad = compileScalar(p('sin(x)'), ['x'], makeScope())
    const deg = compileScalar(p('sin(x)'), ['x'], makeScope({ angle: 'degrees' }))
    const r1 = run1(E.sinT, 0, 1)
    const r2 = run1(E.sinT, 0, 1, 'degrees')
    expect(admits(r1, rad(1)) && admits(r2, deg(1))).toBe(true)
    expect(r2.hi).toBeLessThan(0.02)
    expect(r1.hi).toBeGreaterThan(0.8)
  })
})

describe('log and root', () => {
  it('log(a) is base 10 and log(a, b) is ln a / ln b', () => {
    const a = run1(E.logT, 1, 1000)
    expect(within(a, 0, 3)).toBe(true)
    const out = iv()
    E.logT(out, [box(8, 8), box(2, 2)], 'radians')
    expect(within(out, 3, 3, 1e-12)).toBe(true)
    E.logT(out, [box(2, 8), box(2, 2)], 'radians')
    expect(within(out, 1, 3, 1e-12) && out.v === CONTINUOUS).toBe(true)
    // log in base 1 is a division by ln 1 = 0: a pole
    E.logT(out, [box(2, 8), box(1, 1)], 'radians')
    expect(out.v).toBe(PARTIAL)
    expect(out.lo).toBe(-Infinity)
    expect(out.hi).toBe(Infinity)
  })

  it('root(n, x) mirrors special.ts: n = 1, 2, 3, even, odd and negative', () => {
    const r = (n: number, lo: number, hi: number) => {
      const out = iv()
      E.rootT(out, [box(n, n), box(lo, hi)], 'radians')
      return out
    }
    expect(within(r(1, -2, 5), -2, 5) && r(1, -2, 5).v === CONTINUOUS).toBe(true)
    expect(within(r(2, 1, 9), 1, 3)).toBe(true)
    expect(within(r(3, -8, 8), -2, 2)).toBe(true)
    expect(within(r(4, 1, 16), 1, 2)).toBe(true)
    expect(r(4, -1, 16).v).toBe(PARTIAL)
    expect(within(r(4, -1, 16), 0, 2)).toBe(true)
    expect(within(r(5, -32, 32), -2, 2) && r(5, -32, 32).v === CONTINUOUS).toBe(true)
    expect(within(r(-2, 4, 16), 0.25, 0.5)).toBe(true)
    expect(within(r(-3, 1, 8), 0.5, 1)).toBe(true)
    expect(within(r(-1, 2, 4), 0.25, 0.5)).toBe(true)
    expect(r(-3, -1, 1).v).toBe(PARTIAL)
    // a non-whole or zero index is NaN everywhere
    expect(isEmptyIv(r(0.7, 1, 2))).toBe(true)
    expect(isEmptyIv(r(0, 1, 2))).toBe(true)
    expect(isEmptyIv(r(Infinity, 1, 2))).toBe(true)
    // an even root of a negative number is NaN
    expect(isEmptyIv(r(2, -4, -1))).toBe(true)
    expect(isEmptyIv(r(6, -4, -1))).toBe(true)
    // a box of indices holding no whole number is NaN; one holding some has no cheap enclosure
    const out = iv()
    E.rootT(out, [box(0.2, 0.9), box(1, 2)], 'radians')
    expect(isEmptyIv(out)).toBe(true)
    E.rootT(out, [box(2, 4), box(1, 2)], 'radians')
    expect(out).toMatchObject({ lo: -Infinity, hi: Infinity, v: UNKNOWN })
  })
})

// ---------------------------------------------------------------------------
// Composition. A twin is only as sound as the twins that consume its answer, and
// the question each case asks is whether the NEXT twin still holds the value the
// scalar chain gives. Expressions are written as text: the scalar is the kernel's
// own compile of it, the interval is the twins chained as the text says.
// ---------------------------------------------------------------------------

function interval(expr: Expr, env: Record<string, Iv>, angle: Angle): Iv {
  const ev = (e: Expr): Iv => interval(e, env, angle)
  switch (expr.kind) {
    case 'num':
      return box(expr.value, expr.value)
    case 'var': {
      const v = env[expr.name]
      if (!v) throw new Error(`unbound ${expr.name}`)
      return { ...v }
    }
    case 'unary':
      return neg(iv(), ev(expr.arg))
    case 'binary': {
      const l = ev(expr.left)
      const r = ev(expr.right)
      switch (expr.op) {
        case '+':
          return add(iv(), l, r)
        case '-':
          return sub(iv(), l, r)
        case '*':
          return mul(iv(), l, r)
        case '/':
          return div(iv(), l, r)
        case '^':
          return expr.right.kind === 'num' && Number.isInteger(expr.right.value) ? powInt(iv(), l, expr.right.value) : powGeneral(iv(), l, r)
      }
      throw new Error('unreachable')
    }
    case 'call': {
      const twin = (E as unknown as Record<string, E.Twin | undefined>)[`${expr.name}T`]
      if (!twin) throw new Error(`no twin for ${expr.name}`)
      const out = iv()
      twin(out, expr.args.map(ev), angle)
      return out
    }
    default:
      throw new Error('unsupported node')
  }
}

// the boxes a zero end allows: each zero end as +0 and as -0
function withZeroSigns(lo: number, hi: number): [number, number][] {
  const los = lo === 0 ? [0, -0] : [lo]
  const his = hi === 0 ? [0, -0] : [hi]
  const out: [number, number][] = []
  for (const l of los) for (const h of his) out.push([l, h])
  return out
}

const COMPOSE_BOXES: [number, number][] = [
  [-Infinity, Infinity], [0, Infinity], [-Infinity, 0], [1, Infinity], [-Infinity, -1], [0, 0], [-0, 0], [-0, 2], [0, 2], [-2, 0], [-1, 1],
  [-1e-300, 1e-300], [-5e-324, 5e-324], [0, 1], [-1, 0], [0.5, 2], [-3, -1], [1, 1], [-8, 8], [0, 1e-300], [-1e-300, 0],
  [-HALF_PI, HALF_PI], [0, HALF_PI], [HALF_PI, Math.PI], [0, Math.PI], [1, 2], [3, 3.5], [-Math.PI, Math.PI], [0, 2 * Math.PI], [0, 90], [-90, 90], [89, 91],
  [0, 180], [1e6, 1e6 + 1], [1e7, 1e7 + 1], [-1, -0], [-0.5, 0.5], [0.25, 4], [nextDown(1), nextUp(1)], [-30, 30], [700, 800], [-800, -700], [1e154, 1e155],
]

function checkComposed(src: string, angle: Angle, boxes: [number, number][] = COMPOSE_BOXES): void {
  const expr = p(src)
  const f = compileScalar(expr, ['x'], makeScope({ angle }))
  const rand = mulberry32(src.length * 31 + 5)
  for (const [lo, hi] of boxes) {
    for (const [l, h] of withZeroSigns(lo, hi)) {
      const r = interval(expr, { x: box(l, h) }, angle)
      for (const x of pointsOf(l, h, rand)) {
        const y = f(x)
        must(r, y, () => `${src} (${angle}) over [${fmt(l)}, ${fmt(h)}] at ${fmt(x)} gives ${fmt(y)}, twin ${show(r)}`)
      }
    }
  }
}

const PAIR_BOXES_SMALL: [number, number][] = [
  [-Infinity, Infinity], [0, 0], [-0, 0], [-0, -0], [-0, 2], [0, 2], [-2, 0], [-2, -0], [-1, 1], [0.5, 2], [-3, -1], [1, 1], [-1e-300, 1e-300], [0, Infinity], [-Infinity, -0], [-0, 1],
]

describe('composed elementary twins stay sound', () => {
  const ONE_VAR = [
    '1/sin(x)', '1/cos(x)', '1/tan(x)', 'sec(x)*cos(x)', 'csc(x)/x', 'cot(x)*tan(x)', 'ln(tan(x))', 'ln(sin(x))', 'ln(cos(x))', 'sqrt(cos(x))', 'sqrt(sin(x))',
    'sqrt(tan(x))', 'exp(-1/x)', 'exp(1/x)', 'exp(-x)', 'exp(x)/x', 'ln(exp(x))', 'exp(ln(x))', '1/ln(x)', '1/exp(x)', 'ln(1/x)', 'ln(x)/x', 'sqrt(abs(x))',
    'sqrt(x^2)', 'sqrt(x^2 + 1)', 'sqrt(1 - x^2)', '1/sqrt(x)', '1/abs(x)', 'ln(abs(x))', 'sqrt(sqrt(x))', 'asin(sin(x))', 'acos(cos(x))', 'atan(tan(x))',
    'tan(atan(x))', 'sin(asin(x))', 'cos(acos(x))', 'sin(1/x)', 'cos(1/x)', 'x*sin(1/x)', 'tan(1/x)', '1/(1 + exp(-x))', 'atanh(tanh(x))', 'acosh(cosh(x))',
    'asinh(sinh(x))', 'tanh(1/x)', 'sinh(1/x)', 'cosh(1/x)', 'cbrt(x)^3', 'cbrt(1/x)', 'sqrt(x)^2', 'ln(sqrt(x))', 'sqrt(exp(x))', 'abs(sin(x))/x', 'abs(1/x)',
    'atan(1/x)', 'asin(1/x)', 'acos(1/x)', 'acosh(1/x)', 'atanh(1/x)', 'atanh(sin(x))', 'acosh(sec(x))', 'ln(cosh(x))', 'ln(x^2)', 'log(x)', 'log(x)*log(x)',
    '1/log(x)', 'log(abs(x))', 'sin(x)^2 + cos(x)^2', 'sec(x)^2 - tan(x)^2', 'sin(sin(x))', 'cos(cos(x))', 'tan(tan(x))', 'exp(exp(x))', 'exp(sin(x))', 'ln(ln(x))',
    'sqrt(ln(x))', 'ln(sqrt(x))', 'ln(x)^2', 'asin(cos(x))', 'acos(sin(x))', 'atan(exp(x))', 'atan(ln(x))', 'sinh(ln(x))', 'tanh(ln(x))', 'exp(-x^2)', 'exp(-x^-2)',
  ]
  for (const angle of ['radians', 'degrees'] as const) {
    for (const src of ONE_VAR) {
      it(`${src} (${angle})`, () => checkComposed(src, angle))
    }
  }

  const TWO_FROM_ONE = [
    'atan2(sin(x), cos(x))', 'atan2(cos(x), sin(x))', 'atan2(x, x)', 'atan2(-x, x)', 'atan2(x, -x)', 'atan2(1/x, x)', 'atan2(x, 1/x)', 'atan2(x, 1)', 'atan2(1, x)',
    'atan2(x, 0)', 'atan2(0, x)', 'atan2(-0, x)', 'atan2(x, -1)', 'atan2(-1, x)', 'atan2(sin(x), x)', 'atan2(x, ln(x))', 'atan2(ln(x), 1)', 'atan2(1, ln(x))',
    'atan2(0, ln(x))', 'atan2(0, cos(x))', 'atan2(sin(x), -1)', 'atan2(1/x, 1/x)', 'atan2(abs(x), x)', 'atan2(x, abs(x))', 'atan2(x^2, x)', 'sin(atan2(x, 1))',
    'tan(atan2(x, 1))', 'atan2(tan(x), 1)', 'atan2(1, tan(x))', 'atan2(exp(x), x)', 'atan2(x, exp(-x))', 'atan2(sqrt(x), x)',
    'log(x, 2)', 'log(2, x)', 'log(x, x)', 'log(x, 10)', 'log(x, 0.5)', 'log(x, 1)', 'log(1, x)', 'log(x, abs(x))', 'log(abs(x), 2)', 'log(2, abs(x))', 'log(x, exp(x))', 'log(sin(x), 2)',
    'log(2, sin(x))', 'log(cos(x), cos(x))', 'log(x, 1/x)', 'log(1/x, 2)', 'log(10, x)', 'log(x, sqrt(x))', 'log(x^2, x)', 'log(0, x)', 'log(x, 0)', 'log(-1, x)', 'log(x, -1)',
    'root(3, x)', 'root(-3, x)', 'root(2, x)', 'root(-2, x)', 'root(1, x)', 'root(-1, x)', 'root(4, x)', 'root(-4, x)', 'root(5, x)', 'root(-5, x)', 'root(6, x)', 'root(0, x)',
    'root(2, 1/x)', 'root(3, 1/x)', 'root(-3, 1/x)', 'root(2, abs(x))', 'root(2, x^2)', 'root(4, x^2)', 'root(5, sin(x))', 'root(-2, sin(x))', 'root(-5, x^3)', '1/root(-3, x)',
    'root(3, x)^3', 'root(2, x)^2', 'root(2, exp(x))', 'root(2, ln(x))', 'root(3, ln(x))', 'root(-3, ln(x))', 'root(x, 2)', 'root(x, 8)', 'root(x, -8)', 'root(x, x)',
  ]
  for (const angle of ['radians', 'degrees'] as const) {
    for (const src of TWO_FROM_ONE) {
      it(`${src} (${angle})`, () => checkComposed(src, angle))
    }
  }

  // Found by the random-chain sweep (400k expressions): a sqrt over a box with 0 inside
  // gave a bound that was exactly one zero, and atan2 / sinh^-3 / the next twin then lost
  // the other (sqrt(-0) is -0, atan2(-0, -1) is -pi, (-0)^-3 is -inf), and atan2's own
  // bound at an underflowed zero claimed one sign of zero for a box that holds both.
  const ZERO_SIGN_CHAINS = [
    'atan2(sqrt(x), -0)', 'atan2(sqrt(x), 0)', 'atan2(sqrt(x - x), (x - x) * (-1 + x))', 'sinh(sqrt(atan2(x, 10)))^-3', 'atan2(sqrt(atan2(x, 2)), tan(root(-3, x)))',
    'tanh(atan2(sqrt(x), -0))', 'atan2(sqrt(atan2(x, 2.718281828459045)), ln(1^x))^-3', '1/sqrt(x)', 'sqrt(x)^-1', '1/sqrt(atan2(x, 1))', '1/sqrt(atan2(x, 10)) + 1',
    'atan2(sin(x), -1)', 'atan2(asin(x), -1)', 'atan2(atan(x), -1)', 'atan2(sinh(x), -1)', 'atan2(cbrt(x), -1)', 'atan2(root(5, x), -1)', 'atan2(tanh(x), -1)',
    '1/sinh(x)', '1/atan(x)', '1/cbrt(x)', '1/asinh(x)', '1/tanh(x)', '1/asin(x)', '1/atanh(x)', '1/root(5, x)', '1/root(-5, x)', '1/root(4, x)', '1/abs(x)', '1/acos(x)',
    '1/acosh(x)', '1/ln(x)', '1/log(x)', '1/sin(x)', '1/tan(x)',
    // degrees scale by pi/180, and a tiny x underflows to a zero (sweep: sqrt(tan(x))^-1 over [-0.5, 0] at -5e-324)
    'sqrt(tan(x))^-1', 'root(2, tan(x))^-1', 'sinh(sqrt(tan(x))^-1)', 'sqrt(sin(x))^-1', 'atan2(sqrt(tan(x)), -0)', '1/sqrt(sin(x))', '1/csc(x)', '1/cot(x)', 'atan2(tan(x), -1)',
    'atan2(sqrt(sin(x)), -0)',
  ]
  for (const angle of ['radians', 'degrees'] as const) {
    for (const src of ZERO_SIGN_CHAINS) {
      it(`${src} (${angle})`, () => checkComposed(src, angle))
    }
  }

  it('sqrt(x^2 + y^2) and atan2(y, x) over two variables', () => {
    const exprs = ['sqrt(x^2 + y^2)', 'atan2(y, x)', 'atan2(y, x) + atan2(x, y)', 'ln(x^2 + y^2)', 'atan(y/x)', 'sin(atan2(y, x))', 'x/sqrt(x^2 + y^2)', 'atan2(y*sin(x), y*cos(x))']
    const rand = mulberry32(99)
    for (const src of exprs) {
      const expr = p(src)
      const f = compileScalar(expr, ['x', 'y'], makeScope())
      for (const [xl, xh] of PAIR_BOXES_SMALL) {
        for (const [yl, yh] of PAIR_BOXES_SMALL) {
          const r = interval(expr, { x: box(xl, xh), y: box(yl, yh) }, 'radians')
          for (const x of pointsOf(xl, xh, rand)) {
            for (const y of pointsOf(yl, yh, rand)) {
              const v = f(x, y)
              must(r, v, () => `${src} x [${fmt(xl)}, ${fmt(xh)}] y [${fmt(yl)}, ${fmt(yh)}] at (${fmt(x)}, ${fmt(y)}) gives ${fmt(v)}, twin ${show(r)}`)
            }
          }
        }
      }
    }
  })
})

describe('composed elementary twins stay tight where the function is nice', () => {
  const at = (src: string, lo: number, hi: number, angle: Angle = 'radians'): Iv => interval(p(src), { x: box(lo, hi) }, angle)

  it('the domain-limited functions accept the range of the function before them', () => {
    expect(at('sqrt(cos(x))', -1, 1).v).toBe(CONTINUOUS)
    expect(at('sqrt(cos(x))', 0, 2).v).toBe(PARTIAL)
    expect(at('sqrt(sin(x))', 0, 1).v).toBe(CONTINUOUS)
    expect(at('sqrt(sin(x))', 0, 3).v).toBe(CONTINUOUS)
    expect(at('sqrt(abs(x))', -2, 2).v).toBe(CONTINUOUS)
    expect(at('sqrt(sqrt(x))', 0, 4).v).toBe(CONTINUOUS)
    expect(at('sqrt(exp(x))', -1000, 1).v).toBe(CONTINUOUS)
    expect(at('asin(sin(x))', 0, 1).v).toBe(CONTINUOUS)
    expect(at('asin(sin(x))', -10, 10).v).toBe(CONTINUOUS)
    expect(at('acos(cos(x))', -10, 10).v).toBe(CONTINUOUS)
    expect(at('acos(cos(x))', 0, 1).v).toBe(CONTINUOUS)
    expect(at('acosh(cosh(x))', 0.5, 2).v).toBe(CONTINUOUS)
    expect(at('ln(exp(x))', -5, 5).v).toBe(CONTINUOUS)
    expect(at('ln(cosh(x))', -5, 5).v).toBe(CONTINUOUS)
    expect(at('atan(tan(x))', -1, 1).v).toBe(CONTINUOUS)
    expect(at('atan(tan(x))', 1, 2).v).toBe(PARTIAL)
    expect(at('ln(1 + exp(x))', -5, 5).v).toBe(CONTINUOUS)
  })

  it('a pole is partial and one-sided where the sign of the zero allows', () => {
    const csc = at('1/sin(x)', 0, 1)
    expect(csc).toMatchObject({ hi: Infinity, v: PARTIAL })
    expect(csc.lo).toBeGreaterThan(1.18)
    const inv = at('1/ln(x)', 1, 2)
    expect(inv).toMatchObject({ hi: Infinity, v: PARTIAL })
    expect(inv.lo).toBeGreaterThan(1.44)
    expect(inv.lo).toBeLessThan(1.45)
    expect(at('1/sqrt(x)', 0, 4)).toMatchObject({ hi: Infinity, v: PARTIAL })
    expect(at('1/sqrt(x)', 0, 4).lo).toBeGreaterThan(0.49)
    expect(at('1/abs(x)', 0, 4)).toMatchObject({ hi: Infinity, v: PARTIAL })
    expect(at('1/abs(x)', -4, 4)).toMatchObject({ lo: expect.any(Number), hi: Infinity, v: PARTIAL })
    expect(at('1/abs(x)', -4, 4).lo).toBeGreaterThan(0.24)
  })

  it('exp(-1/x) over [-1, 0] and 1/x chains do not lose the infinity at 0', () => {
    const r = at('exp(-1/x)', -1, 0)
    expect(r.v).toBe(PARTIAL)
    expect(r.hi).toBe(Infinity)
    expect(admits(r, Math.exp(-1 / 0))).toBe(true)
    expect(admits(r, Math.exp(-1 / -0))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Random chains: expressions of depth two or three over the twins, each against the
// scalar compile of the same expression, over the edge boxes and random boxes.
// ---------------------------------------------------------------------------

describe('random elementary chains', () => {
  const num = (value: number): Expr => ({ kind: 'num', value })
  const x: Expr = { kind: 'var', name: 'x' }
  const call = (name: string, ...args: Expr[]): Expr => ({ kind: 'call', name, args })
  const CONSTANTS = [0, 1, -1, 2, 0.5, -0.5, 3, Math.E, 10, -2]
  const ROOT_N = [-4, -3, -2, -1, 1, 2, 3, 4, 5, 6]
  function show2(e: Expr): string {
    switch (e.kind) {
      case 'num':
        return fmt(e.value)
      case 'var':
        return e.name
      case 'unary':
        return `-(${show2(e.arg)})`
      case 'binary':
        return `(${show2(e.left)} ${e.op} ${show2(e.right)})`
      case 'call':
        return `${e.name}(${e.args.map(show2).join(', ')})`
      default:
        return '?'
    }
  }
  function leaf(rand: () => number): Expr {
    return rand() < 0.65 ? x : num(CONSTANTS[Math.floor(rand() * CONSTANTS.length)])
  }
  function build(rand: () => number, depth: number): Expr {
    if (depth === 0) return leaf(rand)
    const k = rand()
    const a = build(rand, depth - 1)
    if (k < 0.55) return call(UNARY[Math.floor(rand() * UNARY.length)], a)
    if (k < 0.62) return { kind: 'unary', op: '-', arg: a }
    if (k < 0.68) return { kind: 'binary', op: '^', left: a, right: num([-3, -2, -1, 2, 3][Math.floor(rand() * 5)]) }
    const b = build(rand, depth - 1)
    if (k < 0.78) return call('atan2', a, b)
    if (k < 0.84) return call('log', a, b)
    if (k < 0.88) return call('root', num(ROOT_N[Math.floor(rand() * ROOT_N.length)]), a)
    const op = (['+', '-', '*', '/'] as const)[Math.floor(rand() * 4)]
    return { kind: 'binary', op, left: a, right: b }
  }

  const EDGE: [number, number][] = [
    [-Infinity, Infinity], [0, Infinity], [-Infinity, 0], [1, Infinity], [-Infinity, -1], [0, 0], [-0, 0], [-0, -0], [-0, 2], [0, 2], [-2, 0], [-2, -0], [-1, 1],
    [-1e-300, 1e-300], [-5e-324, 5e-324], [0, 1e-300], [-1e-300, -0], [1e154, 1e155], [-1e154, 1e155], [0.5, 2], [-3, -1], [1, 1], [-1, 0], [-0.25, 0], [-8, 0], [-8, 8],
    [-2, -0.5], [HALF_PI, HALF_PI], [0, HALF_PI], [-HALF_PI, HALF_PI], [0, Math.PI], [0, 90], [89, 91], [-90, 90], [0, 2 * Math.PI], [3, 3.5], [0.25, 0.5], [1, 5], [-0.5, 0.5],
  ]

  const run = (seed: number, count: number, edge: boolean) => {
    const rand = mulberry32(seed)
    for (let i = 0; i < count; i++) {
      const e = build(rand, 2 + (i % 2))
      const angle: Angle = rand() < 0.3 ? 'degrees' : 'radians'
      const f = compileScalar(e, ['x'], makeScope({ angle }))
      const boxes = edge ? EDGE : Array.from({ length: 10 }, () => randomBox(rand))
      for (const [lo, hi] of boxes) {
        for (const [l, h] of edge ? withZeroSigns(lo, hi) : [[lo, hi] as [number, number]]) {
          const r = interval(e, { x: box(l, h) }, angle)
          for (const px of edge ? pointsOf(l, h, rand) : pointsIn(l, h, rand, 4)) {
            const y = f(px)
            must(r, y, () => `${show2(e)} (${angle}) over [${fmt(l)}, ${fmt(h)}] at ${fmt(px)} gives ${fmt(y)}, twin ${show(r)}`)
          }
        }
      }
    }
  }

  it('depth 2 and 3 over the edge boxes', () => run(20261101, 3000, true))
  it('depth 2 and 3 over random boxes', () => run(20261102, 6000, false))
})

// ---------------------------------------------------------------------------
// Aliasing and history.
// ---------------------------------------------------------------------------

describe('twins read every input before writing out, and keep no state between calls', () => {
  const same = (a: Iv, b: Iv) => Object.is(a.lo, b.lo) && Object.is(a.hi, b.hi) && a.v === b.v
  const BOXES_SMALL: [number, number][] = [[0.25, 0.75], [-1, 1], [0, 2], [-0, 1], [1, 5], [-3, -1], [3, 3.5], [HALF_PI - 0.1, HALF_PI + 0.1], [-Infinity, 1], [0, 0], [-10, 10], [40, 50]]

  it('a unary twin with out aliasing its input gives the fresh answer', () => {
    for (const name of UNARY) {
      for (const angle of ['radians', 'degrees'] as const) {
        for (const [lo, hi] of BOXES_SMALL) {
          const fresh = iv()
          TWINS[name](fresh, [box(lo, hi)], angle)
          const a = box(lo, hi)
          TWINS[name](a, [a], angle)
          expect(same(a, fresh), `${name} ${angle} [${fmt(lo)}, ${fmt(hi)}]: ${show(a)} vs ${show(fresh)}`).toBe(true)
        }
      }
    }
  })

  it('a binary twin with out aliasing either input gives the fresh answer', () => {
    const twins: [string, E.Twin][] = [['atan2', E.atan2T], ['log', E.logT], ['root', E.rootT]]
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
    const names = [...UNARY]
    const jobs: [UnaryName, number, number, Angle][] = []
    for (let i = 0; i < 200; i++) {
      const [lo, hi] = randomBox(rand)
      jobs.push([names[Math.floor(rand() * names.length)], lo, hi, rand() < 0.5 ? 'degrees' : 'radians'])
    }
    const fresh = jobs.map(([name, lo, hi, angle]) => {
      const out = iv()
      TWINS[name](out, [box(lo, hi)], angle)
      return out
    })
    // the same jobs again in reverse and interleaved with binary twins
    for (let i = jobs.length - 1; i >= 0; i--) {
      const [name, lo, hi, angle] = jobs[i]
      const junk = iv()
      E.atan2T(junk, [box(lo, hi), box(-1, 1)], angle)
      E.logT(junk, [box(lo, hi), box(2, 3)], angle)
      E.rootT(junk, [box(3, 3), box(lo, hi)], angle)
      const out = iv()
      TWINS[name](out, [box(lo, hi)], angle)
      expect(same(out, fresh[i]), `${name} [${lo}, ${hi}] ${angle}`).toBe(true)
    }
  })
})
