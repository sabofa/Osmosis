// Interval twins of the piecewise-constant and order built-ins (calc P1b): floor, ceil,
// round, sign, step, mod, min, max and hypot, each enclosing exactly what math/compile.ts's
// BUILTINS give at every point of the box.
//
// floor, ceil, round, sign and step are non-decreasing and integer-valued, so the ends bound
// them exactly (no widening: they are exact), and the box is CONTINUOUS only when both ends
// give the same value (no jump inside), DEFINED otherwise.
//
// They produce zeros of their own, so which signed zero a bound is matters (1 / +0 and 1 / -0
// differ, and the next twin reads the sign). The convention every twin reads (elementary.ts):
// a box end that is a zero is that signed zero, a zero strictly inside the box may be either,
// and a box whose two ends are both zeros holds both signs. So a bound that is exactly a zero
// claims that signed zero and no other. floor, ceil, round, sign, min and max are
// non-decreasing in the order that puts -0 below +0 (as Math.min and Math.max have it:
// Math.ceil(-0.5) is -0, Math.ceil(0) is +0, Math.sign(-0) is -0, roundHalfAway(-0.2) is -0),
// so the image of the ends is the image of the box, and `seal` keeps a zero bound only where
// it is exactly what the box attains there:
//
//   - the bottom is +0, or the top is -0: nothing of the other sign lies beyond it, keep it;
//   - both ends are zeros: the pair is the hull of the zeros attained, keep it (ordered -0
//     then +0, even for a box whose ends are written +0, -0);
//   - the bottom is -0 under a positive top, or the top is +0 over a negative bottom: the zero
//     of the other sign is attained too when the box holds an input zero strictly inside, or
//     an input that the function sends to it (a small negative that ceil and round send to
//     -0, a small positive that floor and round send to +0), and an end that is a zero would
//     deny it to a consumer that reads an end zero as exact (sqrt does), so the bound moves
//     to the nearest double beyond zero, which holds both. Otherwise the zero is exact and
//     stays. The inputs that can give the other zero are the largest negative input of the
//     box and its smallest positive one (the function is monotone), so the twin asks the
//     function at those two.
//
// Nothing here allocates per call: no closures, arrays or fresh Ivs (measured: 0 scavenges in
// 3M calls of floor, ceil, round, sign, step, mod, min and max). mod keeps module-level scratch
// of its own; every twin reads all of its inputs before it writes `out`, so `out` may alias an
// input. The exception is Math.hypot itself, a builtin V8 does not lower: it allocates a heap
// number and a small array inside every call (the scalar compile pays the same).

import { floorMod, roundHalfAway } from '../compile'
import { step } from '../special'
import { div, mul, sub } from './arith'
import { CONTINUOUS, DEFINED, down, isEmpty, type Iv, iv, LIB, PARTIAL, set, setEmpty, up, type Verdict, worst } from './core'
import type { Twin } from './elementary'

// Whether the box holds the zero of the other sign than the one an end of its image is. A zero
// strictly inside the box holds both. Beside that, only an input that the function sends to
// the zero does: `nb` is the function at the box's largest negative input, `pa` at its smallest
// positive one (1 and -1 when it has none), and the function is monotone, so no other input
// of that sign can give the zero when these do not. (A zero end of the box cannot matter here:
// it would make the image's end that same zero, a case seal handles before it asks.)
function holdsMinusZero(a: Iv, nb: number): boolean {
  return (a.lo < 0 && a.hi > 0) || (nb === 0 && 1 / nb < 0)
}

function holdsPlusZero(a: Iv, pa: number): boolean {
  return (a.lo < 0 && a.hi > 0) || (pa === 0 && 1 / pa > 0)
}

// Writes [x, y], the image of a box's ends under a function that is non-decreasing in the
// order -0 < +0, keeping a zero end only where the header says it is exact.
function seal(out: Iv, x: number, y: number, v: Verdict, a: Iv, nb: number, pa: number): void {
  let lo = x
  let hi = y
  if (x === 0) {
    if (y === 0) {
      lo = Math.min(x, y)
      hi = Math.max(x, y)
    } else if (1 / x < 0 && holdsPlusZero(a, pa)) lo = -Number.MIN_VALUE
  } else if (y === 0 && 1 / y > 0 && holdsMinusZero(a, nb)) hi = Number.MIN_VALUE
  set(out, lo, hi, v)
}

// min and max have no such inputs to ask: their sealed box is told it holds both zeros.
const BOTH_ZEROS = iv(-1, 1)

export const floorT: Twin = (out, args) => {
  const a = args[0]
  if (isEmpty(a)) {
    setEmpty(out)
    return
  }
  const x = Math.floor(a.lo)
  const y = Math.floor(a.hi)
  let nb = 1
  let pa = -1
  if (a.lo < 0) nb = Math.floor(Math.min(a.hi, -Number.MIN_VALUE))
  if (a.hi > 0) pa = Math.floor(Math.max(a.lo, Number.MIN_VALUE))
  seal(out, x, y, worst(a.v, x === y ? CONTINUOUS : DEFINED), a, nb, pa)
}

export const ceilT: Twin = (out, args) => {
  const a = args[0]
  if (isEmpty(a)) {
    setEmpty(out)
    return
  }
  const x = Math.ceil(a.lo)
  const y = Math.ceil(a.hi)
  let nb = 1
  let pa = -1
  if (a.lo < 0) nb = Math.ceil(Math.min(a.hi, -Number.MIN_VALUE))
  if (a.hi > 0) pa = Math.ceil(Math.max(a.lo, Number.MIN_VALUE))
  seal(out, x, y, worst(a.v, x === y ? CONTINUOUS : DEFINED), a, nb, pa)
}

export const roundT: Twin = (out, args) => {
  const a = args[0]
  if (isEmpty(a)) {
    setEmpty(out)
    return
  }
  const x = roundHalfAway(a.lo)
  const y = roundHalfAway(a.hi)
  let nb = 1
  let pa = -1
  if (a.lo < 0) nb = roundHalfAway(Math.min(a.hi, -Number.MIN_VALUE))
  if (a.hi > 0) pa = roundHalfAway(Math.max(a.lo, Number.MIN_VALUE))
  seal(out, x, y, worst(a.v, x === y ? CONTINUOUS : DEFINED), a, nb, pa)
}

export const signT: Twin = (out, args) => {
  const a = args[0]
  if (isEmpty(a)) {
    setEmpty(out)
    return
  }
  const x = Math.sign(a.lo)
  const y = Math.sign(a.hi)
  let nb = 1
  let pa = -1
  if (a.lo < 0) nb = Math.sign(Math.min(a.hi, -Number.MIN_VALUE))
  if (a.hi > 0) pa = Math.sign(Math.max(a.lo, Number.MIN_VALUE))
  seal(out, x, y, worst(a.v, x === y ? CONTINUOUS : DEFINED), a, nb, pa)
}

// step(0) = 1, step(x < 0) = 0: it returns the literal 0, never -0, so its zero bound is +0
// at the bottom and nothing lies below it.
export const stepT: Twin = (out, args) => {
  const a = args[0]
  if (isEmpty(a)) {
    setEmpty(out)
    return
  }
  const x = step(a.lo)
  const y = step(a.hi)
  set(out, x, y, worst(a.v, x === y ? CONTINUOUS : DEFINED))
}

// ---------------------------------------------------------------------------
// mod
// ---------------------------------------------------------------------------

// mod(a, b) is the scalar's floorMod: a - b·floor(a/b), each operation rounded. It is
// composed from the twins (q = a/b, f = floor q, t = b·f, r = a - t), which is sound, with
// three improvements that keep it from being useless where it jumps:
//
//  - Two exact points are the scalar value itself, and a point box on a multiple of b is not
//    a box that straddles it.
//  - The quotient's range is read from the four corner quotients, without the outward
//    widening of `div`: the scalar's q is fl(a/b), rounding is monotone, so over a divisor that
//    does not reach 0 its extremes are the corners' own fl quotients. (Widened by 2 ulps, a q
//    within 2 ulps of a whole number would claim a jump that is not there.)
//  - When f jumps inside the box the composition is useless (a - b·[k1, k2] is as wide as
//    both put together, [-1, 4] for mod(x, 3) over [2, 4], whose values are in [0, 3)), so the
//    result is also held to the range mod has: for a divisor of one sign, [0, b) in that sign,
//    plus the rounding of the three operations. With |a/b| below 2^50 the rounded quotient is
//    within one of the true floor (f is n or n + 1), the residual a - b·f is then in [0, b)
//    or just below 0 by the rounding gap of q, and the products and the difference add at most
//    four 2^-53 of |a| + |b| (it is the whole numbers up to 2^53 that a double holds): E =
//    (|a| + |b|)·2^-48, eight times that, holds them with margin (plus 8
//    subnormals: a quotient that underflows to -0 leaves r = a, a tiny negative). The
//    composition and the range are both enclosures of the same set, so their intersection is
//    one; it is never empty when the box is not, and the guard below is for the day an
//    analysis is wrong, which must not read as "undefined everywhere".
//
// mod never returns -0 (x - x is +0, and -0 - -0 is +0), so a bound that is exactly +0 claims
// nothing false. The bounds of the composition are widened, but a widened bound can be a zero:
// down(5e-324) is +0 (5e-324 less its own ulp rounds to 0), so "never exactly zero" would be wrong.
// It is harmless here, for that +0 is a zero mod gives, and no -0 occurs for it to deny.

const MOD_Q = iv()
const MOD_F = iv()
const MOD_T = iv()
const MOD_R = iv()
const Q_LIMIT = 2 ** 50
const E_REL = 2 ** -48
const E_ABS = 8 * Number.MIN_VALUE

export const modT: Twin = (out, args) => {
  const a = args[0]
  const b = args[1]
  if (isEmpty(a) || isEmpty(b)) {
    setEmpty(out)
    return
  }
  const al = a.lo
  const ah = a.hi
  const bl = b.lo
  const bh = b.hi
  const v = worst(a.v, b.v)
  // two exact points: the scalar's own value (a box [-0, +0] is not a point: it holds both zeros)
  if (Object.is(al, ah) && Object.is(bl, bh)) {
    const r = floorMod(al, bl)
    if (r !== r) setEmpty(out)
    else set(out, r, r, v)
    return
  }
  // the quotient's range: from the corners over a divisor that does not reach 0, else `div`'s
  let qlo = 0
  let qhi = 0
  let qv: Verdict = v
  let direct = false
  if (bl > 0 || bh < 0) {
    const q1 = al / bl
    const q2 = al / bh
    const q3 = ah / bl
    const q4 = ah / bh
    qlo = Math.min(q1, q2, q3, q4)
    qhi = Math.max(q1, q2, q3, q4)
    // Infinity / Infinity is NaN, and Math.min then is too
    direct = qlo === qlo
  }
  if (!direct) {
    div(MOD_Q, a, b)
    qlo = MOD_Q.lo
    qhi = MOD_Q.hi
    qv = MOD_Q.v
  }
  const flo = Math.floor(qlo)
  const fhi = Math.floor(qhi)
  set(MOD_F, flo, fhi, worst(qv, flo === fhi ? CONTINUOUS : DEFINED))
  mul(MOD_T, b, MOD_F)
  sub(MOD_R, a, MOD_T)
  let lo = MOD_R.lo
  let hi = MOD_R.hi
  if (direct && flo !== fhi) {
    const A = Math.max(Math.abs(al), Math.abs(ah))
    const B = Math.max(Math.abs(bl), Math.abs(bh))
    const Q = Math.max(Math.abs(qlo), Math.abs(qhi))
    if (A < Infinity && B < Infinity && Q <= Q_LIMIT) {
      const e = (A + B) * E_REL + E_ABS
      let clipLo: number
      let clipHi: number
      if (bl > 0) {
        clipLo = -e
        clipHi = bh + e
      } else {
        clipLo = bl - e
        clipHi = e
      }
      const l = Math.max(lo, clipLo)
      const h = Math.min(hi, clipHi)
      if (l <= h) {
        lo = l
        hi = h
      }
    }
  }
  set(out, lo, hi, MOD_R.v)
}

// ---------------------------------------------------------------------------
// min, max, hypot
// ---------------------------------------------------------------------------

// min and max are non-decreasing in every argument (in the order that puts -0 below +0, as
// Math.min and Math.max do), so the bounds are the min or max of the bounds, sealed as above.
// An argument written [+0, -0] holds both zeros, so it is read as [-0, +0]. An argument that
// is NaN everywhere makes the answer NaN everywhere: Math.min(NaN, Infinity) is NaN.
export const minT: Twin = (out, args) => {
  let lo = Infinity
  let hi = Infinity
  let v: Verdict = CONTINUOUS
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (isEmpty(a)) {
      setEmpty(out)
      return
    }
    let l = a.lo
    let h = a.hi
    if (l === 0 && h === 0 && 1 / l > 0 && 1 / h < 0) {
      l = -0
      h = 0
    }
    lo = Math.min(lo, l)
    hi = Math.min(hi, h)
    v = worst(v, a.v)
  }
  seal(out, lo, hi, v, BOTH_ZEROS, 0, 0)
}

export const maxT: Twin = (out, args) => {
  let lo = -Infinity
  let hi = -Infinity
  let v: Verdict = CONTINUOUS
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (isEmpty(a)) {
      setEmpty(out)
      return
    }
    let l = a.lo
    let h = a.hi
    if (l === 0 && h === 0 && 1 / l > 0 && 1 / h < 0) {
      l = -0
      h = 0
    }
    lo = Math.max(lo, l)
    hi = Math.max(hi, h)
    v = worst(v, a.v)
  }
  seal(out, lo, hi, v, BOTH_ZEROS, 0, 0)
}

// hypot is non-decreasing in each |argument|, so its least value is at the nearest point of
// every argument to 0 and its greatest at the farthest. It is never negative, and exactly +0
// only at all-zero arguments (Math.hypot(+-0, +-0) is +0): a zero bound is that +0, unwidened.
// Math.hypot is a library function (LIB), and any infinite argument makes it Infinity even
// where another is NaN: an argument that is NaN everywhere leaves Infinity, not NaN, when
// another reaches an infinity.
// scratch: the nearest and farthest |value| of each argument of a call of two or three, in typed
// arrays (a helper that returns a double boxes it), and a plain array for any other count (the
// scalar compile spreads an array for more than three, and the arity allows no fewer than two)
const NEAR = new Float64Array(3)
const FAR = new Float64Array(3)
const HYPOT_ARGS: number[] = []

export const hypotT: Twin = (out, args) => {
  const n = args.length
  let v: Verdict = CONTINUOUS
  let anyEmpty = false
  let reachesInfinity = false
  for (let i = 0; i < n; i++) {
    const a = args[i]
    if (isEmpty(a)) anyEmpty = true
    else if (a.lo === -Infinity || a.hi === Infinity) reachesInfinity = true
    v = worst(v, a.v)
  }
  if (anyEmpty) {
    if (reachesInfinity) set(out, Infinity, Infinity, PARTIAL)
    else setEmpty(out)
    return
  }
  let lo: number
  let hi: number
  if (n === 2 || n === 3) {
    for (let i = 0; i < n; i++) {
      const a = args[i]
      const x = Math.abs(a.lo)
      const y = Math.abs(a.hi)
      NEAR[i] = a.lo <= 0 && 0 <= a.hi ? 0 : Math.min(x, y)
      FAR[i] = Math.max(x, y)
    }
    if (n === 2) {
      lo = Math.hypot(NEAR[0], NEAR[1])
      hi = Math.hypot(FAR[0], FAR[1])
    } else {
      lo = Math.hypot(NEAR[0], NEAR[1], NEAR[2])
      hi = Math.hypot(FAR[0], FAR[1], FAR[2])
    }
  } else {
    HYPOT_ARGS.length = n
    for (let i = 0; i < n; i++) {
      const a = args[i]
      HYPOT_ARGS[i] = a.lo <= 0 && 0 <= a.hi ? 0 : Math.min(Math.abs(a.lo), Math.abs(a.hi))
    }
    lo = Math.hypot.apply(null, HYPOT_ARGS)
    for (let i = 0; i < n; i++) {
      const a = args[i]
      HYPOT_ARGS[i] = Math.max(Math.abs(a.lo), Math.abs(a.hi))
    }
    hi = Math.hypot.apply(null, HYPOT_ARGS)
  }
  if (lo !== 0) lo = Math.max(0, down(lo, LIB))
  if (hi !== 0) hi = up(hi, LIB)
  set(out, lo, hi, v)
}
