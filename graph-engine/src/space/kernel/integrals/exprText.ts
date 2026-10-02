// An expression written back as text, for a refusal that names a bound
// ("the bound sqrt(x - 0.5) is not a number at x = 0.4"). Parentheses only
// where precedence needs them; + and - spaced, * / ^ tight, as authors write.
//
// Calc's constructs ride on reserved calls (math/reserved.ts, whose shapes are
// stable because this prints them by name) and are written the way they read:
//
//   __lt __le __gt __ge __eq __ne     a < b, a ≤ b, a > b, a ≥ b, a = b, a ≠ b
//   __and __or __not                  a and b, a or b, not a
//   __piecewise(c1, v1, …[, o])       {c1: v1, …, o}
//   __factorial(a)                    a!, and (a)! unless a is an atom
//   __prime(f, k, a, …)               f'(a), with k primes
//   __sum(k, lo, hi, body)            Σ_{k=lo}^{hi} body
//   __prod(k, lo, hi, body)           Π_{k=lo}^{hi} body
//   __integral(t, lo, hi, body)       ∫_{lo}^{hi} body dt
//   abs(a)                            |a|
//
// A call of a reserved name with a shape it was never built with (the names are
// typeable) is written as the call it is.

import type { Expr } from '../../../parser/types'
import { comparisonOp, type ComparisonOp } from '../../../math/reserved'

// How tightly a construct binds, loosest first. A node is parenthesised when it
// binds looser than the place that holds it.
const OR = 1
const AND = 2
const NOT = 3
const COMPARE = 4
// What a comparison's two sides are printed at: above a comparison, so a
// comparison, and, or or not on a side is parenthesised, below the arithmetic,
// so a sum or a negative number on a side is not.
const SIDE = 5
const SUM = 6
const PRODUCT = 7
const POWER = 8
// "a!" binds tighter than ^ and unary minus (parser/parseExpr.ts).
const POSTFIX = 9
// The operand of a "!": anything but an atom is parenthesised.
const ATOM = 10

const PRECEDENCE: Record<'+' | '-' | '*' | '/' | '^', number> = { '+': SUM, '-': SUM, '*': PRODUCT, '/': PRODUCT, '^': POWER }

const GLYPH: Record<ComparisonOp, string> = { '<': '<', '<=': '≤', '>': '>', '>=': '≥', '=': '=', '!=': '≠' }

const BINDER_GLYPH: Record<string, string> = { __sum: 'Σ', __prod: 'Π' }

function generic(expr: Expr & { kind: 'call' }): string {
  return `${expr.name}(${expr.args.map((a) => exprText(a)).join(', ')})`
}

// The reserved calls and abs by name, or null when `expr` is not one of them or
// has a shape they are never built with.
function namedText(expr: Expr & { kind: 'call' }, parent: number): string | null {
  const { name, args } = expr
  const wrap = (text: string, level: number) => (level < parent ? `(${text})` : text)

  const op = comparisonOp(name)
  if (op) {
    if (args.length !== 2) return null
    return wrap(`${exprText(args[0], SIDE)} ${GLYPH[op]} ${exprText(args[1], SIDE)}`, COMPARE)
  }

  switch (name) {
    case '__and':
    case '__or': {
      if (args.length !== 2) return null
      const level = name === '__and' ? AND : OR
      // Left-associative: a right operand of the same level is parenthesised.
      return wrap(`${exprText(args[0], level)} ${name === '__and' ? 'and' : 'or'} ${exprText(args[1], level + 1)}`, level)
    }
    case '__not':
      if (args.length !== 1) return null
      return wrap(`not ${exprText(args[0], NOT)}`, NOT)
    case '__piecewise': {
      if (args.length < 2) return null
      const pieces: string[] = []
      for (let i = 0; i + 1 < args.length; i += 2) pieces.push(`${exprText(args[i])}: ${exprText(args[i + 1])}`)
      if (args.length % 2 === 1) pieces.push(exprText(args[args.length - 1]))
      return `{${pieces.join(', ')}}`
    }
    case '__factorial':
      if (args.length !== 1) return null
      return wrap(`${exprText(args[0], ATOM)}!`, POSTFIX)
    case '__prime': {
      const [fn, order, ...at] = args
      if (fn?.kind !== 'var' || order?.kind !== 'num' || !Number.isInteger(order.value) || order.value < 1 || at.length === 0) return null
      return `${fn.name}${"'".repeat(order.value)}(${at.map((a) => exprText(a)).join(', ')})`
    }
    case '__sum':
    case '__prod': {
      if (args.length !== 4 || args[0].kind !== 'var') return null
      // The body runs to the end of the term: a sum or difference in it is
      // parenthesised, a product is not (Σ k*x is Σ (k*x)). The whole is
      // parenthesised inside anything, so nothing can read into its body.
      const text = `${BINDER_GLYPH[name]}_{${args[0].name}=${exprText(args[1])}}^{${exprText(args[2])}} ${exprText(args[3], PRODUCT)}`
      return wrap(text, 0)
    }
    case '__integral': {
      if (args.length !== 4 || args[0].kind !== 'var') return null
      return wrap(`∫_{${exprText(args[1])}}^{${exprText(args[2])}} ${exprText(args[3])} d${args[0].name}`, 0)
    }
    case 'abs':
      if (args.length !== 1) return null
      return `|${exprText(args[0])}|`
  }
  return null
}

export function exprText(expr: Expr, parent = 0, rightOperand = false): string {
  switch (expr.kind) {
    case 'num':
      return expr.value < 0 && parent >= SUM ? `(${expr.value})` : String(expr.value)
    case 'var':
      return expr.name
    case 'unary': {
      const text = `-${exprText(expr.arg, POSTFIX)}`
      return parent > SUM || (parent === SUM && rightOperand) ? `(${text})` : text
    }
    case 'binary': {
      const p = PRECEDENCE[expr.op]
      // ^ groups to the right; the others to the left.
      const left = exprText(expr.left, expr.op === '^' ? p + 1 : p, false)
      const right = exprText(expr.right, expr.op === '^' ? p : p + (expr.op === '-' || expr.op === '/' ? 1 : 0), true)
      const text = p === SUM ? `${left} ${expr.op} ${right}` : `${left}${expr.op}${right}`
      return p < parent ? `(${text})` : text
    }
    case 'call':
      return namedText(expr, parent) ?? generic(expr)
  }
}
