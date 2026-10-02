// Small structural helpers on the shared Expr tree. Pure.

import type { Expr } from '../parser/types'
import { applyOperator } from './rational'

export const num = (value: number): Expr => ({ kind: 'num', value })
export const variable = (name: string): Expr => ({ kind: 'var', name })
export const neg = (arg: Expr): Expr => ({ kind: 'unary', op: '-', arg })
export const add = (left: Expr, right: Expr): Expr => ({ kind: 'binary', op: '+', left, right })
export const sub = (left: Expr, right: Expr): Expr => ({ kind: 'binary', op: '-', left, right })
export const mul = (left: Expr, right: Expr): Expr => ({ kind: 'binary', op: '*', left, right })
export const div = (left: Expr, right: Expr): Expr => ({ kind: 'binary', op: '/', left, right })
export const pow = (left: Expr, right: Expr): Expr => ({ kind: 'binary', op: '^', left, right })
export const call = (name: string, ...args: Expr[]): Expr => ({ kind: 'call', name, args })

// The reserved binders (math/reserved.ts BINDERS, spelled here because
// reserved.ts imports this file).
const BINDER_NAMES: ReadonlySet<string> = new Set(['__sum', '__prod', '__integral'])

// A name not used in `taken`, derived from `base` deterministically. "#" never
// reaches an Expr from text, so no author can write it.
export function freshName(base: string, taken: ReadonlySet<string>): string {
  for (let i = 1; ; i++) {
    const candidate = `#${base}.${i}`
    if (!taken.has(candidate)) return candidate
  }
}

// Replaces every free `var` node whose name is in `map`. An Expr has no binders
// except the reserved __sum, __prod and __integral (math/reserved.ts), which bind
// their first argument in their body; substitution respects that and never
// captures. Call names are never replaced, nor is the function named by
// __prime's first argument, nor a binder's name argument (renamed, when a
// replacement would be captured by it, but never replaced).
export function substitute(expr: Expr, map: ReadonlyMap<string, Expr>): Expr {
  return subst(expr, map, null)
}

// substitute for an ARGUMENT going into a body that was written over a name for
// it: diff's chain rule (a call's argument for the fresh name of the parameter),
// f^(k)(a), and Leibniz's bound for the variable of integration. Compile reads
// such a name as a variable slot, never as the literal it will hold, so an
// exponent like a/3, a - 1 or 1/n is not a literal ratio there, whatever the call
// passes. Once the argument is written in, 1/3 would be one, and a derivative would
// take the real odd root where the function itself is NaN (the principal root of a
// negative number). So every subtree the replacement reaches that is then made of
// numbers alone is folded into its number, with the very IEEE operations the
// compiled code does (math/rational.ts applyOperator), which leaves the value
// alone: a literal argument goes in as the number it comes to, a/3 with a = 1 as
// 0.3333333333333333. What the replacement does not reach stays as it was, so a
// ratio the author wrote in the body (x^(1/3)) is still the real root.
export function substituteArguments(expr: Expr, map: ReadonlyMap<string, Expr>): Expr {
  return subst(expr, map, new WeakSet())
}

// A pure arithmetic tree's number (num, unary minus, + - * / ^ of those), computed
// as the compiled code computes it, or null when it reads a name or calls a
// function or the number is not finite.
function numericValue(expr: Expr): number | null {
  const value = evaluate(expr)
  return value !== null && Number.isFinite(value) ? value : null
}

function evaluate(expr: Expr): number | null {
  switch (expr.kind) {
    case 'num':
      return expr.value
    case 'unary': {
      const a = evaluate(expr.arg)
      return a === null ? null : -a
    }
    case 'binary': {
      const a = evaluate(expr.left)
      const b = a === null ? null : evaluate(expr.right)
      return a === null || b === null ? null : applyOperator(expr.op, a, b)
    }
    default:
      return null
  }
}

// `reached` (set by substituteArguments, null for a plain substitute) holds the
// nodes a replacement has reached: each replacement, and each node built over one.
function subst(expr: Expr, map: ReadonlyMap<string, Expr>, reached: WeakSet<object> | null): Expr {
  // The node a replacement reached, folded to its number when it is made of numbers.
  const reach = (node: Expr): Expr => {
    if (!reached) return node
    const value = numericValue(node)
    const result = value === null || node.kind === 'num' ? node : num(value)
    reached.add(result)
    return result
  }
  switch (expr.kind) {
    case 'num':
      return expr
    case 'var': {
      const replacement = map.get(expr.name)
      if (!replacement) return expr
      // A fresh object for a number, so a shared constant is not marked for good.
      return reached ? reach(replacement.kind === 'num' ? num(replacement.value) : replacement) : replacement
    }
    case 'unary': {
      const arg = subst(expr.arg, map, reached)
      const node: Expr = { kind: 'unary', op: '-', arg }
      return reached?.has(arg) ? reach(node) : node
    }
    case 'binary': {
      const left = subst(expr.left, map, reached)
      const right = subst(expr.right, map, reached)
      const node: Expr = { kind: 'binary', op: expr.op, left, right }
      return reached && (reached.has(left) || reached.has(right)) ? reach(node) : node
    }
    case 'call': {
      // __prime(f, k, …): f names a function, never a variable.
      if (expr.name === '__prime') return { kind: 'call', name: expr.name, args: expr.args.map((a, i) => (i === 0 ? a : subst(a, map, reached))) }
      const first = expr.args[0]
      if (BINDER_NAMES.has(expr.name) && first?.kind === 'var' && expr.args.length === 4) {
        // The bounds are outside the binding; the body is inside it.
        let name = first.name
        let body = expr.args[3]
        const inner = new Map(map)
        inner.delete(name)
        // A replacement for a name that is free in the body, and that mentions
        // the bound name, would be captured: rename the binder first. (A
        // replacement for a name the body never reads goes nowhere, so it
        // captures nothing and the binder keeps the name it was written with.)
        const free = varNames(body)
        const mentions = [...inner].some(([key, e]) => free.has(key) && varNames(e).has(name))
        if (mentions) {
          const taken = new Set<string>([...free, ...inner.keys(), ...[...inner.values()].flatMap((e) => [...varNames(e)])])
          const fresh = freshName(name, taken)
          body = substitute(body, new Map([[name, { kind: 'var', name: fresh }]]))
          name = fresh
        }
        return { kind: 'call', name: expr.name, args: [{ kind: 'var', name }, subst(expr.args[1], map, reached), subst(expr.args[2], map, reached), subst(body, inner, reached)] }
      }
      return { kind: 'call', name: expr.name, args: expr.args.map((a) => subst(a, map, reached)) }
    }
  }
}

// Renames variables: a convenience over substitute.
export function renameVars(expr: Expr, names: ReadonlyMap<string, string>): Expr {
  const map = new Map<string, Expr>()
  for (const [from, to] of names) map.set(from, variable(to))
  return substitute(expr, map)
}

// The names of every free `var` node, call arguments included, call names not
// (nor the function named by __prime's first argument); a binder's bound name
// is not free in its body.
export function varNames(expr: Expr, into: Set<string> = new Set()): Set<string> {
  switch (expr.kind) {
    case 'num':
      break
    case 'var':
      into.add(expr.name)
      break
    case 'unary':
      varNames(expr.arg, into)
      break
    case 'binary':
      varNames(expr.left, into)
      varNames(expr.right, into)
      break
    case 'call': {
      const first = expr.args[0]
      if (BINDER_NAMES.has(expr.name) && first?.kind === 'var' && expr.args.length === 4) {
        varNames(expr.args[1], into)
        varNames(expr.args[2], into)
        const inner = varNames(expr.args[3])
        inner.delete(first.name)
        for (const n of inner) into.add(n)
        break
      }
      for (const [i, a] of expr.args.entries()) if (!(expr.name === '__prime' && i === 0)) varNames(a, into)
      break
    }
  }
  return into
}

export function countNodes(expr: Expr): number {
  switch (expr.kind) {
    case 'num':
    case 'var':
      return 1
    case 'unary':
      return 1 + countNodes(expr.arg)
    case 'binary':
      return 1 + countNodes(expr.left) + countNodes(expr.right)
    case 'call':
      return expr.args.reduce((n, a) => n + countNodes(a), 1)
  }
}
