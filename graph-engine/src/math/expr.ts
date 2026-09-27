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

// Replaces every `var` node whose name is in `map` (an Expr has no binders, so
// every var node is free). Call names are never replaced.
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
    case 'call':
      return { kind: 'call', name: expr.name, args: expr.args.map((a) => substitute(a, map)) }
  }
}

// Renames variables: a convenience over substitute.
export function renameVars(expr: Expr, names: ReadonlyMap<string, string>): Expr {
  const map = new Map<string, Expr>()
  for (const [from, to] of names) map.set(from, variable(to))
  return substitute(expr, map)
}

// The names of every `var` node, call arguments included, call names not.
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
    case 'call':
      for (const a of expr.args) varNames(a, into)
      break
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
