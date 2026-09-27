// Symbolic differentiation on the Expr tree (K3). Returns an Expr, unsimplified;
// consumers compile simplify(diff(...)). Space never finite-differences a
// formula it has (SP2).
//
// User functions go through the chain rule:
//   d/dv f(a1, ..., an) = sum_i (df/dp_i)(a1, ..., an) * d(a_i)/dv + (df/dv)(a1, ..., an)
// Each partial is taken of f's body with its parameters renamed to fresh
// names no author can write, while f is on the cycle stack; the arguments are
// substituted afterwards and differentiated with f OFF the stack, so a
// composition (f(f(x)), or f(g(x)) where g calls f) is not mistaken for a
// cycle. The last term differentiates the body's own reads of v: v is a
// parameter when a caller differentiates with respect to one. A constant
// differentiates as its body does, for the same reason (k = 2a, dk/da = 2).
// A body's free names are the spec's parameters and constants, read in the
// caller's context after substitution, so a caller that binds a variable with
// the same name as one of those must rename its own bound variables first
// (renameVars); space's kernel does, for every statement it differentiates.
//
// Non-smooth built-ins differentiate almost everywhere: abs gives sign;
// floor, ceil, round and sign give 0; mod(a, b) = a - b floor(a/b) gives
// a' - b' floor(a/b). min and max select by sign. x^y takes the power rule
// when y is constant in v (so x^2 at 0 never meets ln 0), the exponential
// rule when x is, and the general rule otherwise. Under @angle: degrees, trig
// derivatives carry pi/180 and inverse-trig ones 180/pi.

import type { Expr } from '../parser/types'
import { builtinArity, CompileError, freeVariablesDeep } from './compile'
import { add, call, div, mul, neg, num, pow, sub, substitute, variable } from './expr'
import { isVectorBody, type MathFunction, type MathScope } from './scope'
import { simplify } from './simplify'

const ZERO = num(0)
const ONE = num(1)
const TWO = num(2)

// d(angle in the spec's unit)/d(radians) factors.
const PI_OVER_180 = div(variable('pi'), num(180))
const OVER_PI_180 = div(num(180), variable('pi'))

// The functions and constants being differentiated, outermost first (cycle
// detection).
interface Ctx {
  stack: string[]
}

export function diff(expr: Expr, v: string, scope: MathScope): Expr {
  return differentiate(expr, v, scope, { stack: [] })
}

// Names the cycle and its path, as compile.ts's cycleError does.
function cycle(ctx: Ctx, name: string): CompileError {
  const loop = ctx.stack.slice(ctx.stack.indexOf(name))
  const names = [...new Set(loop)]
  const path = [...loop, name].join(' → ')
  const message =
    names.length === 1
      ? `"${name}" is defined in terms of itself (${path})`
      : `${names.map((n) => `"${n}"`).join(' and ')} are defined in terms of each other (${path})`
  return new CompileError(message, names)
}

// Each user function's partials with respect to its own parameters, over
// canonical fresh names ("#f.x"; "#" never reaches an Expr from text, and a
// function cannot appear inside its own partial without a cycle), simplified,
// and computed once per scope: a nested definition is differentiated once per
// (function, parameter), not once per call site.
const PARTIALS = new WeakMap<MathScope, Map<string, Expr[]>>()

function partialsOf(name: string, fn: MathFunction, fresh: readonly string[], scope: MathScope, ctx: Ctx): Expr[] {
  let cache = PARTIALS.get(scope)
  if (!cache) {
    cache = new Map()
    PARTIALS.set(scope, cache)
  }
  const known = cache.get(name)
  if (known) return known
  const body = substitute(fn.body as Expr, new Map(fn.params.map((param, i) => [param, variable(fresh[i])])))
  ctx.stack.push(name)
  const partials = fresh.map((p) => simplify(differentiate(body, p, scope, ctx)))
  ctx.stack.pop()
  cache.set(name, partials)
  return partials
}

// The simplified partial derivatives of `expr`, in the order of `vars`.
export function gradient(expr: Expr, vars: readonly string[], scope: MathScope): Expr[] {
  return vars.map((v) => simplify(diff(expr, v, scope)))
}

function dependsOn(expr: Expr, v: string, scope: MathScope): boolean {
  return freeVariablesDeep(expr, scope).has(v)
}

function differentiate(expr: Expr, v: string, scope: MathScope, ctx: Ctx): Expr {
  const d = (e: Expr) => differentiate(e, v, scope, ctx)
  switch (expr.kind) {
    case 'num':
      return ZERO
    case 'var': {
      if (expr.name === v) return ONE
      // A constant differentiates as its body does (it may read parameters);
      // a parameter other than v is constant, and so is any other name.
      const fn = scope.functions.get(expr.name)
      if (!fn || fn.params.length > 0 || scope.params.index.has(expr.name)) return ZERO
      if (isVectorBody(fn.body)) throw new CompileError(`"${expr.name}" is vector-valued and cannot be used as a number`, [expr.name])
      if (ctx.stack.includes(expr.name)) throw cycle(ctx, expr.name)
      ctx.stack.push(expr.name)
      const result = d(fn.body)
      ctx.stack.pop()
      return result
    }
    case 'unary':
      return neg(d(expr.arg))
    case 'binary': {
      const { left: u, right: w } = expr
      switch (expr.op) {
        case '+':
          return add(d(u), d(w))
        case '-':
          return sub(d(u), d(w))
        case '*':
          return add(mul(d(u), w), mul(u, d(w)))
        case '/':
          return div(sub(mul(d(u), w), mul(u, d(w))), pow(w, TWO))
        case '^': {
          // Power rule: w u^(w-1) u'.
          if (!dependsOn(w, v, scope)) return mul(mul(w, pow(u, sub(w, ONE))), d(u))
          // Exponential rule: u^w ln(u) w'.
          if (!dependsOn(u, v, scope)) return mul(mul(expr, call('ln', u)), d(w))
          // General: u^w (w' ln u + w u'/u).
          return mul(expr, add(mul(d(w), call('ln', u)), div(mul(w, d(u)), u)))
        }
      }
      break
    }
    case 'call':
      return differentiateCall(expr, v, scope, ctx)
  }
  throw new Error('Unreachable expression kind')
}

function differentiateCall(expr: Expr & { kind: 'call' }, v: string, scope: MathScope, ctx: Ctx): Expr {
  const { name, args } = expr
  const fn = scope.functions.get(name)
  if (fn) {
    if (isVectorBody(fn.body)) throw new CompileError(`"${name}" is vector-valued and cannot be used as a number`, [name])
    if (args.length !== fn.params.length) {
      throw new CompileError(`"${name}" takes ${fn.params.length} argument${fn.params.length === 1 ? '' : 's'}, got ${args.length}`, [name])
    }
    if (ctx.stack.includes(name)) throw cycle(ctx, name)
    const fresh = fn.params.map((param) => `#${name}.${param}`)
    const partials = partialsOf(name, fn, fresh, scope, ctx)
    // Back to the arguments; their derivatives are taken outside f.
    const back = new Map(fresh.map((p, i) => [p, args[i]]))
    let result: Expr = ZERO
    // The body's own reads of v (v a parameter or constant it reads), only
    // when it has any.
    if (freeVariablesDeep(fn.body, scope, new Set(fn.params)).has(v)) {
      const body = substitute(fn.body, new Map(fn.params.map((param, i) => [param, variable(fresh[i])])))
      ctx.stack.push(name)
      const own = simplify(differentiate(body, v, scope, ctx))
      ctx.stack.pop()
      result = substitute(own, back)
    }
    partials.forEach((partial, i) => {
      if (partial.kind === 'num' && partial.value === 0) return
      result = add(result, mul(substitute(partial, back), differentiate(args[i], v, scope, ctx)))
    })
    return result
  }

  const arity = builtinArity(name)
  if (!arity) throw new CompileError(`Unknown function "${name}"`, [name])
  if (args.length < arity.min || args.length > arity.max) {
    throw new CompileError(`"${name}" takes ${arity.min === arity.max ? arity.min : `${arity.min} or more`} arguments, got ${args.length}`, [name])
  }

  const d = (e: Expr) => differentiate(e, v, scope, ctx)
  const degrees = scope.angle === 'degrees'
  // Trig: f'(a) a', times pi/180 when a is in degrees.
  const trig = (outer: Expr) => (degrees ? mul(mul(outer, d(args[0])), PI_OVER_180) : mul(outer, d(args[0])))
  // Inverse trig: the result is in degrees, so times 180/pi.
  const inverse = (inner: Expr) => (degrees ? mul(inner, OVER_PI_180) : inner)
  const [a, b] = args

  switch (name) {
    case 'sin':
      return trig(call('cos', a))
    case 'cos':
      return trig(neg(call('sin', a)))
    case 'tan':
      return trig(pow(call('sec', a), TWO))
    case 'sec':
      return trig(mul(call('sec', a), call('tan', a)))
    case 'csc':
      return trig(neg(mul(call('csc', a), call('cot', a))))
    case 'cot':
      return trig(neg(pow(call('csc', a), TWO)))
    case 'asin':
      return inverse(div(d(a), call('sqrt', sub(ONE, pow(a, TWO)))))
    case 'acos':
      return inverse(neg(div(d(a), call('sqrt', sub(ONE, pow(a, TWO))))))
    case 'atan':
      return inverse(div(d(a), add(ONE, pow(a, TWO))))
    case 'atan2':
      // atan2(y, x): (x y' - y x') / (x^2 + y^2)
      return inverse(div(sub(mul(b, d(a)), mul(a, d(b))), add(pow(b, TWO), pow(a, TWO))))
    case 'sinh':
      return mul(call('cosh', a), d(a))
    case 'cosh':
      return mul(call('sinh', a), d(a))
    case 'tanh':
      return mul(sub(ONE, pow(call('tanh', a), TWO)), d(a))
    case 'asinh':
      return div(d(a), call('sqrt', add(pow(a, TWO), ONE)))
    case 'acosh':
      return div(d(a), call('sqrt', sub(pow(a, TWO), ONE)))
    case 'atanh':
      return div(d(a), sub(ONE, pow(a, TWO)))
    case 'sqrt':
      return div(d(a), mul(TWO, call('sqrt', a)))
    case 'abs':
      return mul(call('sign', a), d(a))
    case 'exp':
      return mul(call('exp', a), d(a))
    case 'ln':
      return div(d(a), a)
    case 'log':
      // log(a) = ln a / ln 10; log(a, b) = ln a / ln b.
      return d(div(call('ln', a), call('ln', b ?? num(10))))
    case 'floor':
    case 'ceil':
    case 'round':
    case 'sign':
      return ZERO
    case 'mod':
      // mod(a, b) = a - b floor(a/b), and floor' = 0.
      return sub(d(a), mul(d(b), call('floor', div(a, b))))
    case 'min':
    case 'max': {
      // min(a, b) = (a + b)/2 - |a - b|/2 and max(a, b) = (a + b)/2 + |a - b|/2,
      // so the derivative selects by sign(a - b). More than two fold left.
      const first = args.length === 2 ? args[0] : call(name, ...args.slice(0, -1))
      const last = args[args.length - 1]
      const mean = div(add(d(first), d(last)), TWO)
      const half = div(mul(call('sign', sub(first, last)), sub(d(first), d(last))), TWO)
      return name === 'min' ? sub(mean, half) : add(mean, half)
    }
    case 'hypot': {
      // d sqrt(sum a_i^2) = sum a_i a_i' / hypot(...)
      let sum: Expr = mul(args[0], d(args[0]))
      for (let i = 1; i < args.length; i++) sum = add(sum, mul(args[i], d(args[i])))
      return div(sum, expr)
    }
  }
  throw new CompileError(`No derivative rule for "${name}"`, [name])
}
