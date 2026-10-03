// Interval arithmetic for the twin (calc P1b). Each operation reads its
// operands before writing `out`, so `out` may alias either. Nothing here
// allocates per call: no closures, no arrays, no scratch objects.

import { down, hull, isEmpty, type Iv, iv, LIB, PARTIAL, set, setEmpty, up, type Verdict, worst } from './core'

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

// A box whose two ends are zeros of different sign, [-0, +0] or [+0, -0], holds both zeros; a zero bound
// beside any other bound claims its own sign alone (see `sides`).
function bothZeros(a: Iv): boolean {
  return a.lo === 0 && a.hi === 0 && !Object.is(a.lo, a.hi)
}

// A bound that is the sum (or difference) of two bounds that are exactly zero is not widened: 0 + 0 has no
// rounding, and a floor of -5e-324 under x^2 + y^2 would take sqrt of it out of its domain over boxes where the
// scalar is defined everywhere. The sign of the result is IEEE's (+0 + +0 and +0 + -0 are +0, -0 + -0 is -0),
// and it is the one the operands' claims leave the sum able to give: an operand bound of +0 says no -0 occurs,
// one of -0 says no +0 occurs (see `sides`), so the sum cannot be the zero that IEEE's table does not give.
// Not so for an operand that holds both zeros: [+0, -0] + [-0, +0] gives -0 at (-0, -0), which the sum of the
// bounds, +0, would deny. Those are widened as before.
export function add(out: Iv, a: Iv, b: Iv): Iv {
  if (isEmpty(a) || isEmpty(b)) return setEmpty(out)
  // inf + -inf is NaN in the scalar compile: only possible when both sides reach
  // opposite infinities.
  const clash = (a.hi === Infinity && b.lo === -Infinity) || (a.lo === -Infinity && b.hi === Infinity)
  const v: Verdict = clash ? worst(worst(a.v, b.v), PARTIAL) : worst(a.v, b.v)
  const lo = a.lo + b.lo
  const hi = a.hi + b.hi
  return set(out, a.lo === 0 && b.lo === 0 && !bothZeros(a) && !bothZeros(b) ? lo : down(lo), a.hi === 0 && b.hi === 0 && !bothZeros(a) && !bothZeros(b) ? hi : up(hi), v)
}

export function sub(out: Iv, a: Iv, b: Iv): Iv {
  if (isEmpty(a) || isEmpty(b)) return setEmpty(out)
  const clash = (a.hi === Infinity && b.hi === Infinity) || (a.lo === -Infinity && b.lo === -Infinity)
  const v: Verdict = clash ? worst(worst(a.v, b.v), PARTIAL) : worst(a.v, b.v)
  const lo = a.lo - b.hi
  const hi = a.hi - b.lo
  return set(out, a.lo === 0 && b.hi === 0 && !bothZeros(a) && !bothZeros(b) ? lo : down(lo), a.hi === 0 && b.lo === 0 && !bothZeros(a) && !bothZeros(b) ? hi : up(hi), v)
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
  // The divisor reaches zero: a pole (or 0 / 0, NaN) there. The scalar compile
  // still gives a value at the zero, +-infinity, and a later twin may map it back
  // to a finite one (1 / (1 / 0) is 0), so the answer must hold that infinity.
  const p = worst(v, PARTIAL)
  // a divisor that is exactly zero: nothing but 0 / 0 is empty
  if (b.lo === 0 && b.hi === 0) return a.lo === 0 && a.hi === 0 ? setEmpty(out) : set(out, -Infinity, Infinity, p)
  if (hasZero(a) || (b.lo < 0 && b.hi > 0)) return set(out, -Infinity, Infinity, p)
  // The zero end is a point of the box and a / +0, a / -0 are infinities of opposite
  // sign: the one-sided answer holds only when the zero has the sign of the side the
  // rest of the box lies on (a +0 end with the rest positive, a -0 end with the rest
  // negative); a zero of the other sign also reaches the other infinity.
  if (b.lo === 0 ? 1 / b.lo < 0 : 1 / b.hi > 0) return set(out, -Infinity, Infinity, p)
  if (b.lo === 0) return a.lo > 0 ? set(out, down(a.lo / b.hi), Infinity, p) : set(out, -Infinity, up(a.hi / b.hi), p)
  return a.lo > 0 ? set(out, -Infinity, up(a.lo / b.lo), p) : set(out, down(a.hi / b.lo), Infinity, p)
}

// f monotone on (-inf, 0] and on [0, inf) (either direction on each side), with
// f(0) = at0, or at0 NaN for a pole or a hole at 0. Bounds come from the ends
// and, when 0 is strictly inside, from f(0). A NaN end value marks the result
// partial with no bound on that side; an infinite one (an overflow) keeps the
// verdict: PARTIAL means a NaN or a pole, and overflow is neither.
//
// `p` (default 0) is handed to every call of f as its second argument, so a
// parameterised f (x^n) is a module-level function and not a closure. A function
// with a meaningful optional second argument must therefore not be passed bare:
// wrap it in a module-level function that ignores `p`.
//
// With at0 NaN and 0 in the box the result is partial, and each side that reaches
// 0 is bounded by f at the double nearest 0 on that side (monotone, so nothing
// between that double and 0 exists to exceed it), which keeps the side's real
// limit and its true sign. The scalar's own value at each zero the box holds is
// hulled in as well (see sidesPole).
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
  const v: Verdict = lo !== lo || hi !== hi ? worst(a.v, PARTIAL) : a.v
  // A NaN end (f undefined there) is no bound; `set` turns it into -inf / +inf.
  return widen(out, a, f, p, lo, hi, v, rel)
}

// The signed zeros f gives over the box a, as bits (1: +0, 2: -0), from the values at the ends, at the doubles
// nearest 0 on each side the box reaches, and at +0 and -0 where it holds both. f is monotone on each side, so
// the values between those points lie between theirs, and the sign of a zero that underflow makes (x^3 for a
// tiny x has the sign of x) is the sign at the nearest point.
function zerosOf(a: Iv, f: (x: number, p: number) => number, p: number): number {
  const lo = a.lo
  const hi = a.hi
  let z = zeroSign(f(lo, p)) | zeroSign(f(hi, p))
  if (lo < 0 && hi >= 0) z |= zeroSign(f(-Number.MIN_VALUE, p))
  if (hi > 0 && lo <= 0) z |= zeroSign(f(Number.MIN_VALUE, p))
  if (lo < 0 && hi > 0) z |= zeroSign(f(0, p)) | zeroSign(f(-0, p))
  return z
}

function zeroSign(x: number): number {
  return x !== 0 ? 0 : 1 / x > 0 ? 1 : 2
}

// [lo, hi], the extremes of f over a, widened outward by `rel` (the library's own non-monotonicity), except
// that an extreme that is exactly 0 is kept. Widening has nothing to cover there: a zero extreme is a value f
// gives, not a rounding of one (and f never goes below +0 for an even power, abs or an even root, whose
// floor is 0). A floor of -5e-324 under x^2 takes sqrt(x^2) out of its domain over a box where the scalar is
// defined at every point; one is moved off zero only where the zero is not alone.
//
// The zero extreme claims its sign (the zero-bound invariant, compose.testkit `must`): a bottom of +0 says no
// -0 occurs, a top of -0 says no +0 occurs, a bottom of -0 under a positive top says no +0 and a top of +0 over
// a negative bottom says no -0 (1 / the box, sqrt and atan2 read it). So an extreme that is zero is kept only
// when f gives one signed zero over the box: that zero, whichever sign of zero the extreme came from. When f
// gives both (x^3 over [-0, 2]: -0 at the end, +0 for a tiny positive), a bottom or top that is a zero moves to
// the nearest double past it, which holds both; a box whose two extremes are zeros is the pair -0, +0.
function widen(out: Iv, a: Iv, f: (x: number, p: number) => number, p: number, lo: number, hi: number, v: Verdict, rel: number): Iv {
  let l = down(lo, rel)
  let h = up(hi, rel)
  if (lo === 0 || hi === 0) {
    const z = zerosOf(a, f, p)
    if (z === 1 || z === 2) {
      if (lo === 0) l = z === 1 ? 0 : -0
      if (hi === 0) h = z === 1 ? 0 : -0
    } else if (z === 3 && lo === 0 && hi === 0) {
      l = -0
      h = 0
    }
  }
  return set(out, l, h, v)
}

// `sides` for a pole or hole at 0 that the box reaches (see above): always
// partial. Kept apart so the common case stays small.
//
// The scalar compile still gives a value at a zero the box holds, and that value
// (usually an infinity) is a point of the answer: a later twin may map it back to
// a finite one (1 / (x^-1) is 0 at 0), so an answer that left it out would make
// the next twin wrong. A box end that is a zero is that signed zero; a zero
// strictly inside may be either sign, so f(+0) and f(-0) both count (they differ:
// Math.pow(-0, -1) is -Infinity). A NaN value at a zero adds nothing (a partial
// verdict covers it), and an answer is empty only when every value is NaN.
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
    lo = Infinity
    hi = -Infinity
  }
  if (a.lo < 0 && a.hi > 0) {
    const z0 = f(0, p)
    const z1 = f(-0, p)
    if (z0 === z0) {
      lo = Math.min(lo, z0)
      hi = Math.max(hi, z0)
    }
    if (z1 === z1) {
      lo = Math.min(lo, z1)
      hi = Math.max(hi, z1)
    }
  } else {
    if (a.lo === 0) {
      const z = f(a.lo, p)
      if (z === z) {
        lo = Math.min(lo, z)
        hi = Math.max(hi, z)
      }
    }
    if (a.hi === 0) {
      const z = f(a.hi, p)
      if (z === z) {
        lo = Math.min(lo, z)
        hi = Math.max(hi, z)
      }
    }
  }
  if (lo > hi) return setEmpty(out)
  return widen(out, a, f, p, lo, hi, v, rel)
}

// x^n for a whole n (the scalar compile's Math.pow).
export function powInt(out: Iv, a: Iv, n: number): Iv {
  // Math.pow(NaN, 0) is 1: x^0 is 1 even where x is undefined, so an empty base
  // still gives [1, 1] (a.v is partial then)
  if (n === 0) return set(out, 1, 1, a.v)
  if (isEmpty(a)) return setEmpty(out)
  return sides(out, a, Math.pow, n > 0 ? 0 : Number.NaN, LIB, n)
}

// x^e for a real, non-integer e that is not a literal odd root: defined for
// x >= 0 only (a finite negative base is NaN). The scalar compile still gives a
// value at a base of -inf (+inf for e > 0, +0 for e < 0), so a box that reaches
// it keeps that value; and an infinite e makes every negative base 0, inf or NaN,
// which no bound narrower than [0, inf] holds. Partial means a NaN (a negative
// base) or a pole (e < 0 with 0 in the box); an overflow keeps the verdict.
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
    if (e < 0 && a.lo <= 0) v = worst(v, PARTIAL)
    const x = Math.pow(a.lo > 0 ? a.lo : 0, e)
    const y = Math.pow(a.hi, e)
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

// Scratch for the one-whole-number path of powGeneral: the negative part of the base and its power.
const NEG_BASE = iv()
const NEG_POW = iv()

// x^y over a base x in [0, top] (top >= +0, possibly Infinity) and an exponent box b with finite ends.
// On x > 0 the power is monotone in each variable, so its extremes are at the corners, and the corners
// at the base 0 are the values Math.pow(+0, y) takes: 0 for y > 0, Infinity for y < 0, 1 at y = 0 (inside
// the range the corners span). The power is never negative, so a floor that the widening takes below 0
// is 0, and a ceiling that is exactly 0 is a value (every corner underflowed or is 0): a bound that is a
// zero here is +0, which is what Math.pow gives. Reads b before it writes out.
function powFromZero(out: Iv, top: number, b: Iv, v: Verdict): Iv {
  const c1 = Math.pow(0, b.lo)
  const c2 = Math.pow(0, b.hi)
  const c3 = Math.pow(top, b.lo)
  const c4 = Math.pow(top, b.hi)
  const hi = Math.max(c1, c2, c3, c4)
  return set(out, Math.max(0, down(Math.min(c1, c2, c3, c4), LIB)), hi === 0 ? 0 : up(hi, LIB), v)
}

// x^y over a base box that reaches 0 or below (a.lo finite) under an exponent box with no whole
// number. Math.pow is NaN for a finite negative base at every other y, so a base wholly below 0 is
// NaN at every point (empty), and a base that reaches 0 keeps its part from 0 up, with Math.pow(+-0, y)
// the same either sign of zero (+0 for y > 0, +Infinity for y < 0). A base below 0 anywhere is a NaN
// (partial), and so is a negative exponent, which is a pole at the zero the box holds.
function powNoWhole(out: Iv, a: Iv, b: Iv): Iv {
  if (a.hi < 0) return setEmpty(out)
  const v = worst(a.v, b.v)
  return powFromZero(out, a.hi > 0 ? a.hi : 0, b, a.lo < 0 || b.hi < 0 ? worst(v, PARTIAL) : v)
}

// ... and with exactly one whole number n in the exponent box (n = ceil(b.lo), and n + 1 is past b.hi),
// and a base reaching below 0: the negative part is a number only at y = n, where it is its n-th power,
// and NaN at every other y (partial); the part from 0 up is as above. The negative part's top is -0
// (the box holds -0 whenever it reaches 0 from below, and a +0 top is only looser). The hull of the two
// would put a zero bound beside values of the other sign of zero (a bottom -0 under a positive top denies
// the +0 the part from zero gives, and a top +0 over a negative bottom denies a -0), so it moves such a
// bound to the nearest double past zero, as piecewise's union does. Reads a and b before it writes out.
function powOneWhole(out: Iv, a: Iv, b: Iv, n: number): Iv {
  const lo = a.lo
  const hi = a.hi
  const v = worst(worst(a.v, b.v), PARTIAL)
  NEG_BASE.lo = lo
  NEG_BASE.hi = hi < 0 ? hi : -0
  NEG_BASE.v = a.v
  powInt(NEG_POW, NEG_BASE, n)
  if (hi < 0) {
    out.lo = NEG_POW.lo
    out.hi = NEG_POW.hi
    out.v = worst(NEG_POW.v, v)
    return out
  }
  powFromZero(out, hi > 0 ? hi : 0, b, v)
  hull(out, NEG_POW)
  if (Object.is(out.lo, -0) && out.hi > 0) out.lo = -Number.MIN_VALUE
  if (Object.is(out.hi, 0) && out.lo < 0) out.hi = Number.MIN_VALUE
  return out
}

// x^y with an interval exponent. For x > 0, x^y is monotone in each variable,
// so the four corners bound it. A base that reaches 0 or below has no cheap
// enclosure in general, but Math.pow is NaN for a finite negative base at every
// y that is not a whole number, so an exponent box with no whole number (or one)
// leaves little of the negative part (powNoWhole, powOneWhole). An empty base is
// NaN, and Math.pow(NaN, 0) is 1.
export function powGeneral(out: Iv, a: Iv, b: Iv): Iv {
  if (isEmpty(b)) return setEmpty(out)
  if (isEmpty(a)) return hasZero(b) ? set(out, 1, 1, worst(PARTIAL, b.v)) : setEmpty(out)
  if (b.lo === b.hi) {
    const e = b.lo
    const v0 = worst(a.v, b.v)
    if (Number.isInteger(e)) return withVerdict(powInt(out, a, e), v0)
    return withVerdict(powReal(out, a, e), v0)
  }
  if (!(a.lo > 0)) {
    // A base of -Infinity is not NaN for a real exponent (+Infinity or 0), so it keeps the whole line.
    if (a.lo > -Infinity) {
      const n = Math.ceil(b.lo)
      if (n > b.hi) return powNoWhole(out, a, b)
      if (a.lo < 0 && n + 1 > b.hi) return powOneWhole(out, a, b, n)
    }
    return set(out, -Infinity, Infinity, worst(worst(a.v, b.v), PARTIAL))
  }
  const c1 = Math.pow(a.lo, b.lo)
  const c2 = Math.pow(a.lo, b.hi)
  const c3 = Math.pow(a.hi, b.lo)
  const c4 = Math.pow(a.hi, b.hi)
  let v = worst(a.v, b.v)
  // Over a positive base only a base of 1 under an infinite exponent is NaN (in
  // JavaScript), and no corner shows it when 1 is strictly inside the base.
  // Overflow to 0 or infinity is not undefinedness: the verdict stays.
  if ((a.lo <= 1 && 1 <= a.hi && (b.lo === -Infinity || b.hi === Infinity)) || c1 !== c1 || c2 !== c2 || c3 !== c3 || c4 !== c4) v = worst(v, PARTIAL)
  return set(out, down(Math.min(c1, c2, c3, c4), LIB), up(Math.max(c1, c2, c3, c4), LIB), v)
}

function withVerdict(out: Iv, v: Verdict): Iv {
  out.v = worst(out.v, v)
  return out
}
