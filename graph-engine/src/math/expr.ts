// Small structural helpers on the shared Expr tree. Pure.

import type { Expr } from '../parser/types'

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
  switch (expr.kind) {
    case 'num':
      return expr
    case 'var':
      return map.get(expr.name) ?? expr
    case 'unary':
      return { kind: 'unary', op: '-', arg: substitute(expr.arg, map) }
    case 'binary':
      return { kind: 'binary', op: expr.op, left: substitute(expr.left, map), right: substitute(expr.right, map) }
    case 'call': {
      // __prime(f, k, …): f names a function, never a variable.
      if (expr.name === '__prime') return { kind: 'call', name: expr.name, args: expr.args.map((a, i) => (i === 0 ? a : substitute(a, map))) }
      const first = expr.args[0]
      if (BINDER_NAMES.has(expr.name) && first?.kind === 'var' && expr.args.length === 4) {
        // The bounds are outside the binding; the body is inside it.
        let name = first.name
        let body = expr.args[3]
        const inner = new Map(map)
        inner.delete(name)
        // A replacement that mentions the bound name would be captured: rename
        // the binder first.
        const mentions = [...inner.values()].some((e) => varNames(e).has(name))
        if (mentions) {
          const taken = new Set<string>([...varNames(body), ...inner.keys(), ...[...inner.values()].flatMap((e) => [...varNames(e)])])
          const fresh = freshName(name, taken)
          body = substitute(body, new Map([[name, { kind: 'var', name: fresh }]]))
          name = fresh
        }
        return { kind: 'call', name: expr.name, args: [{ kind: 'var', name }, substitute(expr.args[1], map), substitute(expr.args[2], map), substitute(body, inner)] }
      }
      return { kind: 'call', name: expr.name, args: expr.args.map((a) => substitute(a, map)) }
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
