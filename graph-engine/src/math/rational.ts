// Exact rationals read structurally from integer literals (calc P1, spec "The
// kernel": real odd roots). A literal exponent p/q in lowest terms with q odd
// takes the real root, so x^(1/3) is defined for x < 0. The rule is read from
// the expression's SHAPE — integer literals combined by + - * / and integer
// powers — and never inferred from a float: x^0.333 and x^0.5 stay principal
// (agreed with space, 2026-10-01).

import type { Expr } from '../parser/types'

export interface Rational {
  // In lowest terms, q > 0, both safe integers.
  readonly p: number
  readonly q: number
}

export function gcdInt(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b !== 0) {
    const t = a % b
    a = b
    b = t
  }
  return a
}

function make(p: number, q: number): Rational | null {
  if (q === 0 || !Number.isSafeInteger(p) || !Number.isSafeInteger(q)) return null
  if (q < 0) {
    p = -p
    q = -q
  }
  const g = gcdInt(p, q) || 1
  // + 0 turns a -0 numerator into 0.
  return { p: p / g + 0, q: q / g }
}

// The largest integer power folded exactly; beyond it the subtree is not read.
const MAX_POWER = 64

function power(base: Rational, n: number): Rational | null {
  if (n < 0) {
    if (base.p === 0) return null
    const inverse = make(base.q, base.p)
    return inverse && power(inverse, -n)
  }
  let p = 1
  let q = 1
  for (let i = 0; i < n; i++) {
    p *= base.p
    q *= base.q
    if (!Number.isSafeInteger(p) || !Number.isSafeInteger(q)) return null
  }
  return make(p, q)
}

// The exact rational an integer-literal subtree denotes, or null when the
// subtree reads a name, calls a function, holds a non-integer literal,
// divides by zero, or leaves the safe-integer range on the way.
export function rationalLiteral(expr: Expr): Rational | null {
  switch (expr.kind) {
    case 'num':
      return Number.isSafeInteger(expr.value) ? make(expr.value, 1) : null
    case 'unary': {
      const a = rationalLiteral(expr.arg)
      return a ? make(-a.p, a.q) : null
    }
    case 'binary': {
      const a = rationalLiteral(expr.left)
      if (!a) return null
      if (expr.op === '^') {
        const n = rationalLiteral(expr.right)
        if (!n || n.q !== 1 || Math.abs(n.p) > MAX_POWER) return null
        return power(a, n.p)
      }
      const b = rationalLiteral(expr.right)
      if (!b) return null
      switch (expr.op) {
        case '+':
          return make(a.p * b.q + b.p * a.q, a.q * b.q)
        case '-':
          return make(a.p * b.q - b.p * a.q, a.q * b.q)
        case '*':
          return make(a.p * b.p, a.q * b.q)
        case '/':
          return make(a.p * b.q, a.q * b.p)
      }
      return null
    }
    default:
      return null
  }
}

// The exponent's rational when it calls for a real root: lowest terms with an
// odd denominator above 1. An integer exponent needs no rule (Math.pow already
// takes a negative base to an integer power); an even denominator is the
// principal root, undefined below zero.
export function oddRootExponent(expr: Expr): Rational | null {
  const r = rationalLiteral(expr)
  return r && r.q > 1 && r.q % 2 === 1 ? r : null
}

// x^e where e is a literal p/q with q odd, evaluated at run time exactly as
// the plain Math.pow path evaluates it — so a non-negative base gives, bit for
// bit, what it always did. A negative base takes the real root: -|x|^e when p
// is odd, |x|^e when p is even.
export function realOddPow(x: number, e: number, pOdd: boolean): number {
  if (x < 0) {
    const m = Math.pow(-x, e)
    return pOdd ? -m : m
  }
  return Math.pow(x, e)
}
