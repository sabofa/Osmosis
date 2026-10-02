// Decorated intervals for the kernel's interval twin (calc P1b; spec "The
// kernel": the interval twin). An Iv encloses every value the scalar compile
// can produce over an input box, and says one thing about the box:
//
//   CONTINUOUS (3)  defined and continuous on the whole box: the sampler may
//                   connect across it
//   DEFINED    (2)  defined everywhere on the box, but it may jump (floor,
//                   mod, step, piecewise seams)
//   PARTIAL    (1)  undefined somewhere inside (a NaN, a pole)
//   UNKNOWN    (0)  no cheap enclosure (integral); bounds are [-inf, inf]
//
// Verdicts combine by the weakest (the smaller number). An empty Iv (lo > hi)
// is "undefined everywhere on the box" and always carries PARTIAL.
//
// JavaScript has no directed rounding, so every bound is widened outward after
// it is computed: by 2 ulps for IEEE arithmetic (ULP2), 4 for a library function
// (LIB). The twin is robust rather than formally rigorous; the property tests
// hold every twin to soundness against the scalar compile.
//
// Nothing in this directory allocates per call: every function writes into an
// `out` the caller owns, and a twin that needs a temporary keeps a module-level
// scratch Iv of its own.

export const UNKNOWN = 0
export const PARTIAL = 1
export const DEFINED = 2
export const CONTINUOUS = 3
export type Verdict = 0 | 1 | 2 | 3

export interface Iv {
  lo: number
  hi: number
  v: Verdict
}

export function iv(lo = 0, hi = 0, v: Verdict = CONTINUOUS): Iv {
  return { lo, hi, v }
}

export function worst(a: Verdict, b: Verdict): Verdict {
  return a < b ? a : b
}

// 2^-51 and 2^-50: two and four ulps of any normal double, as a relative step.
export const ULP2 = 4.440892098500626e-16
export const LIB = 8.881784197001252e-16

export function down(x: number, rel: number = ULP2): number {
  if (x === Infinity || x === -Infinity) return x
  return x - (Math.abs(x) * rel + Number.MIN_VALUE)
}

export function up(x: number, rel: number = ULP2): number {
  if (x === Infinity || x === -Infinity) return x
  return x + (Math.abs(x) * rel + Number.MIN_VALUE)
}

// Writes [lo, hi] with verdict v. A NaN bound is no bound: -inf below, +inf
// above. (Two plain stores per bound, not `x ? -Infinity : lo`: V8 boxes the
// merged double of a ternary store into a fresh HeapNumber, an allocation per
// call once `set` is not inlined into its caller.)
export function set(out: Iv, lo: number, hi: number, v: Verdict): Iv {
  if (lo !== lo) out.lo = -Infinity
  else out.lo = lo
  if (hi !== hi) out.hi = Infinity
  else out.hi = hi
  out.v = v
  return out
}

export function setEmpty(out: Iv): Iv {
  out.lo = Infinity
  out.hi = -Infinity
  out.v = PARTIAL
  return out
}

export function setUnknown(out: Iv): Iv {
  out.lo = -Infinity
  out.hi = Infinity
  out.v = UNKNOWN
  return out
}

// The single value x: a NaN is empty, anything else is [x, x], continuous.
export function setPoint(out: Iv, x: number): Iv {
  if (Number.isNaN(x)) return setEmpty(out)
  out.lo = x
  out.hi = x
  out.v = CONTINUOUS
  return out
}

// An input box: empty when either end is NaN or lo > hi.
export function setBox(out: Iv, lo: number, hi: number): Iv {
  if (!(lo <= hi)) return setEmpty(out)
  out.lo = lo
  out.hi = hi
  out.v = CONTINUOUS
  return out
}

export function isEmpty(a: Iv): boolean {
  return !(a.lo <= a.hi)
}

export function copy(out: Iv, a: Iv): Iv {
  out.lo = a.lo
  out.hi = a.hi
  out.v = a.v
  return out
}

// Widens out to include a (a set union); the verdict is the weaker.
export function hull(out: Iv, a: Iv): Iv {
  if (isEmpty(a)) {
    out.v = worst(out.v, a.v)
    return out
  }
  if (isEmpty(out)) {
    const v = worst(out.v, a.v)
    copy(out, a)
    out.v = v
    return out
  }
  out.lo = Math.min(out.lo, a.lo)
  out.hi = Math.max(out.hi, a.hi)
  out.v = worst(out.v, a.v)
  return out
}
