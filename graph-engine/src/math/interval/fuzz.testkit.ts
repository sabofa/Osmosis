// Whole-expression sweeps of the interval compiler (calc P1b, final fix wave). Two questions are asked
// of random expressions, each against the scalar compile of the same expression and over boxes of every
// shape the twins have a rule for:
//
//   soundness   at every point of a box the scalar's value is one the twin's answer holds: strictly
//               (an infinity needs the bound on its side, a NaN needs PARTIAL or UNKNOWN) and with the
//               zero-bound invariant (compose.testkit `must`). The twins are each swept alone elsewhere;
//               this is the compiler, where they compose.
//   continuity  a box answered CONTINUOUS has no jump in the scalar. `admits` and `must` read values
//               only, so a twin that says CONTINUOUS across floor's step, a piecewise seam or atan2's
//               cut passes every soundness sweep, and that verdict is what the sampler (calc P2)
//               connects across. `findJump` samples the scalar over the box, bisects the widest gap
//               down to adjacent doubles, and calls a gap that stays wide and flat on both sides a jump
//               (a steep curve is not flat on the sides: that is how it tells a pole's steepness from a
//               jump).
//
// Everything is seeded (math/ never calls Math.random), and the sizes are the suite's: a few seconds.

import { parseExprString as p } from '../../parser/parseExpr'
import type { Expr } from '../../parser/types'
import { compileScalar } from '../compile'
import { call, neg, num, variable } from '../expr'
import { makeScope, type MathFunction, type MathScope } from '../scope'
import { type CompiledInterval, compileInterval } from './compile'
import { fmt, must, nextDown, nextUp, show, showExpr, SPECIAL, withZeroSigns } from './compose.testkit'
import { CONTINUOUS, DEFINED, iv } from './core'
import { mulberry32, randomBox, zerosIn } from './testkit'

type Rand = () => number

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

const fn = (params: string[], body: string | Expr): MathFunction => ({ params, body: typeof body === 'string' ? p(body) : body })

// User functions of every shape the compiler inlines: a plain body, two parameters, a parameter that
// is dropped, one named like an input, a body holding a piecewise, a loop, a stepwise function, a pole,
// and constants (one of them -0, one holding a loop, one a constant integral, one reading a @param).
const BASE_FUNCS: [string, MathFunction][] = [
  ['f', fn(['t'], 't^2 + 1')],
  ['g', fn(['t', 'u'], 't u')],
  ['drop', fn(['t', 'u'], 'u')],
  ['w', fn(['x'], 'x^3 - x')],
  ['sq', fn(['a'], 'a^2 - a')],
  ['kk', fn(['k'], 'k(k + 1)')],
  ['pw', fn(['t'], '{t < 0: -t, t^2}')],
  ['lp', fn(['t'], 'sum(j = 1 to 3, t^j / j)')],
  ['tr', fn(['t'], 'sin(t) t')],
  ['dv', fn(['t'], '1/t')],
  ['fl', fn(['t'], 'floor(t) + t')],
  ['ex', fn(['t'], 'exp(-1/t)')],
  ['k', fn([], '3')],
  ['cz', fn([], neg(num(0)))],
  ['cl', fn([], 'sum(j = 1 to 4, j)')],
  ['cp', fn([], 'a + 1')],
  ['ci', fn([], 'integral(t = 0 to 1, t^2)')],
  ['cn', fn([], 'n')],
]
const PRIMEABLE = ['f', 'w', 'sq', 'kk', 'pw', 'tr', 'dv', 'fl', 'ex']
const A_VALUES = [2, -0, 0, Number.NaN, Infinity, -3, 0.5, 1e300, -1]
// loop counts: the budget has tests of its own (compile.test.ts), so no loop here runs long
const N_VALUES = [0, 1, 2, 3, 2.5, -4, Number.NaN, -0, 100001]
// The values a continuity sweep uses: none of them makes a cliff the scalar cannot resolve. A base of
// 1 - 2^-53 under an exponent of 1e299 is 0 and a base of 1 under it is 1, so x^(a/3) with a = 1e300
// "jumps" at 1, and so does anything that multiplies a literal by 5e-324 (a staircase of subnormals).
// Those are floating-point cliffs of a continuous function, which the soundness sweep does hold the
// twin to, and which a search for jumps cannot tell from the real ones.
const A_TAME = [2, -0, 0, -3, 0.5, -1, 1.5, Number.NaN]
const N_TAME = [0, 1, 2, 3, 2.5, -4, Number.NaN, -0]

const pick = <T>(rand: Rand, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]

export interface FuzzScope {
  scope: MathScope
  desc: string
}

// A scope with the user functions above, the parameters a, b and n at values that include NaN,
// infinities and zeros, an angle unit, and once in eight a user function named like a built-in, a
// constant named pi and a parameter named like a constant.
export function fuzzScope(rand: Rand, tame = false): FuzzScope {
  const a = pick(rand, tame ? A_TAME : A_VALUES)
  const b = pick(rand, tame ? A_TAME : A_VALUES)
  const n = pick(rand, tame ? N_TAME : N_VALUES)
  const angle = rand() < 0.3 ? 'degrees' : 'radians'
  const funcs = [...BASE_FUNCS]
  const params: [string, number][] = [['a', a], ['b', b], ['n', n]]
  let shadow = false
  if (rand() < 0.12) {
    shadow = true
    funcs.push(['sin', fn(['t'], 't + 1')])
    funcs.push(['pi', fn([], '3')])
    params.push(['e', 2.5])
    if (rand() < 0.5) params.push(['ln', 2])
  }
  return { scope: makeScope({ functions: funcs, params, angle }), desc: `a=${fmt(a)} b=${fmt(b)} n=${fmt(n)} ${angle}${shadow ? ' shadow' : ''}` }
}

// ---------------------------------------------------------------------------
// Random expressions
// ---------------------------------------------------------------------------

const UNARY = ['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'sqrt', 'abs', 'exp', 'ln', 'log', 'floor', 'ceil', 'round', 'sign', 'gamma', 'erf', 'erfc', 'cbrt', 'step']
const BINARY = ['atan2', 'log', 'mod', 'min', 'max', 'hypot', 'choose', 'perm', 'gcd', 'lcm', 'root']
const CMP = ['__lt', '__le', '__gt', '__ge', '__eq', '__ne']
const LITS = [0, 1, -1, 2, 3, 0.5, -0.5, 10, 1e-300, 1e300, 5e-324, 4, 6, 0.25]
const LITS_TAME = [0, 1, -1, 2, 3, 0.5, -0.5, 10, 4, 6, 0.25, 1.5]
const LOOPVARS = ['i', 'j', 'k', 'm']

const bin = (op: '+' | '-' | '*' | '/' | '^', left: Expr, right: Expr): Expr => ({ kind: 'binary', op, left, right })

// What a generated expression may read: the input variables, the loop variables in scope, how many
// loops it may still open, and whether its literals are the tame ones (see A_TAME).
interface Ctx {
  vars: string[]
  bound: string[]
  loops: number
  tame: boolean
}

// p/q with q odd, the literal exponents that take the real root
const ODD_EXPONENTS: Expr[] = [
  bin('/', num(1), num(3)),
  bin('/', num(2), num(3)),
  neg(bin('/', num(1), num(3))),
  bin('/', num(5), num(3)),
  neg(bin('/', num(2), num(3))),
  bin('/', num(1), num(5)),
  bin('/', num(4), num(3)),
  bin('-', num(1), bin('/', num(1), num(3))),
]

function leaf(rand: Rand, c: Ctx): Expr {
  const r = rand()
  if (r < 0.45) return variable(pick(rand, c.vars))
  if (r < 0.55 && c.bound.length > 0) return variable(pick(rand, c.bound))
  if (r < 0.75) {
    const x = pick(rand, c.tame ? LITS_TAME : LITS)
    return rand() < 0.15 ? neg(num(x)) : num(x)
  }
  if (r < 0.8) return variable(pick(rand, ['pi', 'e', 'inf']))
  if (r < 0.9) return variable(pick(rand, ['a', 'b', 'n']))
  return variable(pick(rand, ['k', 'cz', 'cl', 'cp', 'ci', 'cn']))
}

function condition(rand: Rand, d: number, c: Ctx): Expr {
  const r = rand()
  if (r < 0.55) return call(pick(rand, CMP), gen(rand, d - 1, c), gen(rand, d - 1, c))
  if (r < 0.7) {
    // chained: a < x < b
    const lo = gen(rand, d - 2, c)
    const mid = gen(rand, d - 1, c)
    const hi = gen(rand, d - 2, c)
    return call('__and', call(pick(rand, ['__lt', '__le']), lo, mid), call(pick(rand, ['__lt', '__le']), mid, hi))
  }
  if (r < 0.8) return call(pick(rand, ['__and', '__or']), condition(rand, d - 1, c), condition(rand, d - 1, c))
  if (r < 0.87) return call('__not', condition(rand, d - 1, c))
  // a plain value as a condition: nonzero is true
  return gen(rand, d - 1, c)
}

// Loop bounds: literal ones, a parameter, a function of the input (not one whole number on a box: UNKNOWN),
// a signed zero, a constant.
function loopBounds(rand: Rand, c: Ctx): [Expr, Expr] {
  const r = rand()
  if (r < 0.4) {
    const lo = pick(rand, [-2, -1, 0, 1, 1, 1])
    const hi = lo + pick(rand, [-1, 0, 1, 2, 3])
    return [lo === 0 && rand() < 0.5 ? neg(num(0)) : num(lo), num(hi)]
  }
  if (r < 0.55) return [num(1), variable('n')]
  if (r < 0.65) return [num(1), call(pick(rand, ['floor', 'round', 'ceil']), variable(pick(rand, c.vars)))]
  if (r < 0.72) return [num(1), variable(pick(rand, c.vars))]
  if (r < 0.78) return [call('floor', variable(pick(rand, c.vars))), num(2)]
  if (r < 0.84) return [neg(num(0)), num(pick(rand, [0, 1, 2]))]
  if (r < 0.9) return [variable('cz'), num(1)]
  if (r < 0.95) return [num(1), variable('cn')]
  return [num(1), bin('+', variable('n'), num(1))]
}

// A random expression of depth up to `d`, over every construct the compiler has a rule for.
function gen(rand: Rand, d: number, c: Ctx): Expr {
  if (d <= 0 || rand() < 0.12) return leaf(rand, c)
  const r = rand() * 100
  if (r < 18) return bin(pick(rand, ['+', '-', '*', '/'] as const), gen(rand, d - 1, c), gen(rand, d - 1, c))
  if (r < 24) {
    const k = rand()
    const base = gen(rand, d - 1, c)
    if (k < 0.4) return bin('^', base, pick(rand, ODD_EXPONENTS))
    if (k < 0.7) return bin('^', base, num(pick(rand, [-3, -2, -1, 0, 2, 3, 0.5])))
    if (k < 0.8) return bin('^', base, bin('/', variable('a'), num(3)))
    return bin('^', base, gen(rand, d - 1, c))
  }
  if (r < 27) return neg(gen(rand, d - 1, c))
  if (r < 43) return call(pick(rand, UNARY), gen(rand, d - 1, c))
  if (r < 50) {
    const name = pick(rand, BINARY)
    if (name === 'root') return call('root', rand() < 0.7 ? num(pick(rand, [-3, -2, 1, 2, 3, 4, 5])) : gen(rand, d - 1, c), gen(rand, d - 1, c))
    if (name === 'choose' || name === 'perm' || name === 'gcd' || name === 'lcm') return call(name, gen(rand, d - 1, c), rand() < 0.5 ? num(pick(rand, [0, 1, 2, 3, 5])) : gen(rand, d - 1, c))
    return call(name, gen(rand, d - 1, c), gen(rand, d - 1, c))
  }
  if (r < 52) return call(pick(rand, ['min', 'max', 'hypot']), gen(rand, d - 1, c), gen(rand, d - 1, c), gen(rand, d - 1, c))
  if (r < 54) return call('__factorial', gen(rand, d - 1, c))
  if (r < 57) return rand() < 0.7 ? call(pick(rand, CMP), gen(rand, d - 1, c), gen(rand, d - 1, c)) : condition(rand, d, c)
  if (r < 67) {
    const pieces = 1 + Math.floor(rand() * 3)
    const args: Expr[] = []
    for (let i = 0; i < pieces; i++) args.push(condition(rand, d - 1, c), gen(rand, d - 1, c))
    if (rand() < 0.6) args.push(gen(rand, d - 1, c))
    return call('__piecewise', ...args)
  }
  if (r < 76) {
    const which = pick(rand, ['f', 'g', 'drop', 'w', 'sq', 'kk', 'pw', 'lp', 'tr', 'dv', 'fl', 'ex'])
    if (which === 'g' || which === 'drop') return call(which, gen(rand, d - 1, c), gen(rand, d - 1, c))
    return call(which, gen(rand, d - 1, c))
  }
  if (r < 80) {
    // a value called with one argument: a product
    return call(pick(rand, ['k', 'a', 'pi', 'cp', 'cl', ...c.vars, ...c.bound]), gen(rand, d - 1, c))
  }
  if (r < 84) return call('__prime', variable(pick(rand, PRIMEABLE)), num(rand() < 0.75 ? 1 : 2), gen(rand, d - 1, c))
  if (r < 93 && c.loops > 0) {
    const [lo, hi] = loopBounds(rand, c)
    const k = pick(rand, LOOPVARS)
    const inner: Ctx = { ...c, bound: [...c.bound, k], loops: c.loops - 1 }
    return call(rand() < 0.65 ? '__sum' : '__prod', variable(k), lo, hi, gen(rand, d - 1, inner))
  }
  return leaf(rand, c)
}

// A random expression of the given variables, with at most two loops in it.
export function randomExpr(rand: Rand, vars: string[], depth: number, tame = false): Expr {
  return gen(rand, depth, { vars, bound: [], loops: 2, tame })
}

// ---------------------------------------------------------------------------
// Boxes and points
// ---------------------------------------------------------------------------

const HALF_PI = Math.PI / 2
// Boxes the random generator rarely makes: the zeros and integers, the poles and cuts of the trig
// functions in both angle units, infinite ends, subnormals, near overflow.
const EDGE: [number, number][] = [
  [0, 1], [-0, 1], [-1, 0], [-1, -0], [0, 0], [-0, -0], [-0, 0], [0, 2.5], [-3, 0], [1, 1], [2, 2], [-1, -1], [3, 3],
  [0.5, 1.5], [1, 3], [-2, 2], [2.9, 3.1], [nextDown(2), nextUp(2)], [-2, -1], [1.5, 2], [HALF_PI - 1e-9, HALF_PI + 1e-9], [1.5, 1.6],
  [89, 91], [90, 90], [0, 90], [-90, 90], [3.1, 3.2], [180, 180], [-1.5, -0.5], [-3, -2], [0, Infinity], [-Infinity, 0],
  [-Infinity, Infinity], [1e15, 1e15 + 8], [-1e-300, 1e-300], [5e-324, 5e-324], [-5e-324, 0], [0, 5e-324], [nextDown(1), nextUp(1)],
  [nextDown(0.5), nextUp(0.5)], [-0.5, 0.5], [0.2, 0.7], [-0.7, -0.2], [2, 4], [4, 6], [-6, -4], [1e300, 1e301], [0, 1e-300],
]

export function fuzzBoxes(rand: Rand, n: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) out.push(rand() < 0.7 ? pick(rand, EDGE) : randomBox(rand))
  return out
}

// Points of [lo, hi]: the ends, the middle, the specials the box holds, the whole numbers in it and a
// double either side of each, the multiples of a quarter turn and a double either side, a few random
// ones, and the signed zeros it holds (never a zero otherwise: a box with a zero end holds that one).
export function fuzzPoints(lo: number, hi: number, angle: string, rand: Rand): number[] {
  const pts = new Set<number>()
  const add = (x: number): void => {
    if (x !== 0 && lo <= x && x <= hi) pts.add(x)
  }
  add(lo)
  add(hi)
  add((lo + hi) / 2)
  for (const s of SPECIAL) add(s)
  if (Number.isFinite(lo) && Number.isFinite(hi)) {
    for (let k = Math.ceil(lo), i = 0; k <= hi && i < 8; k++, i++) {
      add(k)
      add(nextUp(k))
      add(nextDown(k))
    }
    const step = angle === 'degrees' ? 90 : HALF_PI
    for (let k = Math.ceil(lo / step), i = 0; k * step <= hi && i < 4; k++, i++) {
      add(k * step)
      add(nextUp(k * step))
      add(nextDown(k * step))
    }
    for (let i = 0; i < 5; i++) {
      const x = lo + (hi - lo) * rand()
      if (Number.isFinite(x)) add(Math.max(lo, Math.min(hi, x)))
    }
  }
  return [...pts, ...zerosIn(lo, hi)]
}

// ---------------------------------------------------------------------------
// Soundness against the scalar compile
// ---------------------------------------------------------------------------

function errorOf(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (err) {
    return `${(err as Error).constructor.name}: ${(err as Error).message}`
  }
}

export interface SweepResult {
  // expressions the scalar compile accepted
  compiled: number
  // value checks (soundness) or boxes the twin called CONTINUOUS (continuity)
  checks: number
  failures: string[]
}

// `count` random expressions of x (and y, once in three when `two`), each over `boxes` boxes (a zero end as
// both signs), at every point `fuzzPoints` gives, held to `must`. A compile error must be the scalar's own.
export function soundnessSweep(seed: number, count: number, opts: { boxes?: number; two?: boolean } = {}): SweepResult {
  const rand = mulberry32(seed)
  const boxes = opts.boxes ?? 14
  const result: SweepResult = { compiled: 0, checks: 0, failures: [] }
  const seen = new Set<string>()
  const fail = (message: string): void => {
    if (!seen.has(message) && result.failures.length < 20) {
      seen.add(message)
      result.failures.push(message)
    }
  }
  const out = iv()
  for (let it = 0; it < count; it++) {
    const { scope, desc } = fuzzScope(rand)
    const vars = opts.two && rand() < 0.3 ? ['x', 'y'] : ['x']
    const e = randomExpr(rand, vars, 2 + Math.floor(rand() * 3))
    const label = `${showExpr(e)} ${desc}`
    const se = errorOf(() => compileScalar(e, vars, scope))
    const ie = errorOf(() => compileInterval(e, vars, scope))
    if (se !== ie) {
      fail(`compile errors differ for ${label}: scalar ${se}, twin ${ie}`)
      continue
    }
    if (se) continue
    result.compiled++
    const f = compileScalar(e, vars, scope)
    const g = compileInterval(e, vars, scope)
    if (vars.length === 1) {
      for (const [lo, hi] of fuzzBoxes(rand, boxes)) {
        for (const [l, h] of withZeroSigns(lo, hi)) {
          g(out, l, h)
          for (const x of fuzzPoints(l, h, scope.angle, rand)) {
            const y = f(x)
            result.checks++
            try {
              must(out, y, () => `${label} over [${fmt(l)}, ${fmt(h)}] at ${fmt(x)} gives ${fmt(y)}, twin ${show(out)}`)
            } catch (err) {
              fail((err as Error).message)
            }
          }
        }
      }
    } else {
      const xs = fuzzBoxes(rand, Math.max(4, boxes >> 1))
      const ys = fuzzBoxes(rand, xs.length)
      for (let i = 0; i < xs.length; i++) {
        for (const [xl, xh] of withZeroSigns(xs[i][0], xs[i][1])) {
          for (const [yl, yh] of withZeroSigns(ys[(i * 7 + 3) % ys.length][0], ys[(i * 7 + 3) % ys.length][1])) {
            g(out, xl, xh, yl, yh)
            for (const x of fuzzPoints(xl, xh, scope.angle, rand).slice(0, 10)) {
              for (const y of fuzzPoints(yl, yh, scope.angle, rand).slice(0, 10)) {
                const v = f(x, y)
                result.checks++
                try {
                  must(out, v, () => `${label} over x [${fmt(xl)}, ${fmt(xh)}] y [${fmt(yl)}, ${fmt(yh)}] at (${fmt(x)}, ${fmt(y)}) gives ${fmt(v)}, twin ${show(out)}`)
                } catch (err) {
                  fail((err as Error).message)
                }
              }
            }
          }
        }
      }
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Continuity: a CONTINUOUS box has no jump
// ---------------------------------------------------------------------------

const SAMPLES = 64

// Whether a and c are the same double or neighbours.
function adjacent(a: number, c: number): boolean {
  return a === c || nextUp(a) === c || nextUp(c) === a
}

// Looks for a jump of f inside [lo, hi]: samples SAMPLES + 1 points, takes the widest gap between
// neighbours, and bisects it (always into the half that keeps the larger difference) until the two
// ends are adjacent doubles. A jump is a difference that is still more than a millionth of the values
// there (and they are moderate, so it is not the floating-point steepness next to a pole), most of what
// f moved across its cell, and flat on both sides: 1000, 4000 and 16000 ulps outside, f has moved less
// than a tenth of the gap. A steep curve has not, and nor has a staircase of roundings.
// Returns a description of the jump, or null. A sample that is not finite ends the search (an infinity
// is the overflow a CONTINUOUS verdict does not exclude, and there is no gap to measure).
export function findJump(f: (x: number) => number, lo: number, hi: number): string | null {
  if (!(lo < hi) || !Number.isFinite(lo) || !Number.isFinite(hi)) return null
  const xs: number[] = []
  const ys: number[] = []
  for (let k = 0; k <= SAMPLES; k++) {
    const x = k === SAMPLES ? hi : lo + ((hi - lo) * k) / SAMPLES
    const y = f(x)
    if (!Number.isFinite(y)) return null
    xs.push(x)
    ys.push(y)
  }
  let widest = 0
  let at = 0
  for (let k = 0; k < SAMPLES; k++) {
    const gap = Math.abs(ys[k + 1] - ys[k])
    if (gap > widest) {
      widest = gap
      at = k
    }
  }
  let a = xs[at]
  let c = xs[at + 1]
  let fa = ys[at]
  let fc = ys[at + 1]
  // 1100 halvings reach adjacent doubles even at a jump exactly at 0 (sign, step), which are 1074 binades
  // from a box of width 1; a jump anywhere else takes at most about 53.
  for (let it = 0; it < 1100 && !adjacent(a, c); it++) {
    const m = a + (c - a) / 2
    if (m <= a || m >= c) break
    const fm = f(m)
    if (!Number.isFinite(fm)) return null
    if (Math.abs(fm - fa) >= Math.abs(fc - fm)) {
      c = m
      fc = fm
    } else {
      a = m
      fa = fm
    }
  }
  if (!adjacent(a, c)) return null
  // The step between the adjacent doubles must be real and most of what the function moved across its cell
  // of the sampling. Where it is a small part of it the cell holds many steps (erf near 1 is a staircase of
  // 1.1e-16 steps, and atanh of it amplifies them), and that is the scalar's rounding, not a jump.
  const gap = Math.abs(fc - fa)
  if (!(gap > 0) || !(gap >= 0.25 * widest)) return null
  // The levels either side, read 1000 ulps out and only inside the box (a value isolated at the jump
  // itself, as sign(0) is between its two steps, is neither level, and a point outside the box says
  // nothing about the box). The jump is the difference of the levels.
  const u = Math.max(Math.abs(a), Math.abs(c), 1e-300) * Number.EPSILON * 1000
  const left = a - u >= lo ? f(a - u) : fa
  const right = c + u <= hi ? f(c + u) : fc
  const jump = Math.abs(right - left)
  const scale = Math.max(1, Math.abs(left), Math.abs(right))
  if (!(jump > 1e-6 * scale) || !(scale < 1e6) || !(jump >= 0.5 * gap)) return null
  // Flat on both sides, at two more distances each: a curve that is only chaotic at this scale (sin of an
  // argument of 1e60, whose doubles are further apart than its period) is not flat at all of them, and a
  // steep one moves in proportion to the distance.
  for (const k of [4, 16]) {
    if (a - k * u >= lo && !(Math.abs(f(a - k * u) - left) < 0.1 * jump)) return null
    if (c + k * u <= hi && !(Math.abs(f(c + k * u) - right) < 0.1 * jump)) return null
  }
  return `a jump between ${fmt(a)} and ${fmt(c)}: ${fmt(left)} to ${fmt(right)}`
}

// Boxes of the size a sampler asks about (widths 1e-3 to 1, centres within 6; a degrees scope has them
// 10 to 15 times that, a quarter turn being 90), half of them placed to straddle one of the places a
// function jumps or has a seam. They stay under 130, so that x! does not overflow inside one: the
// scalar's gamma overflows at 171.6, and what follows it (ln of an infinity, then a division) is a
// step the compiled values take and no verdict shows (see the contract in index.ts).
const SEAMS = [0, 1, -1, 2, 3, 0.5, -0.5, HALF_PI, Math.PI, -HALF_PI, 1.5, 0.25]
const SEAMS_DEGREES = [0, 45, 90, -90, 1, -1, 30]

export function samplerBox(rand: Rand, degrees = false): [number, number] {
  const w = Math.pow(10, -3 + rand() * 3) * (degrees ? 15 : 1)
  if (rand() < 0.5) {
    const c = pick(rand, degrees ? SEAMS_DEGREES : SEAMS)
    const off = (rand() - 0.5) * w
    return [c + off - w / 2, c + off + w / 2]
  }
  const c = (rand() - 0.5) * 12 * (degrees ? 10 : 1)
  return [c - w / 2, c + w / 2]
}

// The first box that `g` calls CONTINUOUS and the scalar `f` jumps in, or null; `boxes` of them are tried.
export function continuityViolation(f: (x: number) => number, g: CompiledInterval, boxes: readonly [number, number][]): { box: [number, number]; jump: string } | null {
  const out = iv()
  for (const [lo, hi] of boxes) {
    g(out, lo, hi)
    if (out.v !== CONTINUOUS) continue
    const jump = findJump(f, lo, hi)
    if (jump) return { box: [lo, hi], jump }
  }
  return null
}

// A twin that is wrong in the one way the sweep exists to catch: a box it would call DEFINED (defined, may
// jump) is called CONTINUOUS. Wrapped around a compiled function it is "floor is continuous across an
// integer", "the piecewise seam is continuous", and so on, for whichever construct made the box DEFINED.
export function overclaims(g: CompiledInterval): CompiledInterval {
  return (out, ...ends) => {
    g(out, ...ends)
    if (out.v === DEFINED) out.v = CONTINUOUS
    return out
  }
}

// `count` random expressions of x, each over `boxes` sampler-sized boxes: every box the twin calls
// CONTINUOUS is searched for a jump. `wrap` replaces the compiled twin (the overclaiming one, to show the
// sweep is not vacuous). `checks` counts the boxes searched.
export function continuitySweep(seed: number, count: number, opts: { boxes?: number; wrap?: (g: CompiledInterval) => CompiledInterval } = {}): SweepResult {
  const rand = mulberry32(seed)
  const boxes = opts.boxes ?? 12
  const result: SweepResult = { compiled: 0, checks: 0, failures: [] }
  const seen = new Set<string>()
  const out = iv()
  for (let it = 0; it < count; it++) {
    const { scope, desc } = fuzzScope(rand, true)
    const e = randomExpr(rand, ['x'], 2 + (it % 3), true)
    if (errorOf(() => compileScalar(e, ['x'], scope))) continue
    result.compiled++
    const f = compileScalar(e, ['x'], scope)
    const compiled = compileInterval(e, ['x'], scope)
    const g = opts.wrap ? opts.wrap(compiled) : compiled
    for (let b = 0; b < boxes; b++) {
      const [lo, hi] = samplerBox(rand, scope.angle === 'degrees')
      g(out, lo, hi)
      if (out.v !== CONTINUOUS) continue
      result.checks++
      const jump = findJump(f, lo, hi)
      if (!jump) continue
      const message = `${showExpr(e)} ${desc} over [${fmt(lo)}, ${fmt(hi)}] is CONTINUOUS but has ${jump}`
      if (!seen.has(message) && result.failures.length < 20) {
        seen.add(message)
        result.failures.push(message)
      }
    }
  }
  return result
}
