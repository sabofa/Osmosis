// Interval twins of gamma, erf, erfc and the integer functions (calc P1b), each enclosing
// what math/special.ts computes at every point of the box, including the values it gives at
// the edges: gamma is NaN at 0 and the negative integers and at -inf, +inf at +inf and past
// 171.62; erf(+-inf) is +-1; choose, perm, gcd and lcm are NaN on non-integers (gcd, lcm).
//
// What each twin must hold is the SCALAR's values, not the true function's, so a bound is
// taken from the scalar at the ends of a box and widened by what the scalar itself does not
// keep monotone. Measured against the scalar (scratch scans of consecutive doubles, windows of
// 4000, strides up to 1031, thousands of windows): gamma is non-monotone by at most 1.3e-14
// relative (at the whole numbers, where the exact product meets the Lanczos neighbours), erf
// and the 1 - erf branch of erfc by 1.8e-15 absolute (about 8 ulp of 1, the rounding of
// exp(-x^2) and of the series), and erfc's continued-fraction branch by 1.8e-15 relative.
// (The scalar's error against the true function is larger, 1e-13 near 170, but that is not
// what a box of the scalar's values needs.) The widenings below are 7x, 4.5x and 4.5x those.
//
// The twins keep their scratch at module level and allocate no object, array or closure per
// call. A call of the scalar gamma, erf or erfc is not inlined into them, and V8 returns a
// double from a JS function boxed (one heap number per scalar call; erfc's own `1 - erf(x)`
// and gamma's recursion box more inside the scalar), which these twins cannot avoid.

import { choose, erf, erfc, gamma, gcd, lcm, perm } from '../special'
import { div, mul, sub } from './arith'
import { down, isEmpty, type Iv, iv, PARTIAL, set, setEmpty, UNKNOWN, up, type Verdict, worst } from './core'
import { sinT, type Twin } from './elementary'

// ---------------------------------------------------------------------------
// gamma
// ---------------------------------------------------------------------------

// The global constraint's relative 1e-13 (7x the 1.3e-14 the scalar needs, measured above).
const G_REL = 1e-13
// On (0, inf) gamma falls to its minimum at X0 = 1.4616321449683622, where it is GMIN, and
// rises from there; both are the doubles nearest the true values.
const X0 = 1.4616321449683622
const GMIN = 0.8856031944108887
const PI_IV = iv(Math.PI, Math.PI)
const ONE = iv(1, 1)

// Scratch, one set for gammaOf (it is the only user; sinT's own scratch is for degrees only,
// and gammaOf calls it in radians).
const G_ARG = iv()
const G_SIN = iv()
const G_OM = iv()
const G_POS = iv()
const G_PROD = iv()
const SIN_ARGS: readonly Iv[] = [G_ARG]

// gamma over a box a with 0 < a.lo, monotone below X0 and above it. Overflow (gamma is +inf
// past 171.62 and at +inf) keeps the verdict: PARTIAL means a NaN or a pole.
function gammaPositive(out: Iv, a: Iv): Iv {
  const lo = a.lo
  const hi = a.hi
  const glo = gamma(lo)
  const ghi = gamma(hi)
  let x: number
  let y: number
  if (lo <= X0 && X0 <= hi) {
    x = GMIN
    y = Math.max(glo, ghi)
  } else if (hi < X0) {
    x = ghi
    y = glo
  } else {
    x = glo
    y = ghi
  }
  return set(out, down(x, G_REL), up(y, G_REL), a.v)
}

// gamma(a) for the box a; `out` may alias a. Task 4's x! is gamma(x + 1) through this.
//
//   - a box of one pole (0 or a negative integer, or -inf) is NaN everywhere: empty.
//   - a box holding a pole or -inf is the whole line and partial: gamma is NaN at the pole and
//     huge of both signs around it (±inf beside 0). The one exception is a box starting at 0:
//     its values are those of (0, hi], positive, with +inf (gamma(5e-324) is +inf) as the top.
//   - a box above 0 is `gammaPositive`.
//   - strictly between two poles, below 0: Γ(x) = π / (sin(πx) Γ(1 - x)), the scalar's own
//     reflection, with the interval arithmetic. The scalar computes Math.PI * x, sin of that,
//     gamma(1 - x), their product and π over it, each a rounded operation; the twin encloses
//     each, so it holds the scalar's value whatever its error against the true Γ (which grows
//     to 1e-10 next to a pole). It is loose where sin and Γ(1 - x) both depend on x.
export function gammaOf(out: Iv, a: Iv): Iv {
  if (isEmpty(a)) return setEmpty(out)
  const lo = a.lo
  const hi = a.hi
  const v = a.v
  if (lo > 0) return gammaPositive(out, a)
  if (lo === hi && (lo === -Infinity || Number.isInteger(lo))) return setEmpty(out)
  if (lo === 0 && hi > 0) {
    set(G_POS, Number.MIN_VALUE, hi, worst(v, PARTIAL))
    return gammaPositive(out, G_POS)
  }
  // the first whole number at or above lo is at most 0 here; it is in the box when it is <= hi
  if (Math.ceil(lo) <= hi) return set(out, -Infinity, Infinity, worst(v, PARTIAL))
  mul(G_ARG, a, PI_IV)
  sinT(G_SIN, SIN_ARGS, 'radians')
  sub(G_OM, ONE, a)
  gammaPositive(G_POS, G_OM)
  mul(G_PROD, G_SIN, G_POS)
  div(out, PI_IV, G_PROD)
  return set(out, down(out.lo, G_REL), up(out.hi, G_REL), out.v)
}

export const gammaT: Twin = (out, args) => void gammaOf(out, args[0])

// ---------------------------------------------------------------------------
// erf and erfc
// ---------------------------------------------------------------------------

// erf is increasing, |erf| <= 1 and the library never crosses it, so a bound is clamped there
// (the clamp keeps atanh(erf(x)) in its domain where the scalar is); erf(+-0) is +-0 and a
// bound that is exactly a zero stays it (unwidened: it is exactly the scalar's value, and a
// positive x never gives a negative erf). The relative widening 8e-15 holds the scalar's own
// non-monotonicity, 1.8e-15 absolute near 1.
const SPECIAL_REL = 8e-15

export const erfT: Twin = (out, args) => {
  const a = args[0]
  if (isEmpty(a)) {
    setEmpty(out)
    return
  }
  let lo = erf(a.lo)
  let hi = erf(a.hi)
  if (lo !== 0) lo = down(lo, SPECIAL_REL)
  if (hi !== 0) hi = up(hi, SPECIAL_REL)
  set(out, Math.max(-1, lo), Math.min(1, hi), a.v)
}

// erfc is decreasing, in [0, 2]. Below ERF_SWITCH (the scalar's own constant in special.ts: a
// test guards it) the scalar is 1 - erf(x), whose values near 1 are off by an ABSOLUTE 1.8e-15,
// which is a large relative error where erfc is small (erfc(2.4) is 7e-4); from there up it
// is a continued fraction, relative 1.8e-15 and no better than that all the way down to its
// underflow at 27. A box that holds any x below the switch carries the absolute noise on both
// of its bounds (the interior points are the ones that stray); its lower bound is the lower of
// that branch's last value and, past the switch, the fraction branch's value at the high end.
// A box wholly above the switch is bounded by relative widening only, and erfc(x) is exactly
// +0 where it has underflowed (and at +inf): that zero stays, it is the scalar's own.
const ERF_SWITCH = 2.5
const BELOW_SWITCH = 2.4999999999999996
const ERFC_ABS = 8e-15

export const erfcT: Twin = (out, args) => {
  const a = args[0]
  if (isEmpty(a)) {
    setEmpty(out)
    return
  }
  const lo = a.lo
  const hi = a.hi
  let l: number
  let u: number
  if (lo < ERF_SWITCH) {
    u = erfc(lo)
    u = Math.min(2, up(u, SPECIAL_REL) + ERFC_ABS)
    let edge = hi
    if (hi >= ERF_SWITCH) edge = BELOW_SWITCH
    l = erfc(edge)
    l = down(l, SPECIAL_REL) - ERFC_ABS
    if (hi >= ERF_SWITCH) {
      let t = erfc(hi)
      if (t !== 0) t = down(t, SPECIAL_REL)
      l = Math.min(l, t)
    }
    if (l < 0) l = 0
  } else {
    u = erfc(lo)
    if (u !== 0) u = up(u, SPECIAL_REL)
    l = erfc(hi)
    if (l !== 0) l = Math.max(0, down(l, SPECIAL_REL))
  }
  set(out, l, u, a.v)
}

// ---------------------------------------------------------------------------
// choose, perm, gcd, lcm
// ---------------------------------------------------------------------------

// The integer functions on a single point are exact: the scalar at that point (a box [-0, +0]
// is the hull of the scalar at both zeros). On any wider box no cheap enclosure is attempted
// (UNKNOWN: [-inf, inf], and a NaN is admitted). A NaN at the point is empty. An overflow to
// infinity (choose(2000, 1000)) is not undefinedness: the verdict stays.
function pointsOnly(out: Iv, a: Iv, b: Iv, f: (n: number, k: number) => number): void {
  if (isEmpty(a) || isEmpty(b)) {
    setEmpty(out)
    return
  }
  const al = a.lo
  const ah = a.hi
  const bl = b.lo
  const bh = b.hi
  if (al !== ah || bl !== bh) {
    set(out, -Infinity, Infinity, UNKNOWN)
    return
  }
  const v: Verdict = worst(a.v, b.v)
  // lo === hi is a point unless it is [-0, +0], which holds both zeros: the scalar at each
  const aMixed = !Object.is(al, ah)
  const bMixed = !Object.is(bl, bh)
  let lo = Infinity
  let hi = -Infinity
  let nan = false
  for (let i = 0; i < 4; i++) {
    if ((i >= 2 && !aMixed) || (i % 2 === 1 && !bMixed)) continue
    const y = f(i < 2 ? al : ah, i % 2 === 0 ? bl : bh)
    if (y !== y) nan = true
    else {
      lo = Math.min(lo, y)
      hi = Math.max(hi, y)
    }
  }
  if (lo > hi) setEmpty(out)
  else set(out, lo, hi, nan ? worst(v, PARTIAL) : v)
}

export const chooseT: Twin = (out, args) => pointsOnly(out, args[0], args[1], choose)
export const permT: Twin = (out, args) => pointsOnly(out, args[0], args[1], perm)
export const gcdT: Twin = (out, args) => pointsOnly(out, args[0], args[1], gcd)
export const lcmT: Twin = (out, args) => pointsOnly(out, args[0], args[1], lcm)
