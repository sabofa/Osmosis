// Expr -> slot-indexed closures (K1). Every name resolves at compile time, so
// an unknown name is a compile error rather than a throw per sample, and a hot
// loop allocates nothing per call.
//
// How it works. A compiled function owns one Float64Array "frame". Its bound
// variables live in slots 0..n-1; every inlined user-function call gets fresh
// let-slots for its parameters, allocated at compile time, so an argument is
// evaluated once however often the body uses it. A node is a closure
// (frame) => number. Names resolve, in order: a bound variable, a parameter
// slot (read from scope.params.values at call time, so a parameter change needs
// no recompile), a user constant, a user function, `pi`, `e` or `inf`.
//
// A call whose name is not a function but a value, x(x + 1), is a product. The
// reserved call names (math/reserved.ts) carry conditions, piecewise, a!, f'(x)
// and the binders; the document's own @param or constant named like a built-in
// owns that name, and calling it as the built-in is an error.
//
// A user function's body sees its own parameters, the spec's parameters and
// constants, never the caller's variables (lexical scope, as v1's evaluator).
// There is no `new Function`: code generation stays out, for safety and
// determinism (SP2).
//
// parser/evalExpr.ts, the 2D evaluator, is untouched.

import type { Expr } from '../parser/types'
import { CompileError } from './errors'
import { mul, variable } from './expr'
import { derivativeBody, primeFunction } from './prime'
import { oddRootExponent, realOddPow } from './rational'
import { andValue, BINDERS, comparisonOp, compareValue, isReserved, notValue, orValue, pick } from './reserved'
import { isVectorBody, type MathFunction, type MathScope } from './scope'
import { choose, erf, erfc, factorial, gamma, gcd, lcm, perm, root, step } from './special'

// A compile-time refusal (math/errors.ts, re-exported here for its importers).
export { CompileError }

// Called with as many numbers as the compile's `vars` (at most three).
export type CompiledFn = (a?: number, b?: number, c?: number) => number

// Writes x, y, z into `out` (length 3) and returns it: no allocation per call.
export type CompiledVec = (out: Float64Array, a?: number, b?: number, c?: number) => Float64Array

// A node may say it is a leaf — a frame slot, a literal, or a parameter slot —
// so the node above it reads the leaf inline instead of calling it. Nothing
// changes but speed: the same numbers go through the same operations.
type Node = ((frame: Float64Array) => number) & { slot?: number; constant?: number; param?: number }

function slotLeaf(slot: number): Node {
  const node: Node = (f) => f[slot]
  node.slot = slot
  return node
}

function constantLeaf(value: number): Node {
  const node: Node = () => value
  node.constant = value
  return node
}

function paramLeaf(values: Float64Array, index: number): Node {
  const node: Node = () => values[index]
  node.param = index
  return node
}

const DEG = Math.PI / 180
const TO_DEG = 180 / Math.PI

interface Env {
  // name -> frame slot
  readonly bound: ReadonlyMap<string, number>
}

interface Ctx {
  scope: MathScope
  // next free frame slot
  slots: number
  // user functions being inlined, outermost first (cycle detection)
  stack: string[]
}

// ---------------------------------------------------------------------------
// Built-ins
// ---------------------------------------------------------------------------

interface Builtin {
  min: number
  max: number
  make(args: Node[], angle: MathScope['angle']): Node
}

function unary(fn: (v: number) => number): Builtin {
  return {
    min: 1,
    max: 1,
    make: ([a]) => {
      const s = a.slot
      return s !== undefined ? (f) => fn(f[s]) : (f) => fn(a(f))
    },
  }
}

// Trig takes the angle in the spec's unit.
function trig(fn: (v: number) => number): Builtin {
  return {
    min: 1,
    max: 1,
    make: ([a], angle) => {
      const s = a.slot
      if (angle === 'degrees') return s !== undefined ? (f) => fn(f[s] * DEG) : (f) => fn(a(f) * DEG)
      return s !== undefined ? (f) => fn(f[s]) : (f) => fn(a(f))
    },
  }
}

// Inverse trig returns the angle in the spec's unit.
function inverseTrig(fn: (v: number) => number): Builtin {
  return {
    min: 1,
    max: 1,
    make: ([a], angle) => (angle === 'degrees' ? (f) => fn(a(f)) * TO_DEG : (f) => fn(a(f))),
  }
}

// min and max: two or more arguments, folded without an array.
function variadic(pair: (x: number, y: number) => number): Builtin {
  return {
    min: 2,
    max: Infinity,
    make: (args) => {
      if (args.length === 2) {
        const [a, b] = args
        return (f) => pair(a(f), b(f))
      }
      if (args.length === 3) {
        const [a, b, c] = args
        return (f) => pair(pair(a(f), b(f)), c(f))
      }
      return (f) => {
        let acc = args[0](f)
        for (let i = 1; i < args.length; i++) acc = pair(acc, args[i](f))
        return acc
      }
    },
  }
}

// A two-argument built-in that is a plain function of both.
function binary2(fn: (a: number, b: number) => number): Builtin {
  return {
    min: 2,
    max: 2,
    make: ([a, b]) => (f) => fn(a(f), b(f)),
  }
}

// Rounds half away from zero: round(-2.5) = -3, round(2.5) = 3.
export function roundHalfAway(v: number): number {
  return v < 0 ? -Math.round(-v) : Math.round(v)
}

// Floor-mod: a - b*floor(a/b), which has the sign of b.
export function floorMod(a: number, b: number): number {
  return a - b * Math.floor(a / b)
}

const BUILTINS: ReadonlyMap<string, Builtin> = new Map<string, Builtin>([
  ['sin', trig(Math.sin)],
  ['cos', trig(Math.cos)],
  ['tan', trig(Math.tan)],
  ['sec', trig((v) => 1 / Math.cos(v))],
  ['csc', trig((v) => 1 / Math.sin(v))],
  ['cot', trig((v) => 1 / Math.tan(v))],
  ['asin', inverseTrig(Math.asin)],
  ['acos', inverseTrig(Math.acos)],
  ['atan', inverseTrig(Math.atan)],
  [
    'atan2',
    {
      min: 2,
      max: 2,
      make: ([y, x], angle) => (angle === 'degrees' ? (f) => Math.atan2(y(f), x(f)) * TO_DEG : (f) => Math.atan2(y(f), x(f))),
    },
  ],
  ['sinh', unary(Math.sinh)],
  ['cosh', unary(Math.cosh)],
  ['tanh', unary(Math.tanh)],
  ['asinh', unary(Math.asinh)],
  ['acosh', unary(Math.acosh)],
  ['atanh', unary(Math.atanh)],
  ['sqrt', unary(Math.sqrt)],
  ['abs', unary(Math.abs)],
  ['exp', unary(Math.exp)],
  ['ln', unary(Math.log)],
  [
    'log',
    {
      // log(a) is base 10; log(a, b) is the log of a in base b (v1's meaning).
      min: 1,
      max: 2,
      make: ([a, b]) => (b ? (f) => Math.log(a(f)) / Math.log(b(f)) : (f) => Math.log10(a(f))),
    },
  ],
  ['floor', unary(Math.floor)],
  ['ceil', unary(Math.ceil)],
  ['round', unary(roundHalfAway)],
  ['sign', unary(Math.sign)],
  [
    'mod',
    {
      min: 2,
      max: 2,
      make: ([a, b]) => (f) => floorMod(a(f), b(f)),
    },
  ],
  ['min', variadic(Math.min)],
  ['max', variadic(Math.max)],
  // hypot(a, b, c) = sqrt(a^2 + b^2 + c^2), by Math.hypot, which scales and so
  // does not overflow at 1e200.
  [
    'hypot',
    {
      min: 2,
      max: Infinity,
      make: (args) => {
        if (args.length === 2) {
          const [a, b] = args
          return (f) => Math.hypot(a(f), b(f))
        }
        if (args.length === 3) {
          const [a, b, c] = args
          return (f) => Math.hypot(a(f), b(f), c(f))
        }
        const values = new Array<number>(args.length)
        return (f) => {
          for (let i = 0; i < args.length; i++) values[i] = args[i](f)
          return Math.hypot(...values)
        }
      },
    },
  ],
  // Special and integer functions (calc P1, math/special.ts).
  ['gamma', unary(gamma)],
  ['erf', unary(erf)],
  ['erfc', unary(erfc)],
  ['cbrt', unary(Math.cbrt)],
  ['step', unary(step)],
  ['choose', binary2(choose)],
  ['perm', binary2(perm)],
  ['gcd', binary2(gcd)],
  ['lcm', binary2(lcm)],
  ['root', binary2(root)],
])

// The built-in function names, for the grammar's name rules.
export const BUILTIN_NAMES: ReadonlySet<string> = new Set(BUILTINS.keys())

// How many arguments a built-in takes, or null when `name` is not a built-in.
export function builtinArity(name: string): { min: number; max: number } | null {
  const b = BUILTINS.get(name)
  return b ? { min: b.min, max: b.max } : null
}

function arityText(min: number, max: number): string {
  if (min === max) return `${min} argument${min === 1 ? '' : 's'}`
  if (max === Infinity) return `${min} or more arguments`
  return `${min} or ${max} arguments`
}

// ---------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------

// l op r, reading a slot, literal or parameter operand inline. Each branch is
// the same operation on the same two numbers as the general (f) => l(f) op r(f).
function binaryNode(op: '+' | '-' | '*' | '/' | '^', l: Node, r: Node, values: Float64Array): Node {
  const ls = l.slot
  const rs = r.slot
  const lc = l.constant
  const rc = r.constant
  const lp = l.param
  const rp = r.param
  switch (op) {
    case '+':
      if (ls !== undefined && rs !== undefined) return (f) => f[ls] + f[rs]
      if (ls !== undefined && rc !== undefined) return (f) => f[ls] + rc
      if (lc !== undefined && rs !== undefined) return (f) => lc + f[rs]
      if (ls !== undefined) return (f) => f[ls] + r(f)
      if (rs !== undefined) return (f) => l(f) + f[rs]
      if (lp !== undefined) return (f) => values[lp] + r(f)
      if (rp !== undefined) return (f) => l(f) + values[rp]
      if (lc !== undefined) return (f) => lc + r(f)
      if (rc !== undefined) return (f) => l(f) + rc
      return (f) => l(f) + r(f)
    case '-':
      if (ls !== undefined && rs !== undefined) return (f) => f[ls] - f[rs]
      if (ls !== undefined && rc !== undefined) return (f) => f[ls] - rc
      if (lc !== undefined && rs !== undefined) return (f) => lc - f[rs]
      if (ls !== undefined) return (f) => f[ls] - r(f)
      if (rs !== undefined) return (f) => l(f) - f[rs]
      if (lp !== undefined) return (f) => values[lp] - r(f)
      if (rp !== undefined) return (f) => l(f) - values[rp]
      if (lc !== undefined) return (f) => lc - r(f)
      if (rc !== undefined) return (f) => l(f) - rc
      return (f) => l(f) - r(f)
    case '*':
      if (ls !== undefined && rs !== undefined) return (f) => f[ls] * f[rs]
      if (ls !== undefined && rc !== undefined) return (f) => f[ls] * rc
      if (lc !== undefined && rs !== undefined) return (f) => lc * f[rs]
      if (ls !== undefined) return (f) => f[ls] * r(f)
      if (rs !== undefined) return (f) => l(f) * f[rs]
      if (lp !== undefined) return (f) => values[lp] * r(f)
      if (rp !== undefined) return (f) => l(f) * values[rp]
      if (lc !== undefined) return (f) => lc * r(f)
      if (rc !== undefined) return (f) => l(f) * rc
      return (f) => l(f) * r(f)
    case '/':
      if (ls !== undefined && rs !== undefined) return (f) => f[ls] / f[rs]
      if (ls !== undefined && rc !== undefined) return (f) => f[ls] / rc
      if (lc !== undefined && rs !== undefined) return (f) => lc / f[rs]
      if (ls !== undefined) return (f) => f[ls] / r(f)
      if (rs !== undefined) return (f) => l(f) / f[rs]
      if (lp !== undefined) return (f) => values[lp] / r(f)
      if (rp !== undefined) return (f) => l(f) / values[rp]
      if (lc !== undefined) return (f) => lc / r(f)
      if (rc !== undefined) return (f) => l(f) / rc
      return (f) => l(f) / r(f)
    case '^':
      if (ls !== undefined && rc !== undefined) return (f) => Math.pow(f[ls], rc)
      if (ls !== undefined) return (f) => Math.pow(f[ls], r(f))
      if (rc !== undefined) return (f) => Math.pow(l(f), rc)
      return (f) => Math.pow(l(f), r(f))
  }
}

function cycleError(stack: readonly string[], name: string): CompileError {
  const loop = stack.slice(stack.indexOf(name))
  const names = [...new Set(loop)]
  const path = [...loop, name].join(' → ')
  const message =
    names.length === 1
      ? `"${name}" is defined in terms of itself (${path})`
      : `${names.map((n) => `"${n}"`).join(' and ')} are defined in terms of each other (${path})`
  return new CompileError(message, names)
}

function inlineBody(name: string, fn: MathFunction, args: Node[], ctx: Ctx): Node {
  if (ctx.stack.includes(name)) throw cycleError(ctx.stack, name)
  if (isVectorBody(fn.body)) {
    throw new CompileError(`"${name}" is vector-valued and cannot be used as a number`, [name])
  }
  // An argument that already lives in a frame slot (a bound variable, or an
  // outer call's parameter) is aliased: nothing writes that slot while this
  // body runs, so reading it is reading the argument. Every other argument is
  // evaluated once into a fresh let-slot.
  const bound = new Map<string, number>()
  const writes: Node[] = []
  const slots: number[] = []
  fn.params.forEach((param, i) => {
    const alias = args[i]?.slot
    if (alias !== undefined) {
      bound.set(param, alias)
      return
    }
    const slot = ctx.slots++
    bound.set(param, slot)
    writes.push(args[i])
    slots.push(slot)
  })
  ctx.stack.push(name)
  const body = compileNode(fn.body, { bound }, ctx)
  ctx.stack.pop()
  args = writes

  switch (args.length) {
    case 0:
      return body
    case 1: {
      const [a0] = args
      const [s0] = slots
      return (f) => {
        f[s0] = a0(f)
        return body(f)
      }
    }
    case 2: {
      const [a0, a1] = args
      const [s0, s1] = slots
      return (f) => {
        f[s0] = a0(f)
        f[s1] = a1(f)
        return body(f)
      }
    }
    case 3: {
      const [a0, a1, a2] = args
      const [s0, s1, s2] = slots
      return (f) => {
        f[s0] = a0(f)
        f[s1] = a1(f)
        f[s2] = a2(f)
        return body(f)
      }
    }
    default:
      return (f) => {
        for (let i = 0; i < args.length; i++) f[slots[i]] = args[i](f)
        return body(f)
      }
  }
}

function compileVar(name: string, env: Env, ctx: Ctx): Node {
  const slot = env.bound.get(name)
  if (slot !== undefined) return slotLeaf(slot)

  const param = ctx.scope.params.index.get(name)
  if (param !== undefined) return paramLeaf(ctx.scope.params.values, param)

  const fn = ctx.scope.functions.get(name)
  if (fn) {
    if (fn.params.length > 0) {
      throw new CompileError(`"${name}" is a function of ${fn.params.length} variable${fn.params.length === 1 ? '' : 's'} — call it as ${name}(${fn.params.join(', ')})`, [name])
    }
    return inlineBody(name, fn, [], ctx)
  }

  if (name === 'pi') return constantLeaf(Math.PI)
  if (name === 'e') return constantLeaf(Math.E)
  if (name === 'inf') return constantLeaf(Infinity)
  throw new CompileError(`Unknown variable "${name}"${productHint(name, env)}`, [name])
}

// "xy" with x and y both bound reads as a product the author forgot to mark.
function productHint(name: string, env: { readonly bound: ReadonlyMap<string, number> }): string {
  if (name.length < 2 || ![...name].every((c) => env.bound.has(c))) return ''
  return ` — did you mean ${[...name].join('*')}?`
}

// A built-in's name that the document also defines as a value, a @param or a
// constant, belongs to that value here: called like the built-in it is an
// error, never read as a product (ruling agreed with space, 2026-10-02). A
// user function of the name shadows the built-in quietly, as it always has.
export function builtinShadowError(name: string, scope: MathScope): CompileError | null {
  if (!BUILTINS.has(name)) return null
  const role = scope.params.index.has(name) ? 'a parameter' : scope.functions.get(name)?.params.length === 0 ? 'a constant' : null
  if (!role) return null
  return new CompileError(`"${name}" is ${role} in this document; rename it to use the built-in ${name} function`, [name])
}

// Whether `name` denotes a value here — a bound variable, a parameter, a user
// constant, pi, e or inf — so that "name(arg)" is a product, x(x + 1).
function namesValue(name: string, env: Env, ctx: Ctx): boolean {
  if (env.bound.has(name) || ctx.scope.params.index.has(name)) return true
  const fn = ctx.scope.functions.get(name)
  if (fn) return fn.params.length === 0
  return name === 'pi' || name === 'e' || name === 'inf'
}

// Inside a function's body its parameters are bound values, and compile reads a
// call with one argument by a parameter's name as a product, a(a + 1): the
// parameter comes after a user function or a built-in of that name in the
// lookup, and before a document's @param or constant. diff and prime rename a
// body's variables, and a call name is not a variable, so they first say the
// product outright with this, or the call would later resolve to the document's
// value (or to nothing). A reserved name, a built-in (shadowed by the document
// or not) and a user function of one or more parameters stay calls. A binder's
// bound name shadows the parameter in its body, not in its bounds; __prime's
// first argument names a function and is left alone.
export function paramCallsAsProducts(expr: Expr, params: readonly string[], scope: MathScope): Expr {
  const rewrite = (e: Expr, names: ReadonlySet<string>): Expr => {
    switch (e.kind) {
      case 'num':
      case 'var':
        return e
      case 'unary':
        return { kind: 'unary', op: '-', arg: rewrite(e.arg, names) }
      case 'binary':
        return { kind: 'binary', op: e.op, left: rewrite(e.left, names), right: rewrite(e.right, names) }
      case 'call': {
        const { name } = e
        const first = e.args[0]
        // A binder's body is its last (fourth) argument; its bounds are outside it.
        const inner = BINDERS.has(name) && first?.kind === 'var' ? new Set([...names].filter((n) => n !== first.name)) : names
        const args = e.args.map((arg, i) => {
          if (i === 0 && (name === '__prime' || BINDERS.has(name))) return arg
          return rewrite(arg, i === 3 && BINDERS.has(name) ? inner : names)
        })
        if (args.length === 1 && names.has(name) && !isReserved(name) && !BUILTINS.has(name)) {
          const fn = scope.functions.get(name)
          if (!(fn && fn.params.length > 0)) return mul(variable(name), args[0])
        }
        return { kind: 'call', name, args }
      }
    }
  }
  return rewrite(expr, new Set(params))
}

function compileReserved(expr: Expr & { kind: 'call' }, env: Env, ctx: Ctx): Node {
  const { name } = expr
  const args = () => expr.args.map((arg) => compileNode(arg, env, ctx))
  const op = comparisonOp(name)
  if (op) {
    if (expr.args.length !== 2) throw new CompileError(`"${name}" takes 2 arguments, got ${expr.args.length}`, [name])
    const [a, b] = args()
    return (f) => compareValue(op, a(f), b(f))
  }
  switch (name) {
    case '__and':
    case '__or': {
      if (expr.args.length !== 2) throw new CompileError(`"${name}" takes 2 arguments, got ${expr.args.length}`, [name])
      const [a, b] = args()
      return name === '__and' ? (f) => andValue(a(f), b(f)) : (f) => orValue(a(f), b(f))
    }
    case '__not': {
      if (expr.args.length !== 1) throw new CompileError(`"__not" takes 1 argument, got ${expr.args.length}`, [name])
      const [a] = args()
      return (f) => notValue(a(f))
    }
    case '__factorial': {
      if (expr.args.length !== 1) throw new CompileError(`"__factorial" takes 1 argument, got ${expr.args.length}`, [name])
      const [a] = args()
      return (f) => factorial(a(f))
    }
    case '__piecewise': {
      if (expr.args.length < 2) throw new CompileError('A piecewise definition needs at least one condition and its value', [name])
      const nodes = args()
      const pieces = Math.floor(nodes.length / 2)
      const conditions = nodes.filter((_, i) => i < pieces * 2 && i % 2 === 0)
      const values = nodes.filter((_, i) => i < pieces * 2 && i % 2 === 1)
      const otherwise = nodes.length % 2 === 1 ? nodes[nodes.length - 1] : null
      return (f) => {
        for (let i = 0; i < conditions.length; i++) {
          const c = conditions[i](f)
          if (c !== c) return Number.NaN
          if (c !== 0) return values[i](f)
        }
        return otherwise ? otherwise(f) : Number.NaN
      }
    }
    case '__prime': {
      const { name: fnName, fn, order } = primeFunction(expr, ctx.scope)
      const body = derivativeBody(fnName, fn, order, ctx.scope)
      return inlineBody(fnName, { params: fn.params, body }, [compileNode(expr.args[2], env, ctx)], ctx)
    }
  }
  throw new CompileError(`"${name}" is reserved and not supported here`, [name])
}

function compileCall(expr: Expr & { kind: 'call' }, env: Env, ctx: Ctx): Node {
  const { name } = expr
  if (isReserved(name)) return compileReserved(expr, env, ctx)
  const shadowed = builtinShadowError(name, ctx.scope)
  if (shadowed) throw shadowed
  const fn = ctx.scope.functions.get(name)
  if (fn && !(fn.params.length === 0 && expr.args.length === 1)) {
    if (expr.args.length !== fn.params.length) {
      throw new CompileError(`"${name}" takes ${arityText(fn.params.length, fn.params.length)}, got ${expr.args.length}`, [name])
    }
    if (isVectorBody(fn.body)) {
      throw new CompileError(`"${name}" is vector-valued and cannot be used as a number`, [name])
    }
    if (ctx.stack.includes(name)) throw cycleError(ctx.stack, name)
    const args = expr.args.map((arg) => compileNode(arg, env, ctx))
    return inlineBody(name, fn, args, ctx)
  }

  const builtin = BUILTINS.get(name)
  if (!builtin) {
    if (expr.args.length === 1 && namesValue(name, env, ctx)) {
      return binaryNode('*', compileVar(name, env, ctx), compileNode(expr.args[0], env, ctx), ctx.scope.params.values)
    }
    throw new CompileError(`Unknown function "${name}"`, [name])
  }
  if (expr.args.length < builtin.min || expr.args.length > builtin.max) {
    throw new CompileError(`"${name}" takes ${arityText(builtin.min, builtin.max)}, got ${expr.args.length}`, [name])
  }
  return builtin.make(
    expr.args.map((arg) => compileNode(arg, env, ctx)),
    ctx.scope.angle
  )
}

function compileNode(expr: Expr, env: Env, ctx: Ctx): Node {
  switch (expr.kind) {
    case 'num':
      return constantLeaf(expr.value)
    case 'var':
      return compileVar(expr.name, env, ctx)
    case 'unary': {
      const a = compileNode(expr.arg, env, ctx)
      const s = a.slot
      return s !== undefined ? (f) => -f[s] : (f) => -a(f)
    }
    case 'binary': {
      // A literal p/q exponent with q odd takes the real root (math/rational.ts).
      if (expr.op === '^') {
        const odd = oddRootExponent(expr.right)
        if (odd) {
          const base = compileNode(expr.left, env, ctx)
          const exponent = compileNode(expr.right, env, ctx)
          const pOdd = Math.abs(odd.p) % 2 === 1
          return (f) => realOddPow(base(f), exponent(f), pOdd)
        }
      }
      return binaryNode(expr.op, compileNode(expr.left, env, ctx), compileNode(expr.right, env, ctx), ctx.scope.params.values)
    }
    case 'call':
      return compileCall(expr, env, ctx)
  }
  throw new Error('Unreachable expression kind')
}

function bindVars(vars: readonly string[]): Env {
  if (vars.length > 3) throw new Error(`A compiled function takes at most three variables, got ${vars.length}`)
  const bound = new Map<string, number>()
  vars.forEach((v, i) => bound.set(v, i))
  return { bound }
}

// Compiles a scalar expression over `vars` (at most three). Throws
// CompileError for an unknown name, a wrong arity, a cycle, or a vector used
// as a number.
export function compileScalar(expr: Expr, vars: readonly string[], scope: MathScope): CompiledFn {
  const env = bindVars(vars)
  const ctx: Ctx = { scope, slots: vars.length, stack: [] }
  const root = compileNode(expr, env, ctx)
  const frame = new Float64Array(Math.max(ctx.slots, 1))
  switch (vars.length) {
    case 0:
      return () => root(frame)
    case 1:
      return (a) => {
        frame[0] = a as number
        return root(frame)
      }
    case 2:
      return (a, b) => {
        frame[0] = a as number
        frame[1] = b as number
        return root(frame)
      }
    default:
      return (a, b, c) => {
        frame[0] = a as number
        frame[1] = b as number
        frame[2] = c as number
        return root(frame)
      }
  }
}

// Compiles three component expressions sharing one frame. Bound variables are
// written once per call; each component's let-slots are its own.
// ---------------------------------------------------------------------------
// compileMany: a straight-line register program
// ---------------------------------------------------------------------------
//
// Several expressions over the same variables, compiled to ONE flat program:
// every node is one instruction writing its own register, so a subexpression
// that occurs again at the top level (a surface and its partials share cos u,
// sin v, ...) reuses the register instead of being computed again, and the
// hot loop is a switch over opcodes with no closure calls — closure trees go
// megamorphic once a scene holds many of them, which is what kept re-sampling
// over budget. Every output is exactly what compileScalar gives: each node is
// the same IEEE operation on the same operands (trig in degrees multiplies by
// pi/180 first, inverse trig by 180/pi after, as the closures do), and nothing
// has a side effect to reorder. User functions inline into fresh registers
// (an argument is evaluated once); parameters are read once per call, at its
// start; names resolve as in compileScalar, with the same refusals.

// Writes one number per compiled expression into `out` and returns it.
// `instructions` is the program's length, for tests and profiling.
export type CompiledMany = ((out: Float64Array, a?: number, b?: number, c?: number) => Float64Array) & { readonly instructions: number }

const OP_ADD = 0
const OP_SUB = 1
const OP_MUL = 2
const OP_DIV = 3
const OP_POW = 4
const OP_NEG = 5
const OP_SIN = 6
const OP_COS = 7
const OP_TAN = 8
const OP_SQRT = 9
const OP_ABS = 10
const OP_EXP = 11
const OP_LN = 12
const OP_ATAN2 = 13
const OP_MIN = 14
const OP_MAX = 15
const OP_CALL1 = 16
const OP_CALL2 = 17
const OP_HYPOT2 = 18
const OP_HYPOT3 = 19
const OP_HYPOTN = 20
const OP_COPY = 21
const OP_RPOW_ODD = 22
const OP_RPOW_EVEN = 23
const OP_PICK = 24

// The built-ins without an opcode of their own, as the closures compute them.
const UNARY_TABLE: readonly ((v: number) => number)[] = [
  (v) => 1 / Math.cos(v),
  (v) => 1 / Math.sin(v),
  (v) => 1 / Math.tan(v),
  Math.asin,
  Math.acos,
  Math.atan,
  Math.sinh,
  Math.cosh,
  Math.tanh,
  Math.asinh,
  Math.acosh,
  Math.atanh,
  Math.floor,
  Math.ceil,
  roundHalfAway,
  Math.sign,
  Math.log10,
  gamma,
  erf,
  erfc,
  Math.cbrt,
  step,
  notValue,
  factorial,
]
const UNARY_INDEX: ReadonlyMap<string, number> = new Map(
  [
    'sec',
    'csc',
    'cot',
    'asin',
    'acos',
    'atan',
    'sinh',
    'cosh',
    'tanh',
    'asinh',
    'acosh',
    'atanh',
    'floor',
    'ceil',
    'round',
    'sign',
    'log10',
    'gamma',
    'erf',
    'erfc',
    'cbrt',
    'step',
    '__not',
    '__factorial',
  ].map((n, i) => [n, i])
)
// The table slot of a built-in with no opcode of its own. A built-in that has
// neither is refused, never silently computed as another (slot 0 is sec).
function unaryIndex(name: string): number {
  const index = UNARY_INDEX.get(name)
  if (index === undefined) throw new Error(`compileMany has no instruction for the built-in "${name}"`)
  return index
}

const BINARY_TABLE: readonly ((x: number, y: number) => number)[] = [
  (x, y) => Math.log(x) / Math.log(y),
  floorMod,
  choose,
  perm,
  gcd,
  lcm,
  root,
  (a, b) => compareValue('<', a, b),
  (a, b) => compareValue('<=', a, b),
  (a, b) => compareValue('>', a, b),
  (a, b) => compareValue('>=', a, b),
  (a, b) => compareValue('=', a, b),
  (a, b) => compareValue('!=', a, b),
  andValue,
  orValue,
]
// The table slots of the reserved two-argument names (indices 7-14 above).
const BINARY_INDEX: ReadonlyMap<string, number> = new Map([
  ['__lt', 7],
  ['__le', 8],
  ['__gt', 9],
  ['__ge', 10],
  ['__eq', 11],
  ['__ne', 12],
  ['__and', 13],
  ['__or', 14],
])

// Instruction layout: [op, dst, a, b, c].
const WIDTH = 5

class ProgramBuilder {
  readonly code: number[] = []
  readonly initial: number[] = []
  readonly params: [number, number][] = []
  private registers: number
  private readonly constants = new Map<string, number>()
  private readonly paramRegister = new Map<number, number>()

  constructor(inputs: number) {
    this.registers = inputs
    for (let i = 0; i < inputs; i++) this.initial.push(0)
  }

  private fresh(value = 0): number {
    this.initial.push(value)
    return this.registers++
  }

  constant(value: number): number {
    const k = Object.is(value, -0) ? '-0' : String(value)
    let r = this.constants.get(k)
    if (r === undefined) {
      r = this.fresh(value)
      this.constants.set(k, r)
    }
    return r
  }

  param(index: number): number {
    let r = this.paramRegister.get(index)
    if (r === undefined) {
      r = this.fresh()
      this.paramRegister.set(index, r)
      this.params.push([r, index])
    }
    return r
  }

  emit(op: number, a: number, b = 0, c = 0): number {
    const dst = this.fresh()
    this.code.push(op, dst, a, b, c)
    return dst
  }

  // n consecutive registers, for Math.hypot of more than three arguments.
  block(n: number): number {
    const first = this.registers
    for (let i = 0; i < n; i++) this.fresh()
    return first
  }

  copy(dst: number, src: number) {
    this.code.push(OP_COPY, dst, src, 0, 0)
  }

  get size(): number {
    return this.registers
  }
}

interface ProgramCtx {
  scope: MathScope
  program: ProgramBuilder
  stack: string[]
  top: ReadonlyMap<string, number>
  key: (e: Expr) => string
  // register of each top-level subexpression already computed
  seen: Map<string, number>
}

function programVar(name: string, bound: ReadonlyMap<string, number>, ctx: ProgramCtx): number {
  const slot = bound.get(name)
  if (slot !== undefined) return slot
  const param = ctx.scope.params.index.get(name)
  if (param !== undefined) return ctx.program.param(param)
  const fn = ctx.scope.functions.get(name)
  if (fn) {
    if (fn.params.length > 0) {
      throw new CompileError(`"${name}" is a function of ${fn.params.length} variable${fn.params.length === 1 ? '' : 's'} — call it as ${name}(${fn.params.join(', ')})`, [name])
    }
    return programInline(name, fn, [], ctx)
  }
  if (name === 'pi') return ctx.program.constant(Math.PI)
  if (name === 'e') return ctx.program.constant(Math.E)
  if (name === 'inf') return ctx.program.constant(Infinity)
  throw new CompileError(`Unknown variable "${name}"${productHint(name, { bound })}`, [name])
}

function programInline(name: string, fn: MathFunction, args: number[], ctx: ProgramCtx): number {
  if (ctx.stack.includes(name)) throw cycleError(ctx.stack, name)
  if (isVectorBody(fn.body)) throw new CompileError(`"${name}" is vector-valued and cannot be used as a number`, [name])
  const bound = new Map<string, number>()
  fn.params.forEach((param, i) => bound.set(param, args[i]))
  ctx.stack.push(name)
  const r = programNode(fn.body, bound, ctx)
  ctx.stack.pop()
  return r
}

function programNamesValue(name: string, bound: ReadonlyMap<string, number>, ctx: ProgramCtx): boolean {
  if (bound.has(name) || ctx.scope.params.index.has(name)) return true
  const fn = ctx.scope.functions.get(name)
  if (fn) return fn.params.length === 0
  return name === 'pi' || name === 'e' || name === 'inf'
}

function programReserved(expr: Expr & { kind: 'call' }, bound: ReadonlyMap<string, number>, ctx: ProgramCtx): number {
  const { name } = expr
  const p = ctx.program
  const binaryIndex = BINARY_INDEX.get(name)
  if (binaryIndex !== undefined) {
    if (expr.args.length !== 2) throw new CompileError(`"${name}" takes 2 arguments, got ${expr.args.length}`, [name])
    const [a, b] = expr.args.map((arg) => programNode(arg, bound, ctx))
    return p.emit(OP_CALL2, a, b, binaryIndex)
  }
  switch (name) {
    case '__not':
    case '__factorial': {
      if (expr.args.length !== 1) throw new CompileError(`"${name}" takes 1 argument, got ${expr.args.length}`, [name])
      return p.emit(OP_CALL1, programNode(expr.args[0], bound, ctx), unaryIndex(name))
    }
    case '__piecewise': {
      if (expr.args.length < 2) throw new CompileError('A piecewise definition needs at least one condition and its value', [name])
      const regs = expr.args.map((arg) => programNode(arg, bound, ctx))
      const pieces = Math.floor(regs.length / 2)
      let rest = regs.length % 2 === 1 ? regs[regs.length - 1] : p.constant(Number.NaN)
      for (let i = pieces - 1; i >= 0; i--) rest = p.emit(OP_PICK, regs[2 * i], regs[2 * i + 1], rest)
      return rest
    }
    case '__prime': {
      const { name: fnName, fn, order } = primeFunction(expr, ctx.scope)
      const body = derivativeBody(fnName, fn, order, ctx.scope)
      return programInline(fnName, { params: fn.params, body }, [programNode(expr.args[2], bound, ctx)], ctx)
    }
  }
  throw new CompileError(`"${name}" is reserved and not supported here`, [name])
}

function programCall(expr: Expr & { kind: 'call' }, bound: ReadonlyMap<string, number>, ctx: ProgramCtx): number {
  const { name } = expr
  const p = ctx.program
  if (isReserved(name)) return programReserved(expr, bound, ctx)
  const shadowed = builtinShadowError(name, ctx.scope)
  if (shadowed) throw shadowed
  const fn = ctx.scope.functions.get(name)
  if (fn && !(fn.params.length === 0 && expr.args.length === 1)) {
    if (expr.args.length !== fn.params.length) {
      throw new CompileError(`"${name}" takes ${arityText(fn.params.length, fn.params.length)}, got ${expr.args.length}`, [name])
    }
    if (isVectorBody(fn.body)) throw new CompileError(`"${name}" is vector-valued and cannot be used as a number`, [name])
    if (ctx.stack.includes(name)) throw cycleError(ctx.stack, name)
    return programInline(
      name,
      fn,
      expr.args.map((arg) => programNode(arg, bound, ctx)),
      ctx
    )
  }
  const builtin = BUILTINS.get(name)
  if (!builtin) {
    if (expr.args.length === 1 && programNamesValue(name, bound, ctx)) {
      return p.emit(OP_MUL, programVar(name, bound, ctx), programNode(expr.args[0], bound, ctx))
    }
    throw new CompileError(`Unknown function "${name}"`, [name])
  }
  if (expr.args.length < builtin.min || expr.args.length > builtin.max) {
    throw new CompileError(`"${name}" takes ${arityText(builtin.min, builtin.max)}, got ${expr.args.length}`, [name])
  }
  const args = expr.args.map((arg) => programNode(arg, bound, ctx))
  const degrees = ctx.scope.angle === 'degrees'
  const toRadians = (r: number) => (degrees ? p.emit(OP_MUL, r, p.constant(DEG)) : r)
  const toDegrees = (r: number) => (degrees ? p.emit(OP_MUL, r, p.constant(TO_DEG)) : r)
  const [a, b] = args
  switch (name) {
    case 'sin':
      return p.emit(OP_SIN, toRadians(a))
    case 'cos':
      return p.emit(OP_COS, toRadians(a))
    case 'tan':
      return p.emit(OP_TAN, toRadians(a))
    case 'sec':
    case 'csc':
    case 'cot':
      return p.emit(OP_CALL1, toRadians(a), unaryIndex(name))
    case 'asin':
    case 'acos':
    case 'atan':
      return toDegrees(p.emit(OP_CALL1, a, unaryIndex(name)))
    case 'atan2':
      return toDegrees(p.emit(OP_ATAN2, a, b))
    case 'sqrt':
      return p.emit(OP_SQRT, a)
    case 'abs':
      return p.emit(OP_ABS, a)
    case 'exp':
      return p.emit(OP_EXP, a)
    case 'ln':
      return p.emit(OP_LN, a)
    case 'log':
      return args.length === 2 ? p.emit(OP_CALL2, a, b, 0) : p.emit(OP_CALL1, a, unaryIndex('log10'))
    case 'mod':
      return p.emit(OP_CALL2, a, b, 1)
    case 'min':
    case 'max': {
      let acc = a
      for (let i = 1; i < args.length; i++) acc = p.emit(name === 'min' ? OP_MIN : OP_MAX, acc, args[i])
      return acc
    }
    case 'hypot': {
      if (args.length === 2) return p.emit(OP_HYPOT2, a, b)
      if (args.length === 3) return p.emit(OP_HYPOT3, a, b, args[2])
      const first = p.block(args.length)
      args.forEach((r, i) => p.copy(first + i, r))
      return p.emit(OP_HYPOTN, first, args.length)
    }
    case 'choose':
      return p.emit(OP_CALL2, a, b, 2)
    case 'perm':
      return p.emit(OP_CALL2, a, b, 3)
    case 'gcd':
      return p.emit(OP_CALL2, a, b, 4)
    case 'lcm':
      return p.emit(OP_CALL2, a, b, 5)
    case 'root':
      return p.emit(OP_CALL2, a, b, 6)
    default:
      return p.emit(OP_CALL1, a, unaryIndex(name))
  }
}

function programNode(expr: Expr, bound: ReadonlyMap<string, number>, ctx: ProgramCtx): number {
  // A repeated subexpression at the top level reuses its register.
  const top = bound === ctx.top && expr.kind !== 'num' && expr.kind !== 'var'
  const k = top ? ctx.key(expr) : ''
  if (top) {
    const known = ctx.seen.get(k)
    if (known !== undefined) return known
  }
  let r: number
  switch (expr.kind) {
    case 'num':
      return ctx.program.constant(expr.value)
    case 'var':
      return programVar(expr.name, bound, ctx)
    case 'unary':
      r = ctx.program.emit(OP_NEG, programNode(expr.arg, bound, ctx))
      break
    case 'binary': {
      const l = programNode(expr.left, bound, ctx)
      const rr = programNode(expr.right, bound, ctx)
      const odd = expr.op === '^' ? oddRootExponent(expr.right) : null
      if (odd) {
        r = ctx.program.emit(Math.abs(odd.p) % 2 === 1 ? OP_RPOW_ODD : OP_RPOW_EVEN, l, rr)
        break
      }
      const op = expr.op === '+' ? OP_ADD : expr.op === '-' ? OP_SUB : expr.op === '*' ? OP_MUL : expr.op === '/' ? OP_DIV : OP_POW
      r = ctx.program.emit(op, l, rr)
      break
    }
    case 'call':
      r = programCall(expr, bound, ctx)
      break
  }
  if (top) ctx.seen.set(k, r)
  return r
}

// A structural key per Expr node, memoised; -0 and 0 differ (x*0 and x*-0 do).
function structuralKeys(): (e: Expr) => string {
  const memo = new Map<Expr, string>()
  const key = (e: Expr): string => {
    const known = memo.get(e)
    if (known !== undefined) return known
    let k: string
    switch (e.kind) {
      case 'num':
        k = Object.is(e.value, -0) ? '#-0' : `#${e.value}`
        break
      case 'var':
        k = e.name
        break
      case 'unary':
        k = `-(${key(e.arg)})`
        break
      case 'binary':
        k = `(${key(e.left)}${e.op}${key(e.right)})`
        break
      case 'call':
        k = `${e.name}(${e.args.map(key).join(',')})`
        break
    }
    memo.set(e, k)
    return k
  }
  return key
}

export function compileMany(exprs: readonly Expr[], vars: readonly string[], scope: MathScope): CompiledMany {
  const env = bindVars(vars)
  const program = new ProgramBuilder(vars.length)
  const ctx: ProgramCtx = { scope, program, stack: [], top: env.bound, key: structuralKeys(), seen: new Map() }
  const outputs = Int32Array.from(exprs.map((e) => programNode(e, env.bound, ctx)))
  const code = Int32Array.from(program.code)
  const reg = Float64Array.from(program.initial)
  const paramRegs = Int32Array.from(program.params.map(([r]) => r))
  const paramIndex = Int32Array.from(program.params.map(([, i]) => i))
  const values = scope.params.values
  const inputs = vars.length
  const scratch: number[] = []
  const run = (out: Float64Array, a?: number, b?: number, c?: number): Float64Array => {
    if (inputs > 0) reg[0] = a as number
    if (inputs > 1) reg[1] = b as number
    if (inputs > 2) reg[2] = c as number
    for (let i = 0; i < paramRegs.length; i++) reg[paramRegs[i]] = values[paramIndex[i]]
    for (let pc = 0; pc < code.length; pc += WIDTH) {
      const d = code[pc + 1]
      const x = code[pc + 2]
      const y = code[pc + 3]
      switch (code[pc]) {
        case OP_ADD:
          reg[d] = reg[x] + reg[y]
          break
        case OP_SUB:
          reg[d] = reg[x] - reg[y]
          break
        case OP_MUL:
          reg[d] = reg[x] * reg[y]
          break
        case OP_DIV:
          reg[d] = reg[x] / reg[y]
          break
        case OP_POW:
          reg[d] = Math.pow(reg[x], reg[y])
          break
        case OP_NEG:
          reg[d] = -reg[x]
          break
        case OP_SIN:
          reg[d] = Math.sin(reg[x])
          break
        case OP_COS:
          reg[d] = Math.cos(reg[x])
          break
        case OP_TAN:
          reg[d] = Math.tan(reg[x])
          break
        case OP_SQRT:
          reg[d] = Math.sqrt(reg[x])
          break
        case OP_ABS:
          reg[d] = Math.abs(reg[x])
          break
        case OP_EXP:
          reg[d] = Math.exp(reg[x])
          break
        case OP_LN:
          reg[d] = Math.log(reg[x])
          break
        case OP_ATAN2:
          reg[d] = Math.atan2(reg[x], reg[y])
          break
        case OP_MIN:
          reg[d] = Math.min(reg[x], reg[y])
          break
        case OP_MAX:
          reg[d] = Math.max(reg[x], reg[y])
          break
        case OP_CALL1:
          reg[d] = UNARY_TABLE[y](reg[x])
          break
        case OP_CALL2:
          reg[d] = BINARY_TABLE[code[pc + 4]](reg[x], reg[y])
          break
        case OP_HYPOT2:
          reg[d] = Math.hypot(reg[x], reg[y])
          break
        case OP_HYPOT3:
          reg[d] = Math.hypot(reg[x], reg[y], reg[code[pc + 4]])
          break
        case OP_COPY:
          reg[d] = reg[x]
          break
        case OP_RPOW_ODD:
          reg[d] = realOddPow(reg[x], reg[y], true)
          break
        case OP_RPOW_EVEN:
          reg[d] = realOddPow(reg[x], reg[y], false)
          break
        case OP_PICK:
          reg[d] = pick(reg[x], reg[y], reg[code[pc + 4]])
          break
        case OP_HYPOTN: {
          // Math.hypot over the block of y registers starting at x.
          scratch.length = y
          for (let i = 0; i < y; i++) scratch[i] = reg[x + i]
          reg[d] = Math.hypot(...scratch)
          break
        }
      }
    }
    for (let i = 0; i < outputs.length; i++) out[i] = reg[outputs[i]]
    return out
  }
  return Object.assign(run, { instructions: code.length / WIDTH })
}

export function compileVector(exprs: readonly [Expr, Expr, Expr], vars: readonly string[], scope: MathScope): CompiledVec {
  const env = bindVars(vars)
  const ctx: Ctx = { scope, slots: vars.length, stack: [] }
  const [nx, ny, nz] = exprs.map((e) => compileNode(e, env, ctx))
  const frame = new Float64Array(Math.max(ctx.slots, 1))
  return (out, a, b, c) => {
    if (vars.length > 0) frame[0] = a as number
    if (vars.length > 1) frame[1] = b as number
    if (vars.length > 2) frame[2] = c as number
    out[0] = nx(frame)
    out[1] = ny(frame)
    out[2] = nz(frame)
    return out
  }
}

// Each user function's free names (its body's, minus its own parameters,
// followed through the functions it uses), once per scope: nested
// definitions are walked once each, not once per call site, which would be
// exponential in the nesting depth.
const FUNCTION_FREE = new WeakMap<MathScope, Map<string, ReadonlySet<string>>>()
const NONE: ReadonlySet<string> = new Set()

// The free variables of `expr`, followed through the user functions and
// constants it uses. `bound` removes the top level's own bound names only: a
// function body's free names stay free (lexical scope), which is what lets
// the kernel find every parameter a statement reads. `pi` and `e` are left
// out unless the scope defines them. Survives a cycle (compile reports it).
export function freeVariablesDeep(expr: Expr, scope: MathScope, bound: ReadonlySet<string> = new Set()): Set<string> {
  let cache = FUNCTION_FREE.get(scope)
  if (!cache) {
    cache = new Map()
    FUNCTION_FREE.set(scope, cache)
  }
  const functionCache = cache
  const visiting = new Set<string>()
  // Cycles cut so far: a function computed while one was cut may be missing
  // names, so it is not cached (compile reports the cycle).
  let cut = 0

  function freeOf(name: string, fn: MathFunction): ReadonlySet<string> {
    const known = functionCache.get(name)
    if (known) return known
    if (visiting.has(name)) {
      cut++
      return NONE
    }
    visiting.add(name)
    const before = cut
    const names = new Set<string>()
    const own = new Set(fn.params)
    const bodies = isVectorBody(fn.body) ? fn.body : [fn.body]
    for (const body of bodies) walk(body, own, names)
    visiting.delete(name)
    if (cut === before) functionCache.set(name, names)
    return names
  }

  function follow(name: string, fn: MathFunction, into: Set<string>) {
    for (const n of freeOf(name, fn)) into.add(n)
  }

  function walk(e: Expr, local: ReadonlySet<string>, into: Set<string>) {
    switch (e.kind) {
      case 'num':
        return
      case 'var': {
        if (local.has(e.name)) return
        const fn = scope.functions.get(e.name)
        if (fn && !scope.params.index.has(e.name)) {
          follow(e.name, fn, into)
          return
        }
        if (!fn && (e.name === 'pi' || e.name === 'e' || e.name === 'inf') && !scope.params.index.has(e.name)) return
        into.add(e.name)
        return
      }
      case 'unary':
        walk(e.arg, local, into)
        return
      case 'binary':
        walk(e.left, local, into)
        walk(e.right, local, into)
        return
      case 'call': {
        // __prime's first argument names a function, not a variable.
        if (e.name === '__prime') {
          const target = e.args[0]
          const fn = target?.kind === 'var' ? scope.functions.get(target.name) : undefined
          if (target?.kind === 'var' && fn) follow(target.name, fn, into)
          for (const arg of e.args.slice(2)) walk(arg, local, into)
          return
        }
        for (const arg of e.args) walk(arg, local, into)
        const fn = scope.functions.get(e.name)
        if (fn && !(fn.params.length === 0 && e.args.length === 1)) {
          follow(e.name, fn, into)
          return
        }
        // A name used as a factor, x(x + 1), is read like a variable.
        if (e.args.length === 1 && !BUILTINS.has(e.name) && !isReserved(e.name)) walk({ kind: 'var', name: e.name }, local, into)
        return
      }
    }
  }

  const found = new Set<string>()
  walk(expr, bound, found)
  return found
}
