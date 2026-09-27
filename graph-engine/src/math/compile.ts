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
// no recompile), a user constant, a user function, `pi` or `e`.
//
// A user function's body sees its own parameters, the spec's parameters and
// constants, never the caller's variables (lexical scope, as v1's evaluator).
// There is no `new Function`: code generation stays out, for safety and
// determinism (SP2).
//
// parser/evalExpr.ts, the 2D evaluator, is untouched.

import type { Expr } from '../parser/types'
import { isVectorBody, type MathFunction, type MathScope } from './scope'

// A compile-time refusal. `names` carries the offending name(s): the unknown
// variable, the function called with the wrong arity, or both ends of a cycle.
export class CompileError extends Error {
  readonly names: readonly string[]

  constructor(message: string, names: readonly string[]) {
    super(message)
    this.name = 'CompileError'
    this.names = names
  }
}

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

// min, max and hypot: two or more arguments, folded without an array.
function variadic(pair: (x: number, y: number) => number, finish: (v: number) => number = (v) => v, lift: (v: number) => number = (v) => v): Builtin {
  return {
    min: 2,
    max: Infinity,
    make: (args) => {
      if (args.length === 2) {
        const [a, b] = args
        return (f) => finish(pair(lift(a(f)), lift(b(f))))
      }
      if (args.length === 3) {
        const [a, b, c] = args
        return (f) => finish(pair(pair(lift(a(f)), lift(b(f))), lift(c(f))))
      }
      return (f) => {
        let acc = lift(args[0](f))
        for (let i = 1; i < args.length; i++) acc = pair(acc, lift(args[i](f)))
        return finish(acc)
      }
    },
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
  // hypot(a, b, c) = sqrt(a^2 + b^2 + c^2), folded as a running sum of squares.
  ['hypot', variadic((x, y) => x + y, Math.sqrt, (v) => v * v)],
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
  throw new CompileError(`Unknown variable "${name}"`, [name])
}

function compileCall(expr: Expr & { kind: 'call' }, env: Env, ctx: Ctx): Node {
  const { name } = expr
  const fn = ctx.scope.functions.get(name)
  if (fn) {
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
  if (!builtin) throw new CompileError(`Unknown function "${name}"`, [name])
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
    case 'binary':
      return binaryNode(expr.op, compileNode(expr.left, env, ctx), compileNode(expr.right, env, ctx), ctx.scope.params.values)
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

// The free variables of `expr`, followed through the user functions and
// constants it uses. `bound` removes the top level's own bound names only: a
// function body's free names stay free (lexical scope), which is what lets
// the kernel find every parameter a statement reads. `pi` and `e` are left
// out unless the scope defines them. Survives a cycle (compile reports it).
export function freeVariablesDeep(expr: Expr, scope: MathScope, bound: ReadonlySet<string> = new Set()): Set<string> {
  const found = new Set<string>()
  const visiting = new Set<string>()

  function followFunction(name: string, fn: MathFunction) {
    if (visiting.has(name)) return
    visiting.add(name)
    const own = new Set(fn.params)
    const bodies = isVectorBody(fn.body) ? fn.body : [fn.body]
    for (const body of bodies) walk(body, own)
    visiting.delete(name)
  }

  function walk(e: Expr, local: ReadonlySet<string>) {
    switch (e.kind) {
      case 'num':
        return
      case 'var': {
        if (local.has(e.name)) return
        const fn = scope.functions.get(e.name)
        if (fn && !scope.params.index.has(e.name)) {
          followFunction(e.name, fn)
          return
        }
        if (!fn && (e.name === 'pi' || e.name === 'e') && !scope.params.index.has(e.name)) return
        found.add(e.name)
        return
      }
      case 'unary':
        walk(e.arg, local)
        return
      case 'binary':
        walk(e.left, local)
        walk(e.right, local)
        return
      case 'call': {
        for (const arg of e.args) walk(arg, local)
        const fn = scope.functions.get(e.name)
        if (fn) followFunction(e.name, fn)
        return
      }
    }
  }

  walk(expr, bound)
  return found
}
