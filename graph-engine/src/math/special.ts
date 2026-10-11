// Special functions for the kernel (calc P1): gamma, erf, erfc and the
// combinatorial and integer functions. Pure and deterministic. Each method
// says how accurate it is and why (measured against CPython's math module).

import { gcdInt } from './rational'

// Lanczos coefficients, g = 7, n = 9 (the widely published set).
const LANCZOS_G = 7
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
]
const SQRT_2PI = Math.sqrt(2 * Math.PI)
// Γ passes the largest double at 171.6243…; above this nothing finite remains.
// Past ~739 the Lanczos power overflows while e^-t underflows, and Infinity
// times 0 would be NaN, so the answer is given here instead.
const GAMMA_OVERFLOW = 171.7

// Γ(x). Exact products at positive integers (so gamma(5) is 24, not
// 23.999…); poles (NaN) at 0 and the negative integers; reflection below 1/2;
// Lanczos elsewhere, with the power split in two so Γ(170.5) does not
// overflow on the way to a finite answer. Relative error is ~1e-15 below 5,
// ~1e-14 by 60 and ~1e-13 near 170 (the error of x^t grows with x), and the
// reflection loses a few more digits next to a pole. Far below zero the
// reflection underflows to a signed zero (Γ alternates in sign between poles).
export function gamma(x: number): number {
  if (Number.isNaN(x) || x === -Infinity) return Number.NaN
  if (x === Infinity) return Infinity
  if (Number.isInteger(x)) {
    if (x <= 0) return Number.NaN
    if (x > 171) return Infinity
    let r = 1
    for (let k = 2; k < x; k++) r *= k
    return r
  }
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x))
  if (x > GAMMA_OVERFLOW) return Infinity
  const z = x - 1
  let a = LANCZOS[0]
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i] / (z + i)
  const t = z + LANCZOS_G + 0.5
  const half = Math.pow(t, (z + 0.5) / 2)
  return SQRT_2PI * half * (half * Math.exp(-t)) * a
}

// x! = Γ(x + 1): exact at whole numbers, NaN at the negative integers.
export function factorial(x: number): number {
  return gamma(x + 1)
}

const TWO_OVER_SQRT_PI = 2 / Math.sqrt(Math.PI)
const ERF_SWITCH = 2.5

// erf by the all-positive series erf(x) = (2/√π) e^(-x²) Σ 2^n x^(2n+1) /
// (1·3·…·(2n+1)) (no cancellation) below 2.5; above, 1 − erfc by the
// continued fraction. ~1e-15 relative everywhere; ±1 at ±∞.
export function erf(x: number): number {
  if (Number.isNaN(x)) return Number.NaN
  if (x < 0) return -erf(-x)
  if (x === Infinity) return 1
  if (x < ERF_SWITCH) return erfSeries(x)
  return 1 - erfcFraction(x)
}

// 1 − erf(x) below 2.5, so ~1e-12 relative just under it (erfc(2.5) is 4e-4
// and the subtraction costs 1/erfc(x) in relative terms); from 2.5 up the
// fraction has no subtraction and holds ~5e-14 down to the underflow at 27.
export function erfc(x: number): number {
  if (Number.isNaN(x)) return Number.NaN
  if (x === Infinity) return 0
  if (x < ERF_SWITCH) return 1 - erf(x)
  return erfcFraction(x)
}

function erfSeries(x: number): number {
  const x2 = x * x
  let term = x
  let sum = x
  for (let n = 1; n < 200; n++) {
    term *= (2 * x2) / (2 * n + 1)
    sum += term
    if (term < sum * 1e-17) break
  }
  return TWO_OVER_SQRT_PI * Math.exp(-x2) * sum
}

// erfc(x) = e^(-x²) / (√π · (x + (1/2)/(x + (2/2)/(x + (3/2)/(x + …))))),
// evaluated by modified Lentz; converges quickly for x ≥ 2.5.
function erfcFraction(x: number): number {
  const tiny = 1e-300
  let f = x
  let c = x
  let d = 0
  for (let n = 1; n < 500; n++) {
    const a = n / 2
    d = x + a * d
    d = d === 0 ? 1 / tiny : 1 / d
    c = x + a / c
    if (c === 0) c = tiny
    const delta = c * d
    f *= delta
    if (Math.abs(delta - 1) < 1e-16) break
  }
  return Math.exp(-x * x) / (Math.sqrt(Math.PI) * f)
}

// C(n, k). Exact on integers with n ≥ 0 whenever the result is below 2^53: each
// partial product is itself a binomial coefficient, and the step divides the
// common factor out of r and i before multiplying, so no intermediate is ever
// larger than the next partial product. 0 outside 0 ≤ k ≤ n; through Γ
// otherwise. The partial products at least double each step, so the loop is
// over within 1024 steps however large n is: once one overflows, the answer is
// Infinity.
export function choose(n: number, k: number): number {
  if (Number.isNaN(n) || Number.isNaN(k)) return Number.NaN
  if (Number.isInteger(n) && Number.isInteger(k) && n >= 0) {
    if (k < 0 || k > n) return 0
    const m = Math.min(k, n - k)
    let r = 1
    for (let i = 1; i <= m; i++) {
      // i divides r (n - m + i); with g = gcd(r, i), i / g is coprime to r / g,
      // so it divides n - m + i.
      const g = gcdInt(r, i)
      r = (r / g) * ((n - m + i) / (i / g))
      if (r === Infinity) return r
    }
    return r
  }
  return gamma(n + 1) / (gamma(k + 1) * gamma(n - k + 1))
}

// P(n, k) = n! / (n − k)!. Exact on integers with n ≥ 0 while the result is
// below 2^53 (and right to rounding beyond, n ≥ 2^53 included: the loop counts
// factors, it does not step a variable through n, which stops advancing there);
// 0 outside the range. Stops at the first overflow, as choose does.
export function perm(n: number, k: number): number {
  if (Number.isNaN(n) || Number.isNaN(k)) return Number.NaN
  if (Number.isInteger(n) && Number.isInteger(k) && n >= 0) {
    if (k < 0 || k > n) return 0
    let r = 1
    for (let j = 0; j < k; j++) {
      r *= n - j
      if (r === Infinity) return r
    }
    return r
  }
  return gamma(n + 1) / gamma(n - k + 1)
}

export function gcd(a: number, b: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b)) return Number.NaN
  return gcdInt(a, b)
}

export function lcm(a: number, b: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b)) return Number.NaN
  if (a === 0 || b === 0) return 0
  return Math.abs((a / gcdInt(a, b)) * b)
}

// The n-th root of x, for a nonzero whole n: real below zero when n is odd,
// NaN there when n is even; 1/root(−n, x) for negative n.
export function root(n: number, x: number): number {
  if (!Number.isInteger(n) || n === 0 || Number.isNaN(x)) return Number.NaN
  if (n < 0) return 1 / root(-n, x)
  if (n === 1) return x
  if (n === 2) return Math.sqrt(x)
  if (n === 3) return Math.cbrt(x)
  if (x < 0) return n % 2 === 1 ? -Math.pow(-x, 1 / n) : Number.NaN
  return Math.pow(x, 1 / n)
}

// The Heaviside step, step(0) = 1.
export function step(x: number): number {
  if (Number.isNaN(x)) return Number.NaN
  return x >= 0 ? 1 : 0
}
