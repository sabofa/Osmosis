// f'(x), f''(x), … (calc P1): the k-th derivative of a one-variable user
// function, as an expression over the function's own parameter, computed once
// per (scope, function, order) by symbolic diff and simplify.

import type { Expr } from '../parser/types'
import { diff } from './diff'
import { CompileError } from './errors'
import { substitute } from './expr'
import { MAX_PRIME_ORDER, nameArgument } from './reserved'
import { isVectorBody, type MathFunction, type MathScope } from './scope'
import { simplify } from './simplify'

const CACHE = new WeakMap<MathScope, Map<string, Expr>>()
// The (function, order) pairs being computed, per scope: a function whose body
// uses its own derivative (f(t) = f'(t), or two that use each other's) would
// otherwise recurse here until the stack gave out.
const COMPUTING = new WeakMap<MathScope, Set<string>>()

// The highest order the kernel computes. Authors write at most
// MAX_PRIME_ORDER primes; diff of f^(k) may ask for one more.
const KERNEL_ORDER_LIMIT = MAX_PRIME_ORDER + 3

export function primeFunction(expr: Expr & { kind: 'call' }, scope: MathScope): { name: string; fn: MathFunction; order: number } {
  const name = nameArgument(expr, 'function')
  const orderArg = expr.args[1]
  if (!orderArg || orderArg.kind !== 'num' || !Number.isInteger(orderArg.value) || orderArg.value < 1 || orderArg.value > KERNEL_ORDER_LIMIT) {
    throw new CompileError(`"${name}" with that many primes is not supported`, [name])
  }
  const fn = scope.functions.get(name)
  if (!fn) throw new CompileError(`Unknown function "${name}"`, [name])
  if (isVectorBody(fn.body)) throw new CompileError(`"${name}" is vector-valued and cannot be used as a number`, [name])
  if (fn.params.length !== 1) {
    throw new CompileError(`"${name}${"'".repeat(orderArg.value)}" needs a function of one variable; "${name}" takes ${fn.params.length}`, [name])
  }
  if (expr.args.length !== 3) {
    throw new CompileError(`"${name}${"'".repeat(orderArg.value)}" takes 1 argument, got ${expr.args.length - 2}`, [name])
  }
  return { name, fn, order: orderArg.value }
}

export function derivativeBody(name: string, fn: MathFunction, order: number, scope: MathScope): Expr {
  let cache = CACHE.get(scope)
  if (!cache) {
    cache = new Map()
    CACHE.set(scope, cache)
  }
  const key = `${name}#${order}`
  const known = cache.get(key)
  if (known) return known
  let computing = COMPUTING.get(scope)
  if (!computing) {
    computing = new Set()
    COMPUTING.set(scope, computing)
  }
  if (computing.has(key)) throw new CompileError(`"${name}" is defined in terms of its own derivative`, [name])
  computing.add(key)
  try {
    const below = order === 1 ? (fn.body as Expr) : derivativeBody(name, fn, order - 1, scope)
    const result = simplify(diff(below, fn.params[0], scope))
    cache.set(key, result)
    return result
  } finally {
    computing.delete(key)
  }
}

// __prime(f, k, a) written out: f^(k)'s body with its parameter replaced by a.
export function expandPrime(expr: Expr & { kind: 'call' }, scope: MathScope): Expr {
  const { name, fn, order } = primeFunction(expr, scope)
  return substitute(derivativeBody(name, fn, order, scope), new Map([[fn.params[0], expr.args[2]]]))
}
