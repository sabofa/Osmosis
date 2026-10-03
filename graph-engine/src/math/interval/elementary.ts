// Interval twins of the kernel's elementary built-ins (calc P1b). Each encloses
// exactly what math/compile.ts's BUILTINS compute at every point of the box,
// including degrees (trig scales its argument by pi/180 first, inverse trig and
// atan2 scale their result by 180/pi) and including the values JavaScript gives
// at the edges: sin(inf) is NaN, ln(0) is -inf, atan2(+-0, -1) is +-pi.
//
// The contract (global-constraints.md): a finite scalar value lies inside the
// bounds; a NaN needs a PARTIAL or UNKNOWN verdict; an infinity needs the bound on
// its side to be that infinity whatever the verdict, because the next twin may
// map it back to a finite value (1 / inf is 0, e^-inf is 0). A box end that is a
// zero is that signed zero; a zero strictly inside may be either sign.
//
// Library-function bounds are widened outward by LIB (4 ulps), IEEE ones by ULP2.
// Three things are not widened, each because widening would only cost the next
// twin something and the value is exact:
//   - a zero image (sin(+-0), ln(1), acos(1)): it is the zero the library returns,
//     with its sign, and a bound pushed to -5e-324 would take sqrt of it out of its
//     domain and 1 / it out of its sign (1 / +0 and 1 / -0 differ);
//   - abs, which is exact;
//   - a bound at the function's own floor or ceiling (|sin| <= 1, exp >= 0,
//     cosh >= 1), which the library never crosses.
//
// A bound that is exactly a zero claims that signed zero and no other: the next twin
// reads the sign (div, sqrt, atan2 all tell +0 from -0), so a twin emits one only when
// it is so. sin(+-0), sqrt(+-0), ln(1) and acos(1) are; a box with 0 strictly inside
// holds both zeros (sqrt's clipped floor is -5e-324, not 0); and whatever can underflow
// to a zero, x · pi/180 and atan2, is widened like any other bound (-5e-324 · c is -0
// inside a box whose zero end is +0).
//
// Nothing here allocates per call: no closures, arrays or fresh Ivs. A twin that
// needs a temporary keeps module-level scratch of its own, so no twin's scratch is
// live in another's frame (twins call helpers, never each other). Every twin reads
// all of its inputs before it writes `out`, so `out` may alias an input.

import { DEFINED, down, isEmpty, type Iv, iv, LIB, PARTIAL, set, setEmpty, setUnknown, ULP2, up, type Verdict, worst } from './core'
import { div } from './arith'

// The uniform shape of a twin: it writes the answer into `out` and reads `args` (one
// box per argument of the built-in; log takes one or two). `angle` is read only by the
// trig, inverse trig and atan2 twins.
export type Twin = (out: Iv, args: readonly Iv[], angle: 'radians' | 'degrees') => void

const DEG = Math.PI / 180
const TO_DEG = 180 / Math.PI
const TWO_PI = 2 * Math.PI
const HALF_PI = Math.PI / 2
// Past this magnitude the k-of-the-period arithmetic below is not trusted (the
// position of a peak is only known to a few ulps of the argument): the twin answers
// the function's whole range.
const LARGE = 2 ** 20

const ONE = iv(1, 1)

// A bound `x` of a library function's image, widened outward; a zero stays the
// zero it is (see the header).
function lowOf(x: number, rel: number = LIB): number {
  return x === 0 ? x : down(x, rel)
}

function highOf(x: number, rel: number = LIB): number {
  return x === 0 ? x : up(x, rel)
}

// ---------------------------------------------------------------------------
// Angles
// ---------------------------------------------------------------------------

// into = a · pi/180: an IEEE product at each end, so the scalar's own x * DEG lies
// between them (rounding is monotone), widened by ULP2 all the same. A zero end stays
// the exact signed zero it is (±0 · c is ±0, no rounding) only when the rest of the
// box lies on its own side: x · c underflows to a zero with the sign of x (5e-324 · c
// is +0, -5e-324 · c is -0), so a box that reaches past its zero end the other way
// holds the other zero too, and a bound that is exactly one zero would deny it.
function toRadians(into: Iv, a: Iv): Iv {
  if (isEmpty(a)) return setEmpty(into)
  const lo = a.lo
  const hi = a.hi
  const exactLo = lo === 0 && (1 / lo > 0 || hi === 0)
  const exactHi = hi === 0 && (1 / hi < 0 || lo === 0)
  return set(into, exactLo ? lo * DEG : down(lo * DEG, ULP2), exactHi ? hi * DEG : up(hi * DEG, ULP2), a.v)
}

// The argument in radians: the input itself, or input · pi/180 under degrees.
function angleArg(a: Iv, angle: 'radians' | 'degrees', into: Iv): Iv {
  return angle === 'degrees' ? toRadians(into, a) : a
}

// out · 180/pi in place, for the inverse trig twins. An empty out stays empty.
function toDegrees(out: Iv, angle: 'radians' | 'degrees'): void {
  if (angle !== 'degrees') return
  out.lo = lowOf(out.lo * TO_DEG, ULP2)
  out.hi = highOf(out.hi * TO_DEG, ULP2)
}

// Whether some phase + k·period lies in [lo, hi]. Generous: a near miss counts,
// which only widens the answer, never narrows it. (The computed position of the
// peak is off by a few ulps of the argument, at most 2e-10 even at the edge of
// LARGE; the slack is 1e-9 of the period and of the argument.)
function hits(lo: number, hi: number, phase: number, period: number): boolean {
  const k = Math.ceil((lo - phase) / period - 1e-9)
  return phase + k * period <= hi + 1e-9 * Math.max(1, Math.abs(hi))
}

// ---------------------------------------------------------------------------
// sin, cos, tan on an argument in radians
// ---------------------------------------------------------------------------

// sin(+-inf) is NaN, so a box with an infinite end is partial: its finite part is
// still bounded by the range. Beyond LARGE, or over a whole period, the range.
function sinRad(out: Iv, a: Iv): Iv {
  if (isEmpty(a)) return setEmpty(out)
  const lo = a.lo
  const hi = a.hi
  const infinite = lo === -Infinity || hi === Infinity
  const v: Verdict = infinite ? worst(a.v, PARTIAL) : a.v
  if (infinite || !(hi - lo < TWO_PI) || Math.abs(lo) > LARGE || Math.abs(hi) > LARGE) return set(out, -1, 1, v)
  const x = Math.sin(lo)
  const y = Math.sin(hi)
  const l = hits(lo, hi, -HALF_PI, TWO_PI) ? -1 : Math.max(-1, lowOf(Math.min(x, y)))
  const h = hits(lo, hi, HALF_PI, TWO_PI) ? 1 : Math.min(1, highOf(Math.max(x, y)))
  return set(out, l, h, v)
}

function cosRad(out: Iv, a: Iv): Iv {
  if (isEmpty(a)) return setEmpty(out)
  const lo = a.lo
  const hi = a.hi
  const infinite = lo === -Infinity || hi === Infinity
  const v: Verdict = infinite ? worst(a.v, PARTIAL) : a.v
  if (infinite || !(hi - lo < TWO_PI) || Math.abs(lo) > LARGE || Math.abs(hi) > LARGE) return set(out, -1, 1, v)
  const x = Math.cos(lo)
  const y = Math.cos(hi)
  const l = hits(lo, hi, Math.PI, TWO_PI) ? -1 : Math.max(-1, lowOf(Math.min(x, y)))
  const h = hits(lo, hi, 0, TWO_PI) ? 1 : Math.min(1, highOf(Math.max(x, y)))
  return set(out, l, h, v)
}

// tan is increasing between its poles. A box that holds a pole (or is too wide, too
// large or infinite to say) is the whole line, partial; the double nearest pi/2 is
// a pole too (Math.tan gives 1.6e16 there, a finite value the whole line holds).
function tanRad(out: Iv, a: Iv): Iv {
  if (isEmpty(a)) return setEmpty(out)
  const lo = a.lo
  const hi = a.hi
  if (lo === -Infinity || hi === Infinity || !(hi - lo < Math.PI) || Math.abs(lo) > LARGE || Math.abs(hi) > LARGE || hits(lo, hi, HALF_PI, Math.PI)) {
    return set(out, -Infinity, Infinity, worst(a.v, PARTIAL))
  }
  return set(out, lowOf(Math.tan(lo)), highOf(Math.tan(hi)), a.v)
}

const SIN_R = iv()
const COS_R = iv()
const TAN_R = iv()
const SEC_R = iv()
const SEC_C = iv()
const CSC_R = iv()
const CSC_S = iv()
const COT_R = iv()
const COT_C = iv()
const COT_S = iv()

export const sinT: Twin = (out, args, angle) => void sinRad(out, angleArg(args[0], angle, SIN_R))
export const cosT: Twin = (out, args, angle) => void cosRad(out, angleArg(args[0], angle, COS_R))
export const tanT: Twin = (out, args, angle) => void tanRad(out, angleArg(args[0], angle, TAN_R))
// sec = 1/cos and csc = 1/sin, as the scalar computes them: partial exactly where
// the divisor reaches zero, and div keeps the scalar's infinity at a zero end.
export const secT: Twin = (out, args, angle) => void div(out, ONE, cosRad(SEC_C, angleArg(args[0], angle, SEC_R)))
export const cscT: Twin = (out, args, angle) => void div(out, ONE, sinRad(CSC_S, angleArg(args[0], angle, CSC_R)))
// cot is partial only at multiples of pi, not at tan's poles (it is 0 there). Between
// two multiples of pi it decreases, so a box with none in it is bounded by the scalar's
// own 1/tan at its ends (which tan's poles do not interrupt: 1/tan is 6e-17 at the
// double nearest pi/2 and -1.6e-16 at the next, still decreasing). A box that holds
// one (or is infinite or too large to say) is the quotient cos/sin, whose divisor
// reaches zero: div holds the scalar's infinity there, with its sign.
export const cotT: Twin = (out, args, angle) => {
  const r = angleArg(args[0], angle, COT_R)
  if (!isEmpty(r) && Math.abs(r.lo) <= LARGE && Math.abs(r.hi) <= LARGE && !hits(r.lo, r.hi, 0, Math.PI)) {
    set(out, lowOf(1 / Math.tan(r.hi)), highOf(1 / Math.tan(r.lo)), r.v)
    return
  }
  cosRad(COT_C, r)
  sinRad(COT_S, r)
  div(out, COT_C, COT_S)
}

// ---------------------------------------------------------------------------
// Inverse trig
// ---------------------------------------------------------------------------

// asin and acos are defined on [-1, 1]: a box wholly outside is empty (NaN
// everywhere), one partly outside is partial and clipped.
export const asinT: Twin = (out, args, angle) => {
  const a = args[0]
  if (isEmpty(a) || a.hi < -1 || a.lo > 1) {
    setEmpty(out)
    return
  }
  const v: Verdict = a.lo < -1 || a.hi > 1 ? worst(a.v, PARTIAL) : a.v
  set(out, lowOf(Math.asin(Math.max(a.lo, -1))), highOf(Math.asin(Math.min(a.hi, 1))), v)
  toDegrees(out, angle)
}

export const acosT: Twin = (out, args, angle) => {
  const a = args[0]
  if (isEmpty(a) || a.hi < -1 || a.lo > 1) {
    setEmpty(out)
    return
  }
  const v: Verdict = a.lo < -1 || a.hi > 1 ? worst(a.v, PARTIAL) : a.v
  set(out, lowOf(Math.acos(Math.min(a.hi, 1))), highOf(Math.acos(Math.max(a.lo, -1))), v)
  toDegrees(out, angle)
}

export const atanT: Twin = (out, args, angle) => {
  const a = args[0]
  if (isEmpty(a)) {
    setEmpty(out)
    return
  }
  set(out, lowOf(Math.atan(a.lo)), highOf(Math.atan(a.hi)), a.v)
  toDegrees(out, angle)
}

// atan2(y, x) is a value everywhere (JavaScript gives one at the origin and across
// the axes), but it jumps: by 2 pi across the negative x-axis, and at the origin
// the limit does not exist. So the verdict is CONTINUOUS only on a box that holds
// neither, and a box whose y end is +0 (or -0) lies on one side of the cut: the
// scalar there is the limit from that side (atan2(+0, -1) is +pi, atan2(-0, -1) is
// -pi).
//
// The bound: the level sets of the angle are rays from the origin, so on each piece
// of the box that lies in a closed half-plane of y its extremes are at the corners.
// The pieces are cut at y = 0, and the corners are the ends of y and the zero each
// side of the cut reaches: both zeros when 0 is strictly inside, and for a +0 (or
// -0) end the limit from the other side, which is no scalar value there but a limit
// the values approach, so it is taken as the double nearest 0 on that side.
const MIN = Number.MIN_VALUE

export const atan2T: Twin = (out, args, angle) => {
  const y = args[0]
  const x = args[1]
  if (isEmpty(y) || isEmpty(x)) {
    setEmpty(out)
    return
  }
  const yl = y.lo
  const yh = y.hi
  const xl = x.lo
  const xh = x.hi
  const v = worst(y.v, x.v)
  let ya = yl
  let yb = yl
  if (yl < 0 && yh > 0) {
    ya = 0
    yb = -0
  } else if (yl < 0 && yh === 0 && 1 / yh > 0) {
    ya = -MIN
  } else if (yh > 0 && yl === 0 && 1 / yl < 0) {
    ya = MIN
  }
  const lo = Math.min(
    Math.atan2(yl, xl), Math.atan2(yl, xh), Math.atan2(yh, xl), Math.atan2(yh, xh),
    Math.atan2(ya, xl), Math.atan2(ya, xh), Math.atan2(yb, xl), Math.atan2(yb, xh)
  )
  const hi = Math.max(
    Math.atan2(yl, xl), Math.atan2(yl, xh), Math.atan2(yh, xl), Math.atan2(yh, xh),
    Math.atan2(ya, xl), Math.atan2(ya, xh), Math.atan2(yb, xl), Math.atan2(yb, xh)
  )
  const crossesZero = yl <= 0 && yh >= 0
  let jumps = crossesZero && xl <= 0 && xh >= 0
  if (!jumps && crossesZero && xl < 0) {
    // the cut: some y on each side of the x-axis, a zero counting for its own sign
    const above = yh > 0 || (yh === 0 && 1 / yh > 0) || (yl === 0 && 1 / yl > 0)
    const below = yl < 0 || (yl === 0 && 1 / yl < 0) || (yh === 0 && 1 / yh < 0)
    jumps = above && below
  }
  // Widened even where a bound is a zero: atan2 underflows (atan2(-5e-324, 2) is -0), so
  // a zero bound here would claim one sign of zero for a box that holds both.
  set(out, Math.max(-Math.PI, down(lo, LIB)), Math.min(Math.PI, up(hi, LIB)), jumps ? worst(v, DEFINED) : v)
  toDegrees(out, angle)
}

// ---------------------------------------------------------------------------
// Hyperbolic, exp, ln, log, roots
// ---------------------------------------------------------------------------

export const sinhT: Twin = (out, args) => {
  const a = args[0]
  if (isEmpty(a)) setEmpty(out)
  else set(out, lowOf(Math.sinh(a.lo)), highOf(Math.sinh(a.hi)), a.v)
}

// |tanh| <= 1: the library never crosses it, so neither does the bound (which keeps
// atanh(tanh(x)) in the domain it can be in).
export const tanhT: Twin = (out, args) => {
  const a = args[0]
  if (isEmpty(a)) setEmpty(out)
  else set(out, Math.max(-1, lowOf(Math.tanh(a.lo))), Math.min(1, highOf(Math.tanh(a.hi))), a.v)
}

export const asinhT: Twin = (out, args) => {
  const a = args[0]
  if (isEmpty(a)) setEmpty(out)
  else set(out, lowOf(Math.asinh(a.lo)), highOf(Math.asinh(a.hi)), a.v)
}

// cosh is even and increasing in |x|: the nearest end to zero gives the floor (1 when
// the box holds zero), the farthest the ceiling. Overflow keeps the verdict.
export const coshT: Twin = (out, args) => {
  const a = args[0]
  if (isEmpty(a)) {
    setEmpty(out)
    return
  }
  const near = a.lo >= 0 ? a.lo : a.hi <= 0 ? -a.hi : 0
  const far = Math.max(-a.lo, a.hi)
  set(out, Math.max(1, lowOf(Math.cosh(near))), highOf(Math.cosh(far)), a.v)
}

// acosh is defined on [1, inf); acosh(1) = 0.
export const acoshT: Twin = (out, args) => {
  const a = args[0]
  if (isEmpty(a) || a.hi < 1) {
    setEmpty(out)
    return
  }
  set(out, lowOf(Math.acosh(Math.max(a.lo, 1))), highOf(Math.acosh(a.hi)), a.lo < 1 ? worst(a.v, PARTIAL) : a.v)
}

// atanh is defined on (-1, 1) and is infinite at +-1, which JavaScript gives: those
// ends are poles (partial), and the bound there is the infinity itself.
export const atanhT: Twin = (out, args) => {
  const a = args[0]
  if (isEmpty(a) || a.hi < -1 || a.lo > 1) {
    setEmpty(out)
    return
  }
  const v: Verdict = a.lo <= -1 || a.hi >= 1 ? worst(a.v, PARTIAL) : a.v
  set(out, lowOf(Math.atanh(Math.max(a.lo, -1))), highOf(Math.atanh(Math.min(a.hi, 1))), v)
}

export const cbrtT: Twin = (out, args) => {
  const a = args[0]
  if (isEmpty(a)) setEmpty(out)
  else set(out, lowOf(Math.cbrt(a.lo)), highOf(Math.cbrt(a.hi)), a.v)
}

// exp > 0 always, and the library never goes below 0: the floor is exact. Overflow
// to inf keeps the verdict (PARTIAL means a NaN or a pole).
export const expT: Twin = (out, args) => {
  const a = args[0]
  if (isEmpty(a)) setEmpty(out)
  else set(out, Math.max(0, down(Math.exp(a.lo), LIB)), up(Math.exp(a.hi), LIB), a.v)
}

// sqrt of the box a, with verdict v (a's, or weaker). Below 0 is NaN: a box wholly
// below 0 is empty, one reaching below it is clipped and partial. sqrt(+-0) is +-0, so
// what the clipped floor must hold depends on the zeros the box holds (a zero end is
// that signed zero, a zero strictly inside is both): a box that ends at a zero holds
// that one, so the answer is that zero; a box with 0 strictly inside holds both, and
// a bound that is exactly -0 or +0 would claim one of them, so the floor is the
// double just below 0 and both lie inside. IEEE sqrt: ULP2.
function sqrtOf(out: Iv, a: Iv, v: Verdict): Iv {
  const lo = a.lo
  const hi = a.hi
  if (hi < 0) return setEmpty(out)
  if (lo >= 0) return set(out, lowOf(Math.sqrt(lo), ULP2), highOf(Math.sqrt(hi), ULP2), v)
  if (hi === 0) return set(out, Math.sqrt(hi), Math.sqrt(hi), worst(v, PARTIAL))
  return set(out, -Number.MIN_VALUE, highOf(Math.sqrt(hi), ULP2), worst(v, PARTIAL))
}

export const sqrtT: Twin = (out, args) => {
  const a = args[0]
  if (isEmpty(a)) setEmpty(out)
  else sqrtOf(out, a, a.v)
}

// Math.abs is exact: the bounds are exact too.
export const absT: Twin = (out, args) => {
  const a = args[0]
  if (isEmpty(a)) setEmpty(out)
  else if (a.lo >= 0) set(out, Math.abs(a.lo), Math.abs(a.hi), a.v)
  else if (a.hi <= 0) set(out, Math.abs(a.hi), Math.abs(a.lo), a.v)
  else set(out, 0, Math.max(-a.lo, a.hi), a.v)
}

// ln and log10. ln(+-0) is -inf, a pole: a box reaching 0 is partial with -inf below
// (and a box that only reaches 0 from below is [-inf, -inf], not empty, because the
// scalar gives -inf there: Math.log(+-0) is the upper bound's own value); a box wholly
// below 0 is NaN everywhere, empty. (Written twice, not once over a function argument:
// a double passed to a helper that is not inlined is boxed, an allocation per call.)
function lnOf(out: Iv, a: Iv): Iv {
  if (isEmpty(a) || a.hi < 0) return setEmpty(out)
  if (a.lo <= 0) return set(out, -Infinity, highOf(Math.log(a.hi)), worst(a.v, PARTIAL))
  return set(out, lowOf(Math.log(a.lo)), highOf(Math.log(a.hi)), a.v)
}

function log10Of(out: Iv, a: Iv): Iv {
  if (isEmpty(a) || a.hi < 0) return setEmpty(out)
  if (a.lo <= 0) return set(out, -Infinity, highOf(Math.log10(a.hi)), worst(a.v, PARTIAL))
  return set(out, lowOf(Math.log10(a.lo)), highOf(Math.log10(a.hi)), a.v)
}

const LOG_A = iv()
const LOG_B = iv()

export const lnT: Twin = (out, args) => void lnOf(out, args[0])

// log(a) is base 10; log(a, b) is ln a / ln b, the scalar's own formula (so ln b = 0
// at b = 1 is a division by zero, and div holds the infinity it gives).
export const logT: Twin = (out, args) => {
  if (args.length < 2) {
    log10Of(out, args[0])
    return
  }
  lnOf(LOG_A, args[0])
  lnOf(LOG_B, args[1])
  div(out, LOG_A, LOG_B)
}

// root(n, x) as math/special.ts computes it, branch for branch: n must be a whole
// nonzero number (else NaN); a negative n is 1 / root(-n, x); n = 1 is x, 2 is
// Math.sqrt, 3 is Math.cbrt; otherwise Math.pow(x, 1/n), an even root of a negative
// number being NaN and an odd one -pow(-x, 1/n).

// The odd root for n >= 5, as special.ts: increasing through 0.
function oddRoot(x: number, m: number): number {
  return x < 0 ? -Math.pow(-x, 1 / m) : Math.pow(x, 1 / m)
}

// The even root for n >= 4 over the box a: NaN below 0 (clipped, partial), and
// Math.pow(+-0, 1/n) is +0 either way, so a zero floor is +0 whichever zeros the box holds.
function evenRoot(out: Iv, a: Iv, m: number, v: Verdict): Iv {
  const lo = a.lo
  const hi = a.hi
  if (hi < 0) return setEmpty(out)
  const e = 1 / m
  const clipped = lo < 0
  return set(out, lowOf(Math.pow(clipped ? 0 : lo, e)), highOf(Math.pow(hi, e)), clipped ? worst(v, PARTIAL) : v)
}

export const rootT: Twin = (out, args) => {
  const n = args[0]
  const x = args[1]
  if (isEmpty(n) || isEmpty(x)) {
    setEmpty(out)
    return
  }
  if (n.lo !== n.hi) {
    // a box of indices: no whole number in it is NaN everywhere; otherwise one
    // value per whole n, and no cheap enclosure
    if (Math.ceil(n.lo) > n.hi) setEmpty(out)
    else setUnknown(out)
    return
  }
  const k = n.lo
  if (k === 0 || !Number.isInteger(k)) {
    setEmpty(out)
    return
  }
  const v = worst(x.v, n.v)
  const m = Math.abs(k)
  if (m === 1) set(out, x.lo, x.hi, v)
  else if (m === 2) sqrtOf(out, x, v)
  else if (m === 3) set(out, lowOf(Math.cbrt(x.lo)), highOf(Math.cbrt(x.hi)), v)
  else if (m % 2 === 1) set(out, lowOf(oddRoot(x.lo, m)), highOf(oddRoot(x.hi, m)), v)
  else evenRoot(out, x, m, v)
  if (k < 0) div(out, ONE, out)
}
