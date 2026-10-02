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
//
// step(a) gives (0/a) a': 0 wherever it has a derivative and NaN at its jump,
// unlike floor, ceil, round and sign, whose derivative is a plain 0. cbrt,
// root (for an index constant in v), erf and erfc have exact rules. gamma,
// choose and perm (they need digamma), gcd and lcm (whole numbers only) and
// root with an index that depends on v have none and are refused with a
// CompileError, but only when an argument depends on v: with constant
// arguments the derivative is 0 (x^2/gamma(3), a @param k in x^(k-1)/gamma(k)).
// Through a user function the refusal is kept per parameter and raised only
// for an argument that depends on v (the same test as for a built-in, however
// flat that argument's derivative is), so pdf(x, 3) and pdf(x, 1/k) with k a
// @param differentiate in x even though pdf is refused in its second parameter,
// and pdf(x, floor(x)) refuses, as gamma(floor(x)) does.
//
// The reserved constructs (math/reserved.ts): a comparison or logic call is a
// condition, constant between its jumps, so 0; __piecewise differentiates piece
// by piece under the same conditions; __prime(f, k, a) is f's k-th derivative
// written out (math/prime.ts) and differentiated further; __factorial refuses
// like gamma. A name called with one argument, x(x + 1), is a product when the
// name is the variable, a parameter, a constant, pi, e or inf.
//
// The binders: __sum differentiates term by term when its bounds do not depend on
// v (it refuses when they do); __integral by Leibniz's rule, the bounds' own
// motion plus the integral of the integrand's partial; __prod has no rule, so it
// refuses, but a product that does not read v is constant. As for gamma, a
// refusal is raised only when the call depends on v.

import type { Expr } from '../parser/types'
import { builtinArity, builtinShadowError, freeVariablesDeep, paramCallsAsProducts } from './compile'
import { CompileError } from './errors'
import { add, call, div, freshName, mul, neg, num, pow, sub, substitute, variable, varNames } from './expr'
import { expandPrime } from './prime'
import { comparisonOp, isReserved, nameArgument, piecewise } from './reserved'
import { isVectorBody, type MathFunction, type MathScope } from './scope'
import { simplify } from './simplify'

const ZERO = num(0)
const ONE = num(1)
const TWO = num(2)

// A derivative the kernel has no rule for. A subclass so that partialsOf can
// set a refused partial aside (it matters only if an argument depends on v)
// without also swallowing a cycle or an unknown name, which must still throw.
class DerivativeRefusal extends CompileError {}

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
//
// A partial the kernel refuses (gamma(k) in k, say) is kept as the refusal,
// and thrown by the caller only for an argument that depends on v.
const PARTIALS = new WeakMap<MathScope, Map<string, (Expr | DerivativeRefusal)[]>>()

// fn's body over the fresh names. A call with one argument by a parameter's name
// (a(a + 1)) is first written as the product it is inside the body, since
// substitute leaves call names alone and the call would later resolve to the
// document's value of that name.
export function freshBody(fn: MathFunction, fresh: readonly string[], scope: MathScope): Expr {
  const body = paramCallsAsProducts(fn.body as Expr, fn.params, scope)
  return substitute(body, new Map(fn.params.map((param, i) => [param, variable(fresh[i])])))
}

function partialsOf(name: string, fn: MathFunction, fresh: readonly string[], scope: MathScope, ctx: Ctx): (Expr | DerivativeRefusal)[] {
  let cache = PARTIALS.get(scope)
  if (!cache) {
    cache = new Map()
    PARTIALS.set(scope, cache)
  }
  const known = cache.get(name)
  if (known) return known
  const body = freshBody(fn, fresh, scope)
  ctx.stack.push(name)
  const depth = ctx.stack.length
  const partials = fresh.map((p) => {
    try {
      return simplify(differentiate(body, p, scope, ctx))
    } catch (err) {
      if (!(err instanceof DerivativeRefusal)) throw err
      // The throw skipped the pops of the calls it unwound through.
      ctx.stack.length = depth
      return err
    }
  })
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

// How many nodes diff has visited in this module's life: a deterministic
// measure of its work, for tests and profiling (wall time is not, under load).
let steps = 0

export function differentiationSteps(): number {
  return steps
}

function differentiate(expr: Expr, v: string, scope: MathScope, ctx: Ctx): Expr {
  steps++
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
  if (isReserved(name)) return differentiateReserved(expr, v, scope, ctx)
  const shadowed = builtinShadowError(name, scope)
  if (shadowed) throw shadowed
  const fn = scope.functions.get(name)
  // A constant called with one argument is a product, k(x + 1), as in compile.
  if (fn && !(fn.params.length === 0 && args.length === 1)) {
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
      const body = freshBody(fn, fresh, scope)
      ctx.stack.push(name)
      const own = simplify(differentiate(body, v, scope, ctx))
      ctx.stack.pop()
      result = substitute(own, back)
    }
    partials.forEach((partial, i) => {
      // Every argument is differentiated, so an error inside one (a cycle, an
      // unknown name) is reported even when f ignores it; only the term of a
      // zero partial is left out.
      const argument = differentiate(args[i], v, scope, ctx)
      if (partial instanceof DerivativeRefusal) {
        // Refused in this parameter: fine exactly when the argument does not
        // depend on v, as for a built-in (so f(x, floor(x)) refuses, as
        // gamma(floor(x)) does). Whether the argument's derivative simplifies
        // to a literal 0 is no test: 0 / u is kept, because step needs its NaN.
        if (!dependsOn(args[i], v, scope)) return
        throw partial
      }
      if (partial.kind === 'num' && partial.value === 0) return
      result = add(result, mul(substitute(partial, back), argument))
    })
    return result
  }

  const arity = builtinArity(name)
  if (!arity) {
    // name(arg) with name a value is a product, x(x + 1). Only a name diff can
    // see to be a value qualifies: the variable itself, a parameter, a constant
    // (the user-function branch above took every other user function), pi, e or
    // inf. Any other name stays an unknown function, as it always was.
    const isValue = name === v || scope.params.index.has(name) || fn !== undefined || name === 'pi' || name === 'e' || name === 'inf'
    if (args.length === 1 && isValue) return differentiate(mul(variable(name), args[0]), v, scope, ctx)
    throw new CompileError(`Unknown function "${name}"`, [name])
  }
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
    case 'cbrt':
      // d cbrt(a) = a' / (3 cbrt(a)^2)
      return div(d(a), mul(num(3), pow(call('cbrt', a), TWO)))
    case 'root': {
      // root(a, b) = b^(1/a), so d/dv = root(a, b) / (a b) · b' for an index a constant in v.
      if (dependsOn(a, v, scope)) throw new DerivativeRefusal('No derivative rule for "root" when its index depends on the variable', ['root'])
      if (!dependsOn(b, v, scope)) return ZERO
      return mul(div(expr, mul(a, b)), d(b))
    }
    case 'erf':
      // d erf(a) = (2/√π) e^(-a²) a'
      return mul(mul(div(TWO, call('sqrt', variable('pi'))), call('exp', neg(pow(a, TWO)))), d(a))
    case 'erfc':
      return neg(mul(mul(div(TWO, call('sqrt', variable('pi'))), call('exp', neg(pow(a, TWO)))), d(a)))
    case 'step':
      // 0 wherever the step has a derivative, NaN at 0 (0/a is NaN only there).
      return mul(div(ZERO, a), d(a))
    case 'gamma':
    case 'choose':
    case 'perm':
      if (!args.some((arg) => dependsOn(arg, v, scope))) return ZERO
      throw new DerivativeRefusal(`No derivative rule for "${name}": its derivative needs the digamma function, which the kernel does not have yet`, [name])
    case 'gcd':
    case 'lcm':
      if (!args.some((arg) => dependsOn(arg, v, scope))) return ZERO
      throw new DerivativeRefusal(`No derivative rule for "${name}": it is defined on whole numbers only`, [name])
  }
  throw new CompileError(`No derivative rule for "${name}"`, [name])
}

function differentiateReserved(expr: Expr & { kind: 'call' }, v: string, scope: MathScope, ctx: Ctx): Expr {
  const { name, args } = expr
  // Conditions are piecewise constant: 0 wherever they have a derivative.
  if (comparisonOp(name) || name === '__and' || name === '__or' || name === '__not') return ZERO
  switch (name) {
    case '__piecewise': {
      const pieces = Math.floor(args.length / 2)
      const parts: [Expr, Expr][] = []
      for (let i = 0; i < pieces; i++) parts.push([args[2 * i], differentiate(args[2 * i + 1], v, scope, ctx)])
      const otherwise = args.length % 2 === 1 ? differentiate(args[args.length - 1], v, scope, ctx) : null
      return piecewise(parts, otherwise)
    }
    case '__factorial':
      if (args.length !== 1) throw new CompileError(`"__factorial" takes 1 argument, got ${args.length}`, [name])
      // Like gamma: 0 for an argument that does not depend on v, a refusal otherwise.
      if (!dependsOn(args[0], v, scope)) return ZERO
      throw new DerivativeRefusal('No derivative rule for "!": its derivative needs the digamma function, which the kernel does not have yet', ['__factorial'])
    case '__prime':
      return differentiate(expandPrime(expr, scope), v, scope, ctx)
    case '__sum': {
      const { binder, lo, hi, body } = openBinder(expr, scope)
      if (dependsOn(lo, v, scope) || dependsOn(hi, v, scope)) {
        throw new DerivativeRefusal('No derivative rule for a sum whose bounds depend on the variable', ['__sum'])
      }
      if (binder.name === v) return ZERO
      return call('__sum', binder, lo, hi, differentiate(body, v, scope, ctx))
    }
    case '__prod':
      // A product of terms has no rule yet, but a product that does not read v
      // is constant (the same test as for gamma).
      openBinder(expr, scope)
      if (!dependsOn(expr, v, scope)) return ZERO
      throw new DerivativeRefusal('No derivative rule for a product of terms yet', ['__prod'])
    case '__integral': {
      // Leibniz: d/dv ∫_a^b g(t) dt = g(b) b' − g(a) a' + ∫_a^b ∂g/∂v dt
      const { binder, lo, hi, body } = openBinder(expr, scope)
      const at = (bound: Expr) => substitute(body, new Map([[binder.name, bound]]))
      let result: Expr = ZERO
      if (dependsOn(hi, v, scope)) result = add(result, mul(at(hi), differentiate(hi, v, scope, ctx)))
      if (dependsOn(lo, v, scope)) result = sub(result, mul(at(lo), differentiate(lo, v, scope, ctx)))
      if (binder.name !== v && freeVariablesDeep(body, scope, new Set([binder.name])).has(v)) {
        result = add(result, call('__integral', binder, lo, hi, differentiate(body, v, scope, ctx)))
      }
      return result
    }
  }
  throw new CompileError(`No derivative rule for "${name}"`, [name])
}

// A binder's pieces, as differentiation reads them. A malformed one is refused
// as compile refuses it. Two things are said outright about the body, because
// diff and substitute read an Expr without compile's scope of bound names: a
// call by the bound name, k(x), is the product compile reads it as; and a bound
// name that a user constant or function also has is given a fresh name, since
// compile reads the bound variable first and diff would read the definition.
function openBinder(expr: Expr & { kind: 'call' }, scope: MathScope): { binder: Expr & { kind: 'var' }; lo: Expr; hi: Expr; body: Expr } {
  if (expr.args.length !== 4) throw new CompileError(`"${expr.name}" takes 4 arguments, got ${expr.args.length}`, [expr.name])
  let name = nameArgument(expr, expr.name === '__integral' ? 'variable of integration' : 'index')
  let body = paramCallsAsProducts(expr.args[3], [name], scope)
  if (scope.functions.has(name)) {
    const fresh = freshName(name, varNames(body))
    body = substitute(body, new Map([[name, variable(fresh)]]))
    name = fresh
  }
  return { binder: { kind: 'var', name }, lo: expr.args[1], hi: expr.args[2], body }
}
