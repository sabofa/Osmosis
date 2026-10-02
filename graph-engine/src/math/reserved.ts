// The reserved call names (calc P1). New expression constructs are encoded as
// calls with these names, so the Expr union in parser/types.ts never changes
// and every engine that switches on Expr.kind compiles untouched (agreed with
// space, 2026-10-01). The shapes are STABLE — space prints them by name in its
// readouts — so change one only together with space.
//
//   __lt(a, b) __le __gt __ge __eq __ne   1 when the comparison holds, 0 when
//                                          not, NaN when either side is NaN
//   __and(a, b) __or(a, b) __not(a)       on truth values: nonzero is true;
//                                          NaN in, NaN out
//   __piecewise(c1, v1, …, cn, vn[, o])   the value of the first piece whose
//                                          condition is true; a NaN condition
//                                          met on the way makes the value NaN;
//                                          with no piece true, o, or NaN if
//                                          there is no o
//   __factorial(a)                        a! = gamma(a + 1)
//   __prime(f, k, a1, …, an)              the k-th derivative of user function
//                                          f (a var node naming it) at a1…an;
//                                          k a whole literal
//   __sum(k, lo, hi, body)                Σ body for k = lo…hi, k a var node
//   __prod(k, lo, hi, body)               Π body; bound inside body only
//   __integral(t, lo, hi, body)           ∫ body dt from lo to hi (t bound)

import type { Expr } from '../parser/types'
import { call, num, variable } from './expr'

export type ComparisonOp = '<' | '<=' | '>' | '>=' | '=' | '!='

export const COMPARISON_NAMES: Readonly<Record<ComparisonOp, string>> = {
  '<': '__lt',
  '<=': '__le',
  '>': '__gt',
  '>=': '__ge',
  '=': '__eq',
  '!=': '__ne',
}

const COMPARISON_OPS: ReadonlyMap<string, ComparisonOp> = new Map(Object.entries(COMPARISON_NAMES).map(([op, name]) => [name, op as ComparisonOp]))

export const BINDERS: ReadonlySet<string> = new Set(['__sum', '__prod', '__integral'])

const RESERVED: ReadonlySet<string> = new Set([
  ...Object.values(COMPARISON_NAMES),
  '__and',
  '__or',
  '__not',
  '__piecewise',
  '__factorial',
  '__prime',
  ...BINDERS,
])

export const MAX_PRIME_ORDER = 5
export const MAX_TERMS = 100_000

export function isReserved(name: string): boolean {
  return RESERVED.has(name)
}

export function comparisonOp(name: string): ComparisonOp | null {
  return COMPARISON_OPS.get(name) ?? null
}

// --- constructors (the parser builds these; nothing else should hand-roll them)

export function compare(op: ComparisonOp, a: Expr, b: Expr): Expr {
  return call(COMPARISON_NAMES[op], a, b)
}

export const and = (a: Expr, b: Expr): Expr => call('__and', a, b)
export const or = (a: Expr, b: Expr): Expr => call('__or', a, b)
export const not = (a: Expr): Expr => call('__not', a)

export function piecewise(pieces: readonly (readonly [Expr, Expr])[], otherwise: Expr | null): Expr {
  const args: Expr[] = []
  for (const [condition, value] of pieces) args.push(condition, value)
  if (otherwise) args.push(otherwise)
  return call('__piecewise', ...args)
}

export const factorialOf = (a: Expr): Expr => call('__factorial', a)

export function prime(fn: string, order: number, args: readonly Expr[]): Expr {
  return call('__prime', variable(fn), num(order), ...args)
}

export function sum(k: string, lo: Expr, hi: Expr, body: Expr): Expr {
  return call('__sum', variable(k), lo, hi, body)
}

export function prod(k: string, lo: Expr, hi: Expr, body: Expr): Expr {
  return call('__prod', variable(k), lo, hi, body)
}

export function integral(t: string, lo: Expr, hi: Expr, body: Expr): Expr {
  return call('__integral', variable(t), lo, hi, body)
}

// --- values (shared by both compile paths so they agree exactly)

export function compareValue(op: ComparisonOp, a: number, b: number): number {
  if (a !== a || b !== b) return Number.NaN
  switch (op) {
    case '<':
      return a < b ? 1 : 0
    case '<=':
      return a <= b ? 1 : 0
    case '>':
      return a > b ? 1 : 0
    case '>=':
      return a >= b ? 1 : 0
    case '=':
      return a === b ? 1 : 0
    case '!=':
      return a !== b ? 1 : 0
  }
}

export function andValue(a: number, b: number): number {
  return a !== a || b !== b ? Number.NaN : a !== 0 && b !== 0 ? 1 : 0
}

export function orValue(a: number, b: number): number {
  return a !== a || b !== b ? Number.NaN : a !== 0 || b !== 0 ? 1 : 0
}

export function notValue(a: number): number {
  return a !== a ? Number.NaN : a !== 0 ? 0 : 1
}

// One step of __piecewise from the back: the condition c's value, its piece's
// value v, and what follows. Evaluated eagerly by compileMany and lazily by
// the closures; both give the same number because nothing has a side effect.
export function pick(c: number, v: number, rest: number): number {
  return c !== c ? Number.NaN : c !== 0 ? v : rest
}

// The bound variable's name of a binder call, or of __prime's function: the
// first argument must be a var node.
export function nameArgument(expr: Expr & { kind: 'call' }, what: string): string {
  const first = expr.args[0]
  if (!first || first.kind !== 'var') throw new Error(`${expr.name}: the first argument must name the ${what}`)
  return first.name
}
