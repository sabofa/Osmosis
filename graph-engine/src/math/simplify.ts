// A deterministic, structural simplifier (K3). It folds arithmetic on numeric
// literals, except a non-whole quotient of two integers, which stays a quotient
// (calc P1), and applies the 0/1 identities, bottom-up, so the output of diff
// stays small. It never factors, expands or reorders, and it never folds pi
// or e (they are variables, so a subtree holding one is not numeric) or a
// function call (trig depends on the angle unit, which is not known here).
//
// One bottom-up pass is a fixpoint: every rule builds its result through the
// same constructors, so simplify(simplify(e)) equals simplify(e).

import type { Expr } from '../parser/types'

function isNum(e: Expr, value?: number): e is Expr & { kind: 'num' } {
  return e.kind === 'num' && (value === undefined || e.value === value)
}

function negate(arg: Expr): Expr {
  if (isNum(arg)) return { kind: 'num', value: -arg.value }
  // -(-a) -> a
  if (arg.kind === 'unary') return arg.arg
  return { kind: 'unary', op: '-', arg }
}

function fold(op: '+' | '-' | '*' | '/' | '^', a: number, b: number): number {
  switch (op) {
    case '+':
      return a + b
    case '-':
      return a - b
    case '*':
      return a * b
    case '/':
      return a / b
    case '^':
      return Math.pow(a, b)
  }
}

function binary(op: '+' | '-' | '*' | '/' | '^', left: Expr, right: Expr): Expr {
  if (isNum(left) && isNum(right)) {
    // A non-whole quotient of two integers stays a quotient, so a literal
    // exponent such as 1/3 keeps its shape through diff and simplify and the
    // real-odd-root rule (math/rational.ts) still sees it. The value does not
    // change: the compiled 1/3 is the same IEEE division, done at run time.
    const keep = op === '/' && Number.isInteger(left.value) && Number.isInteger(right.value) && right.value !== 0 && !Number.isInteger(left.value / right.value)
    if (!keep) {
      const value = fold(op, left.value, right.value)
      // A non-finite result stays as written, so it fails where it is used.
      if (Number.isFinite(value)) return { kind: 'num', value }
    }
  }
  switch (op) {
    case '+':
      if (isNum(left, 0)) return right
      if (isNum(right, 0)) return left
      break
    case '-':
      if (isNum(right, 0)) return left
      if (isNum(left, 0)) return negate(right)
      break
    case '*':
      if (isNum(left, 0) || isNum(right, 0)) return { kind: 'num', value: 0 }
      if (isNum(left, 1)) return right
      if (isNum(right, 1)) return left
      break
    case '/':
      if (isNum(right, 1)) return left
      break
    case '^':
      if (isNum(right, 1)) return left
      if (isNum(right, 0)) return { kind: 'num', value: 1 }
      break
  }
  return { kind: 'binary', op, left, right }
}

export function simplify(expr: Expr): Expr {
  switch (expr.kind) {
    case 'num':
    case 'var':
      return expr
    case 'unary':
      return negate(simplify(expr.arg))
    case 'binary':
      return binary(expr.op, simplify(expr.left), simplify(expr.right))
    case 'call':
      return { kind: 'call', name: expr.name, args: expr.args.map(simplify) }
  }
}
