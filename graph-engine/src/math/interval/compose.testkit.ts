// Test helpers for the twins that compose (calc P1b, Task 3). A twin is only as sound as
// the twins that consume its answer, so the stepwise and special tests, and the registry's
// chain sweep, all ask the same question: does the NEXT twin still hold the value the scalar
// chain gives? Expressions are written as text; the scalar is the kernel's own compile of it,
// the interval is the twins chained as the text says, through BUILTIN_REGISTRY (so a built-in
// that is not in the registry cannot be chained, which is the registry's point).

import { parseExprString as p } from '../../parser/parseExpr'
import type { Expr } from '../../parser/types'
import { compileScalar } from '../compile'
import { BUILTIN_REGISTRY } from '../registry'
import { makeScope } from '../scope'
import { add, div, mul, neg, powGeneral, powInt, sub } from './arith'
import { iv, type Iv, setBox } from './core'
import type { Twin } from './elementary'
import { admits, mulberry32, pointsIn, randomBox, zerosIn } from './testkit'

export type Angle = 'radians' | 'degrees'

export const box = (lo: number, hi: number): Iv => setBox(iv(), lo, hi)
export const fmt = (x: number): string => (Object.is(x, -0) ? '-0' : String(x))
export const show = (r: Iv): string => `[${fmt(r.lo)}, ${fmt(r.hi)}] v${r.v}`
export const isEmptyIv = (r: Iv): boolean => r.lo > r.hi
export const within = (r: Iv, lo: number, hi: number, tol = 1e-12): boolean => r.lo >= lo - tol && r.lo <= lo + tol && r.hi >= hi - tol && r.hi <= hi + tol
export const sameIv = (a: Iv, b: Iv): boolean => Object.is(a.lo, b.lo) && Object.is(a.hi, b.hi) && a.v === b.v
export const signOf = (x: number): string => (Object.is(x, -0) ? '-0' : Object.is(x, 0) ? '+0' : x < 0 ? '-' : '+')

export function run1(t: Twin, lo: number, hi: number, angle: Angle = 'radians'): Iv {
  const out = iv()
  t(out, [box(lo, hi)], angle)
  return out
}

export function run2(t: Twin, a: [number, number], b: [number, number], angle: Angle = 'radians'): Iv {
  const out = iv()
  t(out, [box(a[0], a[1]), box(b[0], b[1])], angle)
  return out
}

// The soundness contract (testkit.admits), and the zero-bound invariant on top of it, which
// admits cannot see (-0 <= 0 <= +0) and 1 / the box reads (1 / +0 and 1 / -0 differ, and so do
// sqrt, atan2 and the rest): by the convention every twin reads, a zero the result holds is a
// zero strictly inside it (a bottom below 0 and a top above), or a zero END with that sign. So a
// value of 0 of either sign needs one of those, in both directions: a bottom of exactly +0
// claims no -0, a top of exactly -0 claims no +0, and also a top of +0 over a negative bottom
// claims no -0 (sqrt reads `[-1, +0]` as `[+0, +0]`) and a bottom of -0 under a positive top
// claims no +0. A box whose two ends are zeros, [-0, +0] or [+0, -0], holds both: each end is
// one of the two. The message is built only when it fails: a sweep makes millions of checks.
export function must(r: Iv, y: number, why: () => string): void {
  if (!admits(r, y)) throw new Error(why())
  if (y === 0 && !((r.lo < 0 && r.hi > 0) || Object.is(r.lo, y) || Object.is(r.hi, y))) {
    throw new Error(`zero-bound invariant: value ${fmt(y)} against ${show(r)}: ${why()}`)
  }
}

const f64 = new Float64Array(1)
const u64 = new BigUint64Array(f64.buffer)
export function nextUp(x: number): number {
  if (Number.isNaN(x) || x === Infinity) return x
  if (x === 0) return Number.MIN_VALUE
  f64[0] = x
  u64[0] += x > 0 ? 1n : -1n
  return f64[0]
}
export function nextDown(x: number): number {
  return -nextUp(-x)
}

// k doubles above x (below for negative k).
export function stepDoubles(x: number, k: number): number {
  let y = x
  for (let i = 0; i < Math.abs(k); i++) y = k > 0 ? nextUp(y) : nextDown(y)
  return y
}

// Every double in [lo, hi], up to `cap` of them from lo: a box of a few ulps is checked at all
// of its points, which is where the scalar's own non-monotonicity shows. The zeros are the ones
// the box holds, by the convention every twin reads (a zero end is that signed zero, a zero
// strictly inside is either): stepping through the doubles passes -0 on the way to +0 for a
// box such as [-5e-324, +0], which does not hold it.
export function doublesIn(lo: number, hi: number, cap: number): number[] {
  const out: number[] = []
  let x = lo
  for (let i = 0; i < cap && x <= hi; i++) {
    if (x !== 0) out.push(x)
    x = nextUp(x)
  }
  for (const z of zerosIn(lo, hi)) out.push(z)
  return out
}

// Values a box may hold that a random generator rarely reaches: the doubles at and either side
// of every threshold the twins in this task care about.
const THRESHOLDS = [0.5, 1, 1.5, 2, 2.5, 3, 6, 100, 170, 171, 171.5, 172, 1e15, 2 ** 52, 2 ** 53, 1e300]
export const SPECIAL: number[] = [
  -Infinity, -1e300, -1e154, -7, -3, -2, -0.5, -5e-324, 5e-324, 1e-300, 7, 1e154, Infinity, 0.49999999999999994, -0.49999999999999994,
  ...THRESHOLDS.flatMap((x) => [x, nextUp(x), nextDown(x), -x, nextUp(-x), nextDown(-x)]),
]

// The points to test inside [lo, hi]: both ends, the middle, the specials the box holds, the
// signed zeros it holds, and random interior points.
export const pointsOf = (lo: number, hi: number, rand: () => number, interior = 4): number[] => {
  const pts = [lo, hi, (lo + hi) / 2, ...SPECIAL].filter((x) => x !== 0 && lo <= x && x <= hi)
  for (const z of zerosIn(lo, hi)) pts.push(z)
  if (Number.isFinite(lo) && Number.isFinite(hi)) for (const x of pointsIn(lo, hi, rand, interior)) if (x !== 0) pts.push(x)
  return pts
}

// The boxes a zero end allows: each zero end as +0 and as -0.
export function withZeroSigns(lo: number, hi: number): [number, number][] {
  const los = lo === 0 ? [0, -0] : [lo]
  const his = hi === 0 ? [0, -0] : [hi]
  const out: [number, number][] = []
  for (const l of los) for (const h of his) out.push([l, h])
  return out
}

export const COMPOSE_BOXES: [number, number][] = [
  [-Infinity, Infinity], [0, Infinity], [-Infinity, 0], [1, Infinity], [-Infinity, -1], [0, 0], [-0, 0], [-0, 2], [0, 2], [-2, 0], [-1, 1],
  [-1e-300, 1e-300], [-5e-324, 5e-324], [0, 1], [-1, 0], [0.5, 2], [-3, -1], [1, 1], [-8, 8], [0, 1e-300], [-1e-300, 0], [-0.7, 0.3], [-0.9, -0.1],
  [0.1, 0.9], [-0.5, 0.5], [-0.5, 0], [0, 0.5], [2.9, 3.1], [3, 3], [-3, -3], [2, 4], [-4, -2], [1, 2], [3, 3.5], [-1, -0], [0.25, 4], [-30, 30],
  [nextDown(1), nextUp(1)], [nextDown(3), nextUp(3)], [nextDown(0.5), nextUp(0.5)], [-nextUp(0.5), -nextDown(0.5)], [170, 172], [171.5, 171.7],
  [-171.5, -170.5], [-200, -190.5], [1e-310, 1], [-1e-310, -5e-324], [700, 800], [1e15, 1e15 + 8], [2 ** 53, 2 ** 53 + 16], [1e154, 1e155],
  [-0.1, 5], [0.9, 1.1], [24, 26],
]

// The kernel's expression as intervals, every call through the registry.
export function interval(expr: Expr, env: Record<string, Iv>, angle: Angle): Iv {
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
      const entry = BUILTIN_REGISTRY.get(expr.name)
      if (!entry) throw new Error(`no twin for ${expr.name}`)
      const out = iv()
      entry.twin(out, expr.args.map(ev), angle)
      return out
    }
    default:
      throw new Error('unsupported node')
  }
}

// One expression of x, held to its scalar compile over the boxes, each zero end as both signs.
export function checkComposed(src: string, angle: Angle = 'radians', boxes: [number, number][] = COMPOSE_BOXES): void {
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

// One expression over the boxes of up to three ulps each side of each centre, every double of
// each box tried (and each zero end as both signs): the boxes where a jump or a pole is a
// few ulps wide, which is where a bound that is a zero, or an infinity, has to be right.
export function checkAround(src: string, centres: readonly number[], angle: Angle = 'radians'): void {
  const expr = p(src)
  const f = compileScalar(expr, ['x'], makeScope({ angle }))
  for (const c of centres) {
    for (let below = 0; below <= 3; below++) {
      for (let above = 0; above <= 3; above++) {
        const lo = stepDoubles(c, -below)
        const hi = stepDoubles(c, above)
        for (const [l, h] of withZeroSigns(lo, hi)) {
          const r = interval(expr, { x: box(l, h) }, angle)
          for (const x of doublesIn(l, h, 12)) {
            const y = f(x)
            must(r, y, () => `${src} (${angle}) over [${fmt(l)}, ${fmt(h)}] at ${fmt(x)} gives ${fmt(y)}, twin ${show(r)}`)
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Random chains: expressions of depth two or three over a pool of built-ins, each against the
// scalar compile of the same expression.
// ---------------------------------------------------------------------------

export interface ChainPool {
  readonly unary: readonly string[]
  readonly binary: readonly string[]
  // built-ins taking a whole-number first argument written as a literal
  readonly indexed?: readonly string[]
}

const CONSTANTS = [0, 1, -1, 2, 0.5, -0.5, 3, Math.E, 10, -2, 0.25, 6]
const ROOT_N = [-4, -3, -2, -1, 1, 2, 3, 4, 5, 6]
const X: Expr = { kind: 'var', name: 'x' }
const num = (value: number): Expr => ({ kind: 'num', value })
const call = (name: string, ...args: Expr[]): Expr => ({ kind: 'call', name, args })

export function showExpr(e: Expr): string {
  switch (e.kind) {
    case 'num':
      return fmt(e.value)
    case 'var':
      return e.name
    case 'unary':
      return `-(${showExpr(e.arg)})`
    case 'binary':
      return `(${showExpr(e.left)} ${e.op} ${showExpr(e.right)})`
    case 'call':
      return `${e.name}(${e.args.map(showExpr).join(', ')})`
    default:
      return '?'
  }
}

function leaf(rand: () => number): Expr {
  return rand() < 0.65 ? X : num(CONSTANTS[Math.floor(rand() * CONSTANTS.length)])
}

function build(rand: () => number, depth: number, pool: ChainPool): Expr {
  if (depth === 0) return leaf(rand)
  const k = rand()
  const a = build(rand, depth - 1, pool)
  if (k < 0.5) return call(pool.unary[Math.floor(rand() * pool.unary.length)], a)
  if (k < 0.56) return { kind: 'unary', op: '-', arg: a }
  if (k < 0.62) return { kind: 'binary', op: '^', left: a, right: num([-3, -2, -1, 2, 3][Math.floor(rand() * 5)]) }
  const b = build(rand, depth - 1, pool)
  if (k < 0.8) return call(pool.binary[Math.floor(rand() * pool.binary.length)], a, b)
  if (k < 0.84 && pool.indexed && pool.indexed.length > 0) return call(pool.indexed[Math.floor(rand() * pool.indexed.length)], num(ROOT_N[Math.floor(rand() * ROOT_N.length)]), a)
  const op = (['+', '-', '*', '/'] as const)[Math.floor(rand() * 4)]
  return { kind: 'binary', op, left: a, right: b }
}

export const CHAIN_EDGE: [number, number][] = [
  [-Infinity, Infinity], [0, Infinity], [-Infinity, 0], [1, Infinity], [-Infinity, -1], [0, 0], [-0, 0], [-0, -0], [-0, 2], [0, 2], [-2, 0], [-2, -0], [-1, 1],
  [-1e-300, 1e-300], [-5e-324, 5e-324], [0, 1e-300], [-1e-300, -0], [1e154, 1e155], [-1e154, 1e155], [0.5, 2], [-3, -1], [1, 1], [-1, 0], [-0.25, 0], [-8, 0], [-8, 8],
  [-2, -0.5], [0, Math.PI / 2], [-Math.PI / 2, Math.PI / 2], [0, Math.PI], [0, 90], [-90, 90], [3, 3.5], [0.25, 0.5], [1, 5], [-0.5, 0.5], [-0.7, 0.3], [2, 4], [2.9, 3.1],
  [3, 3], [170, 172], [-171.5, -170.5], [0, 0.5], [-0.5, -0], [24, 26],
]

// `collect`, when given, receives each violation instead of the first one throwing (the
// scratch sweeps that hunt for shapes of failure use it).
export function chainSweep(seed: number, count: number, edge: boolean, pool: ChainPool, collect?: (message: string) => void): void {
  const rand = mulberry32(seed)
  for (let i = 0; i < count; i++) {
    const e = build(rand, 2 + (i % 2), pool)
    const angle: Angle = rand() < 0.3 ? 'degrees' : 'radians'
    const f = compileScalar(e, ['x'], makeScope({ angle }))
    const boxes = edge ? CHAIN_EDGE : Array.from({ length: 10 }, () => randomBox(rand))
    for (const [lo, hi] of boxes) {
      for (const [l, h] of edge ? withZeroSigns(lo, hi) : [[lo, hi] as [number, number]]) {
        const r = interval(e, { x: box(l, h) }, angle)
        for (const px of edge ? pointsOf(l, h, rand) : pointsIn(l, h, rand, 4)) {
          const y = f(px)
          try {
            must(r, y, () => `${showExpr(e)} (${angle}) over [${fmt(l)}, ${fmt(h)}] at ${fmt(px)} gives ${fmt(y)}, twin ${show(r)}`)
          } catch (err) {
            if (!collect) throw err
            collect((err as Error).message)
          }
        }
      }
    }
  }
}
