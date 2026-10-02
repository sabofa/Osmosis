// Interval arithmetic for the twin (calc P1b). Each operation reads its
// operands before writing `out`, so `out` may alias either. Nothing here
// allocates per call: no closures, no arrays, no scratch objects.

import { down, isEmpty, type Iv, LIB, PARTIAL, set, setEmpty, up, type Verdict, worst } from './core'

function unbounded(a: Iv): boolean {
  return a.lo === -Infinity || a.hi === Infinity
}

function hasZero(a: Iv): boolean {
  return a.lo <= 0 && 0 <= a.hi
}

export function neg(out: Iv, a: Iv): Iv {
  if (isEmpty(a)) return setEmpty(out)
  return set(out, -a.hi, -a.lo, a.v)
}

export function add(out: Iv, a: Iv, b: Iv): Iv {
  if (isEmpty(a) || isEmpty(b)) return setEmpty(out)
  // inf + -inf is NaN in the scalar compile: only possible when both sides reach
  // opposite infinities.
  const clash = (a.hi === Infinity && b.lo === -Infinity) || (a.lo === -Infinity && b.hi === Infinity)
  const v: Verdict = clash ? worst(worst(a.v, b.v), PARTIAL) : worst(a.v, b.v)
  return set(out, down(a.lo + b.lo), up(a.hi + b.hi), v)
}

export function sub(out: Iv, a: Iv, b: Iv): Iv {
  if (isEmpty(a) || isEmpty(b)) return setEmpty(out)
  const clash = (a.hi === Infinity && b.hi === Infinity) || (a.lo === -Infinity && b.lo === -Infinity)
  const v: Verdict = clash ? worst(worst(a.v, b.v), PARTIAL) : worst(a.v, b.v)
  return set(out, down(a.lo - b.hi), up(a.hi - b.lo), v)
}

// 0 · inf is 0 for an enclosure of products (the scalar NaN case is flagged
// separately, below).
function times(x: number, y: number): number {
  const p = x * y
  return p !== p ? 0 : p
}

export function mul(out: Iv, a: Iv, b: Iv): Iv {
  if (isEmpty(a) || isEmpty(b)) return setEmpty(out)
  const p1 = times(a.lo, b.lo)
  const p2 = times(a.lo, b.hi)
  const p3 = times(a.hi, b.lo)
  const p4 = times(a.hi, b.hi)
  // 0 · inf is NaN in the scalar compile when an operand really is infinite.
  const clash = (unbounded(a) && hasZero(b)) || (unbounded(b) && hasZero(a))
  const v: Verdict = clash ? worst(worst(a.v, b.v), PARTIAL) : worst(a.v, b.v)
  return set(out, down(Math.min(p1, p2, p3, p4)), up(Math.max(p1, p2, p3, p4)), v)
}

export function div(out: Iv, a: Iv, b: Iv): Iv {
  if (isEmpty(a) || isEmpty(b)) return setEmpty(out)
  const v = worst(a.v, b.v)
  if (b.lo > 0 || b.hi < 0) {
    const q1 = a.lo / b.lo
    const q2 = a.lo / b.hi
    const q3 = a.hi / b.lo
    const q4 = a.hi / b.hi
    if (q1 !== q1 || q2 !== q2 || q3 !== q3 || q4 !== q4) return set(out, -Infinity, Infinity, worst(v, PARTIAL))
    return set(out, down(Math.min(q1, q2, q3, q4)), up(Math.max(q1, q2, q3, q4)), v)
  }
  // The divisor reaches zero: undefined there.
  const p = worst(v, PARTIAL)
  if (b.lo === 0 && b.hi === 0) return setEmpty(out)
  if (hasZero(a) || (b.lo < 0 && b.hi > 0)) return set(out, -Infinity, Infinity, p)
  if (b.lo === 0) return a.lo > 0 ? set(out, down(a.lo / b.hi), Infinity, p) : set(out, -Infinity, up(a.hi / b.hi), p)
  return a.lo > 0 ? set(out, -Infinity, up(a.lo / b.lo), p) : set(out, down(a.hi / b.lo), Infinity, p)
}

// f monotone on (-inf, 0] and on [0, inf) (either direction on each side), with
// f(0) = at0, or at0 NaN for a pole or a hole at 0. Bounds come from the ends
// and, when 0 is strictly inside, from f(0). A non-finite end value marks the
// result partial (a pole or an overflow at that end). `p` is handed to f, so a
// parameterised f (x^n) is a module-level function and not a closure.
//
// With at0 NaN and 0 in the box the result is partial, and f(0) itself is not
// read: the scalar value at 0 is infinite or NaN, which a partial verdict allows,
// and the sign of an infinity at 0 depends on the sign of the zero. Each side
// that reaches 0 is bounded by f at the double nearest 0 on that side (monotone,
// so nothing between that double and 0 exists to exceed it), which keeps the
// side's real limit and its true sign.
export function sides(out: Iv, a: Iv, f: (x: number, p: number) => number, at0: number, rel: number = LIB, p = 0): Iv {
  if (isEmpty(a)) return setEmpty(out)
  if (Number.isNaN(at0) && a.lo <= 0 && 0 <= a.hi) return sidesPole(out, a, f, rel, p)
  const x = f(a.lo, p)
  const y = f(a.hi, p)
  let lo = Math.min(x, y)
  let hi = Math.max(x, y)
  if (a.lo < 0 && 0 < a.hi) {
    lo = Math.min(lo, at0)
    hi = Math.max(hi, at0)
  }
  const v: Verdict = lo > -Infinity && hi < Infinity ? a.v : worst(a.v, PARTIAL)
  // A NaN end (f undefined there) is no bound; `set` turns it into -inf / +inf.
  return set(out, down(lo, rel), up(hi, rel), v)
}

// `sides` for a pole or hole at 0 that the box reaches (see above): always
// partial. Kept apart so the common case stays small.
function sidesPole(out: Iv, a: Iv, f: (x: number, p: number) => number, rel: number, p: number): Iv {
  const v = worst(a.v, PARTIAL)
  let lo: number
  let hi: number
  if (a.lo < 0 && a.hi > 0) {
    const x = f(a.lo, p)
    const y = f(-Number.MIN_VALUE, p)
    const z = f(Number.MIN_VALUE, p)
    const w = f(a.hi, p)
    lo = Math.min(Math.min(x, y), Math.min(z, w))
    hi = Math.max(Math.max(x, y), Math.max(z, w))
  } else if (a.lo < 0) {
    const x = f(a.lo, p)
    const y = f(-Number.MIN_VALUE, p)
    lo = Math.min(x, y)
    hi = Math.max(x, y)
  } else if (a.hi > 0) {
    const x = f(Number.MIN_VALUE, p)
    const y = f(a.hi, p)
    lo = Math.min(x, y)
    hi = Math.max(x, y)
  } else {
    return setEmpty(out)
  }
  return set(out, down(lo, rel), up(hi, rel), v)
}

// x^n for a whole n (the scalar compile's Math.pow).
export function powInt(out: Iv, a: Iv, n: number): Iv {
  if (isEmpty(a)) return setEmpty(out)
  if (n === 0) return set(out, 1, 1, a.v)
  return sides(out, a, Math.pow, n > 0 ? 0 : Number.NaN, LIB, n)
}

// x^e for a real, non-integer e that is not a literal odd root: defined for
// x >= 0 only (a finite negative base is NaN). The scalar compile still gives a
// value at a base of -inf (+inf for e > 0, +0 for e < 0), so a box that reaches
// it keeps that value; and an infinite e makes every negative base 0, inf or NaN,
// which no bound narrower than [0, inf] holds.
export function powReal(out: Iv, a: Iv, e: number): Iv {
  if (isEmpty(a)) return setEmpty(out)
  if (!Number.isFinite(e)) return set(out, 0, Infinity, worst(a.v, PARTIAL))
  let v: Verdict = a.v
  let lo = Infinity
  let hi = -Infinity
  if (a.lo < 0) v = worst(v, PARTIAL)
  if (a.lo === -Infinity) {
    const z = Math.pow(-Infinity, e)
    lo = z
    hi = z
  }
  if (a.hi >= 0) {
    const x = Math.pow(a.lo > 0 ? a.lo : 0, e)
    const y = Math.pow(a.hi, e)
    if (!Number.isFinite(x) || !Number.isFinite(y)) v = worst(v, PARTIAL)
    lo = Math.min(lo, x, y)
    hi = Math.max(hi, x, y)
  }
  if (lo > hi) return setEmpty(out)
  return set(out, down(lo, LIB), up(hi, LIB), v)
}

// The two shapes of realOddPow (rational.ts): for a negative base, -|x|^e when
// p is odd and |x|^e when p is even; bit for bit the same on a non-negative base.
// Module-level so powOddRoot passes one to `sides` without a closure.
function oddRootOdd(x: number, e: number): number {
  return x < 0 ? -Math.pow(-x, e) : Math.pow(x, e)
}

function oddRootEven(x: number, e: number): number {
  return x < 0 ? Math.pow(-x, e) : Math.pow(x, e)
}

// x^(p/q) for a literal ratio with q odd: realOddPow, monotone on each side of 0.
export function powOddRoot(out: Iv, a: Iv, e: number, pOdd: boolean): Iv {
  return sides(out, a, pOdd ? oddRootOdd : oddRootEven, e > 0 ? 0 : Number.NaN, LIB, e)
}

// x^y with an interval exponent. For x > 0, x^y is monotone in each variable,
// so the four corners bound it; otherwise it is not defined everywhere and no
// cheap enclosure is attempted.
export function powGeneral(out: Iv, a: Iv, b: Iv): Iv {
  if (isEmpty(a) || isEmpty(b)) return setEmpty(out)
  if (b.lo === b.hi) {
    const e = b.lo
    const v0 = worst(a.v, b.v)
    if (Number.isInteger(e)) return withVerdict(powInt(out, a, e), v0)
    return withVerdict(powReal(out, a, e), v0)
  }
  if (!(a.lo > 0)) return set(out, -Infinity, Infinity, worst(worst(a.v, b.v), PARTIAL))
  const c1 = Math.pow(a.lo, b.lo)
  const c2 = Math.pow(a.lo, b.hi)
  const c3 = Math.pow(a.hi, b.lo)
  const c4 = Math.pow(a.hi, b.hi)
  let v = worst(a.v, b.v)
  if (!Number.isFinite(c1) || !Number.isFinite(c2) || !Number.isFinite(c3) || !Number.isFinite(c4)) v = worst(v, PARTIAL)
  return set(out, down(Math.min(c1, c2, c3, c4), LIB), up(Math.max(c1, c2, c3, c4), LIB), v)
}

function withVerdict(out: Iv, v: Verdict): Iv {
  out.v = worst(out.v, v)
  return out
}
