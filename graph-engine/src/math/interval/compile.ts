// Compiles an Expr to its interval twin (calc P1b): closures over decorated
// intervals that enclose every value math/compile.ts's compileScalar can give
// over an input box, with a verdict (core.ts). Names resolve exactly as
// compileScalar's do, in the same order, and compileScalar runs first, so the
// compile errors are its own. Nodes and their `out` intervals are allocated once,
// at compile time; evaluation allocates nothing.
//
// A node is { out, run }: `run` runs the node's children and writes `out`. A
// bound variable is an interval its node shares (a leaf), and an inlined user
// function's parameter is the `out` of the argument node it is called with (the
// argument nodes run first), as compile aliases a slot.
//
// Constants. A subtree that reads no bound variable (no input, no loop variable,
// no parameter of the function being inlined) has one value, the scalar compile's,
// so it is that value as a single point and not twins' arithmetic on its parts:
// widening 1/3 by two ulps would shift x^(1/3) at 1e300 by 1e-13 relative, past
// every bound the twins keep. A subtree that reads no @param either is evaluated
// once, here; one that does is evaluated by the scalar compile at call time (a
// parameter is read when called, so a change needs no recompile). Two things are not
// folded: a loop, which is charged to the loop budget (below) wherever it runs, and an
// integral that reads a @param or holds a loop in a bound, which would be a quadrature
// per call (an integral with no variable and no parameter is a number like any other).
//
// The loop budget mirrors compile's. A count of the iterations a nest has been
// charged starts again whenever a loop is entered with none running; a loop inside
// another adds its terms each time it is entered. The twin runs a superset of what
// the scalar runs at any one point of the box (a piecewise piece is run unless its
// condition surely fails, a sum's body once per whole number in a bound that is one
// number), so its count is never below the scalar's, and a loop the twin runs within
// the budget is within it at every point. A loop whose bounds are not one whole
// number, or that passes the budget, answers UNKNOWN, and is never run: the loops
// its body would have charged are unseen, so it leaves the nest's count at infinity,
// and every loop after it in the nest is UNKNOWN too (a function may drop its value,
// and what follows it would otherwise be trusted at points where the scalar is NaN).
//
// Conditions. A comparison, and, or and not give a truth interval: [1, 1] where decided true,
// [0, 0] where decided false, [0, 1] otherwise. A decided answer is never better than its
// operands' verdict (a partial operand is NaN somewhere, and andValue(0, NaN) is NaN), an
// undecided one is at most DEFINED. A piecewise walks its pieces in order, runs only the nodes a
// point of the box can reach, and takes the union of the values it may give; a union of bounds
// that are zeros is sealed to keep the zero-bound invariant (sealZeros).

import type { Expr } from '../../parser/types'
import { builtinArity, builtinShadowError, compileScalar, namesValueIn } from '../compile'
import { CompileError } from '../errors'
import { derivativeFunction, primeFunction } from '../prime'
import { oddRootExponent } from '../rational'
import { BUILTIN_REGISTRY } from '../registry'
import { type ComparisonOp, comparisonOp, isReserved, MAX_TERMS, nameArgument } from '../reserved'
import { isVectorBody, type MathFunction, type MathScope } from '../scope'
import { add, div, mul, neg, powGeneral, powOddRoot, sub } from './arith'
import { CONTINUOUS, copy, DEFINED, hull, isEmpty, type Iv, iv, PARTIAL, set, setBox, setEmpty, setPoint, setUnknown, type Verdict, worst } from './core'
import { gammaOf } from './special'

export type CompiledInterval = (out: Iv, xLo?: number, xHi?: number, yLo?: number, yHi?: number, zLo?: number, zHi?: number) => Iv

const NOOP = () => {}
const INF = Infinity

// The loop budget of the evaluation in progress (shared by every loop of every
// compiled function: one evaluation runs at a time). `used` is what the nest running
// now has been charged and `depth` how many loops of it are running.
const budget = { used: 0, depth: 0 }

interface INode {
  readonly out: Iv
  run: () => void
  // The Expr the node was built from, for the scalar compile of a constant subtree.
  readonly expr: Expr
  // The lowest binding level of a variable this subtree reads from outside it, or
  // INF when it reads none: a subtree with no free variable has one value.
  readonly free: number
  // Whether it reads a @param (so its value is read at call time).
  readonly par: boolean
  // Whether it must not be folded: it holds a loop, or an integral that reads a @param or has a
  // loop in a bound (see the header).
  readonly keep: boolean
  // Whether `out` is already a single value that nothing writes but this node.
  point: boolean
}

interface Binding {
  readonly out: Iv
  // 0 for an input or an inlined function's parameter, one more than the depth of the
  // loops around for a loop variable.
  readonly level: number
}

interface Env {
  readonly vars: ReadonlyMap<string, Binding>
  readonly names: ReadonlySet<string>
  // The highest binding level in the env.
  readonly depth: number
}

interface Ctx {
  readonly scope: MathScope
  // user functions being inlined, outermost first (cycle detection)
  readonly stack: string[]
}

// compileScalar has already refused every malformed call and unknown name, so the shapes
// the builders read hold; a guard says so rather than assuming it.
function shape(ok: boolean, name: string): void {
  if (!ok) throw new CompileError(`"${name}" is malformed`, [name])
}

// ---------------------------------------------------------------------------
// Nodes and constants
// ---------------------------------------------------------------------------

function foldable(n: INode): boolean {
  return n.free === INF && !n.keep
}

// A constant subtree becomes its one value. The node keeps its `out`, so whatever
// aliases it (an inlined parameter) reads the value; only `run` changes.
function settle(n: INode, ctx: Ctx): void {
  if (n.point || !foldable(n)) return
  const f = compileScalar(n.expr, [], ctx.scope)
  const out = n.out
  if (n.par) {
    n.run = () => {
      setPoint(out, f())
    }
  } else {
    setPoint(out, f())
    n.run = NOOP
  }
  n.point = true
}

function leaf(expr: Expr, out: Iv, run: () => void, free: number, par: boolean, point: boolean): INode {
  return { out, run, expr, free, par, keep: false, point }
}

// A node over `kids`, whose `run` `make` builds around the node's own `out`. A node
// that is not itself constant settles the constant kids it has (a node that is constant
// is settled whole by whoever reads it).
function combine(expr: Expr, kids: readonly INode[], ctx: Ctx, make: (out: Iv) => () => void): INode {
  const out = iv()
  let free = INF
  let par = false
  let keep = false
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i]
    if (k.free < free) free = k.free
    if (k.par) par = true
    if (k.keep) keep = true
  }
  const node: INode = { out, run: NOOP, expr, free, par, keep, point: false }
  if (free !== INF || keep) for (let i = 0; i < kids.length; i++) settle(kids[i], ctx)
  node.run = make(out)
  return node
}

function bindVars(vars: ReadonlyMap<string, Binding>, depth: number): Env {
  return { vars, names: new Set(vars.keys()), depth }
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

function varNode(expr: Expr, name: string, env: Env, ctx: Ctx): INode {
  const bound = env.vars.get(name)
  if (bound) return leaf(expr, bound.out, NOOP, bound.level, false, false)

  const index = ctx.scope.params.index.get(name)
  if (index !== undefined) {
    const values = ctx.scope.params.values
    const out = iv()
    return leaf(
      expr,
      out,
      () => {
        setPoint(out, values[index])
      },
      INF,
      true,
      true
    )
  }

  const fn = ctx.scope.functions.get(name)
  if (fn) {
    shape(fn.params.length === 0, name)
    return inline(expr, name, fn, [], ctx)
  }

  if (name === 'pi') return pointNode(expr, Math.PI)
  if (name === 'e') return pointNode(expr, Math.E)
  if (name === 'inf') return pointNode(expr, Infinity)
  throw new CompileError(`Unknown variable "${name}"`, [name])
}

function pointNode(expr: Expr, value: number): INode {
  return leaf(expr, setPoint(iv(), value), NOOP, INF, false, true)
}

// A user function's body inlined: its parameters alias the argument nodes' outputs, which
// run first; its constants and the document's parameters are the ones compile sees. A
// constant is inlined with no bound variables, as compile's inlineBody(name, fn, [], ctx).
function inline(expr: Expr, name: string, fn: MathFunction, args: readonly INode[], ctx: Ctx): INode {
  shape(!ctx.stack.includes(name) && !isVectorBody(fn.body), name)
  const vars = new Map<string, Binding>()
  fn.params.forEach((param, i) => vars.set(param, { out: args[i].out, level: 0 }))
  ctx.stack.push(name)
  const body = build(fn.body as Expr, bindVars(vars, 0), ctx)
  ctx.stack.pop()

  let free = INF
  let par = body.par
  let keep = body.keep
  for (const a of args) {
    if (a.free < free) free = a.free
    if (a.par) par = true
    if (a.keep) keep = true
  }
  const node: INode = { out: body.out, run: NOOP, expr, free, par, keep, point: false }
  // the call is constant when its arguments are and its body holds no loop; either way a
  // body that reads none of its parameters is one value
  if (free !== INF || keep) for (const a of args) settle(a, ctx)
  settle(body, ctx)
  switch (args.length) {
    case 0:
      node.run = () => body.run()
      break
    case 1: {
      const [a0] = args
      node.run = () => {
        a0.run()
        body.run()
      }
      break
    }
    case 2: {
      const [a0, a1] = args
      node.run = () => {
        a0.run()
        a1.run()
        body.run()
      }
      break
    }
    default:
      node.run = () => {
        for (let i = 0; i < args.length; i++) args[i].run()
        body.run()
      }
  }
  return node
}

// ---------------------------------------------------------------------------
// Truth intervals
// ---------------------------------------------------------------------------

// A condition's value: nonzero is true. Surely true when no zero is in it, surely false
// when it is exactly zero; NaN somewhere is the verdict's business.
function surelyTrue(a: Iv): boolean {
  return a.lo > 0 || a.hi < 0
}

function surelyFalse(a: Iv): boolean {
  return a.lo === 0 && a.hi === 0
}

// Writes a truth interval: [1, 1] decided true, [0, 0] decided false, [0, 1] otherwise
// (the zero bounds are +0, the value compareValue and friends give for false). A decided
// answer is the operands' verdict (never better), an undecided one at most DEFINED: it may
// jump.
function truth(out: Iv, isTrue: boolean, isFalse: boolean, v: Verdict): Iv {
  if (isTrue) return set(out, 1, 1, v)
  if (isFalse) return set(out, 0, 0, v)
  return set(out, 0, 1, worst(v, DEFINED))
}

// compareValue over boxes. The decisions read the widened bounds, so they are only ever
// more cautious than the scalar's.
function compare(out: Iv, op: ComparisonOp, a: Iv, b: Iv): void {
  if (isEmpty(a) || isEmpty(b)) {
    setEmpty(out)
    return
  }
  const v = worst(a.v, b.v)
  const same = a.lo === a.hi && b.lo === b.hi && a.lo === b.lo
  switch (op) {
    case '<':
      truth(out, a.hi < b.lo, a.lo >= b.hi, v)
      return
    case '<=':
      truth(out, a.hi <= b.lo, a.lo > b.hi, v)
      return
    case '>':
      truth(out, a.lo > b.hi, a.hi <= b.lo, v)
      return
    case '>=':
      truth(out, a.lo >= b.hi, a.hi < b.lo, v)
      return
    case '=':
      truth(out, same, a.hi < b.lo || b.hi < a.lo, v)
      return
    case '!=':
      truth(out, a.hi < b.lo || b.hi < a.lo, same, v)
      return
  }
}

// andValue and orValue are NaN when either side is: an operand that is NaN everywhere makes
// the answer empty, and one that is NaN somewhere keeps the answer's verdict at its own.
function andOf(out: Iv, a: Iv, b: Iv): void {
  if (isEmpty(a) || isEmpty(b)) {
    setEmpty(out)
    return
  }
  truth(out, surelyTrue(a) && surelyTrue(b), surelyFalse(a) || surelyFalse(b), worst(a.v, b.v))
}

function orOf(out: Iv, a: Iv, b: Iv): void {
  if (isEmpty(a) || isEmpty(b)) {
    setEmpty(out)
    return
  }
  truth(out, surelyTrue(a) || surelyTrue(b), surelyFalse(a) && surelyFalse(b), worst(a.v, b.v))
}

function notOf(out: Iv, a: Iv): void {
  if (isEmpty(a)) {
    setEmpty(out)
    return
  }
  truth(out, surelyFalse(a), surelyTrue(a), a.v)
}

// ---------------------------------------------------------------------------
// Piecewise
// ---------------------------------------------------------------------------

// The pieces in order, as the scalar walks them: the first whose condition holds gives its
// value, a NaN condition on the way gives NaN, none gives the otherwise (NaN with none). On
// a box, a condition that surely fails contributes nothing and is not read past, one that
// surely holds contributes its value and ends the walk, and one that may go either way
// contributes its value and the walk goes on, the result at most DEFINED (it may jump). The
// nodes of a piece the walk does not reach are not run: the scalar does not run them either,
// and a loop in one would be charged to the budget.
function piecewise(out: Iv, conds: readonly INode[], values: readonly INode[], otherwise: INode | null): void {
  out.lo = INF
  out.hi = -INF
  out.v = CONTINUOUS
  // which signed zeros the pieces' bounds are (see sealZeros); local, for a piece may be a piecewise
  let zeros = 0
  let reaches = true
  for (let i = 0; i < conds.length; i++) {
    const c = conds[i]
    c.run()
    const cv = c.out
    // NaN everywhere: every point that gets here is NaN, and nothing past it is read
    if (isEmpty(cv)) {
      out.v = worst(out.v, PARTIAL)
      reaches = false
      break
    }
    // A condition that is NaN somewhere is NaN there, whatever it is elsewhere, so it caps the answer. One that
    // is defined everywhere caps nothing here: a decided one has a single truth value over the whole box, so a
    // jump in its operands (floor(x) < 5 over [1.5, 2.5]) is not a jump of the answer, and one that is not
    // decided makes the answer DEFINED below.
    if (cv.v < DEFINED) out.v = worst(out.v, cv.v)
    if (surelyTrue(cv)) {
      zeros |= join(out, values[i])
      reaches = false
      break
    }
    if (surelyFalse(cv)) continue
    zeros |= join(out, values[i])
    out.v = worst(out.v, DEFINED)
  }
  if (reaches) {
    if (otherwise) zeros |= join(out, otherwise)
    else out.v = worst(out.v, PARTIAL)
  }
  if (isEmpty(out)) out.v = PARTIAL
  else if (zeros === (PLUS | MINUS)) sealZeros(out)
}

const PLUS = 1
const MINUS = 2

// Runs a piece's value node and takes the union with `out`. Returns which signed zeros the piece has
// as a bound (a zero strictly inside it needs no note: it keeps a bound of the union off zero).
function join(out: Iv, node: INode): number {
  node.run()
  const r = node.out
  hull(out, r)
  let zeros = 0
  if (Object.is(r.lo, 0) || Object.is(r.hi, 0)) zeros |= PLUS
  if (Object.is(r.lo, -0) || Object.is(r.hi, -0)) zeros |= MINUS
  return zeros
}

// A bound that is exactly a zero claims that signed zero and no other (the zero-bound invariant
// the twins keep, and 1 / the box, sqrt and atan2 read): Math.min and Math.max order -0 below +0
// and so give the union the right zero when every piece agrees, but a union of the pieces [+0, +0]
// and [-0, 1] is [-0, 1], which says no +0 though the first piece gives one. When both signs are
// attained and a bound is a zero, the bound moves to the nearest double beyond zero (which holds
// both), as stepwise's seal does, unless both bounds are zeros, which are then the pair -0, +0.
function sealZeros(out: Iv): void {
  const lo = out.lo
  const hi = out.hi
  if (lo === 0 && hi === 0) {
    out.lo = -0
    out.hi = 0
  } else if (lo === 0) out.lo = -Number.MIN_VALUE
  else if (hi === 0) out.hi = Number.MIN_VALUE
}

// ---------------------------------------------------------------------------
// Sum and prod
// ---------------------------------------------------------------------------

// A loop the twin does not run: no cheap enclosure, and the loops it would have charged are
// unseen (see the header).
function unknownLoop(out: Iv): void {
  setUnknown(out)
  budget.used = INF
}

// A binder's pieces, as compile's binderParts: its bounds, compiled outside the binding, and its body,
// compiled with the bound name a variable of its own `level`. `free` and `par` are the binder's, as a
// node: the body reads the bound variable and what is outside, and only what is outside is free here.
function binderParts(expr: Expr & { kind: 'call' }, env: Env, ctx: Ctx, what: string) {
  shape(expr.args.length === 4, expr.name)
  const name = nameArgument(expr, what)
  const lo = build(expr.args[1], env, ctx)
  const hi = build(expr.args[2], env, ctx)
  const level = env.depth + 1
  const variable = iv()
  const inner = new Map(env.vars)
  inner.set(name, { out: variable, level })
  const body = build(expr.args[3], bindVars(inner, level), ctx)
  const free = Math.min(lo.free, hi.free, body.free > env.depth ? INF : body.free)
  return { lo, hi, variable, body, free, par: lo.par || hi.par || body.par }
}

function loopNode(expr: Expr & { kind: 'call' }, env: Env, ctx: Ctx, product: boolean): INode {
  const { lo, hi, variable: k, body, free, par } = binderParts(expr, env, ctx, 'index')
  const out = iv()
  const identity = product ? 1 : 0
  const node: INode = { out, run: NOOP, expr, free, par, keep: true, point: false }
  settle(lo, ctx)
  settle(hi, ctx)
  settle(body, ctx)
  // compile's run-time loop, over boxes: the bounds first (a bound may hold a loop that charges
  // the budget), then the checks in the scalar's order, then the body once per whole number.
  node.run = () => {
    lo.run()
    hi.run()
    const a = lo.out
    const b = hi.out
    if (!(a.lo === a.hi && b.lo === b.hi && Number.isSafeInteger(a.lo) && Number.isSafeInteger(b.lo))) {
      unknownLoop(out)
      return
    }
    const terms = b.lo - a.lo + 1
    // NaN at every point, before any charge: nothing is run and nothing is counted
    if (terms > MAX_TERMS) {
      setUnknown(out)
      return
    }
    const v = worst(a.v, b.v)
    if (terms < 1) {
      set(out, identity, identity, v)
      return
    }
    if (budget.depth === 0) budget.used = 0
    // Past the budget the scalar is NaN, at a point whose nest has been charged as much as the
    // twin's; at one that has been charged less it is not, and runs the loop: unknown, and not run.
    if (budget.used + terms > MAX_TERMS) {
      unknownLoop(out)
      return
    }
    budget.used += terms
    budget.depth++
    set(out, identity, identity, v)
    const last = b.lo
    // The scalar's counter starts at the bound itself, so a first value of 0 has the sign of the
    // bound's zero (1 / i differs): a bound box that holds both zeros starts the loop at both.
    k.lo = Math.min(a.lo, a.hi)
    k.hi = Math.max(a.lo, a.hi)
    for (let i = a.lo; i <= last; i++) {
      body.run()
      if (product) mul(out, out, body.out)
      else add(out, out, body.out)
      k.lo = i + 1
      k.hi = i + 1
    }
    budget.depth--
  }
  return node
}

// ---------------------------------------------------------------------------
// The reserved calls
// ---------------------------------------------------------------------------

const ONE = iv(1, 1)

function reservedNode(expr: Expr & { kind: 'call' }, env: Env, ctx: Ctx): INode {
  const { name } = expr
  const args = () => expr.args.map((arg) => build(arg, env, ctx))
  const op = comparisonOp(name)
  if (op) {
    shape(expr.args.length === 2, name)
    const [a, b] = args()
    return combine(expr, [a, b], ctx, (out) => () => {
      a.run()
      b.run()
      compare(out, op, a.out, b.out)
    })
  }
  switch (name) {
    case '__and':
    case '__or': {
      shape(expr.args.length === 2, name)
      const [a, b] = args()
      const of = name === '__and' ? andOf : orOf
      return combine(expr, [a, b], ctx, (out) => () => {
        a.run()
        b.run()
        of(out, a.out, b.out)
      })
    }
    case '__not': {
      shape(expr.args.length === 1, name)
      const [a] = args()
      return combine(expr, [a], ctx, (out) => () => {
        a.run()
        notOf(out, a.out)
      })
    }
    case '__factorial': {
      shape(expr.args.length === 1, name)
      const [a] = args()
      const shifted = iv()
      return combine(expr, [a], ctx, (out) => () => {
        a.run()
        add(shifted, a.out, ONE)
        gammaOf(out, shifted)
      })
    }
    case '__piecewise': {
      shape(expr.args.length >= 2, name)
      const nodes = args()
      const pieces = Math.floor(nodes.length / 2)
      const conds = nodes.filter((_, i) => i < pieces * 2 && i % 2 === 0)
      const values = nodes.filter((_, i) => i < pieces * 2 && i % 2 === 1)
      const otherwise = nodes.length % 2 === 1 ? nodes[nodes.length - 1] : null
      return combine(expr, nodes, ctx, (out) => () => piecewise(out, conds, values, otherwise))
    }
    case '__prime': {
      const { name: fnName, fn, order } = primeFunction(expr, ctx.scope)
      const derivative = derivativeFunction(fnName, fn, order, ctx.scope)
      return inline(expr, fnName, derivative, [build(expr.args[2], env, ctx)], ctx)
    }
    case '__sum':
    case '__prod':
      return loopNode(expr, env, ctx, name === '__prod')
    case '__integral': {
      // No cheap enclosure: a quadrature per call would cost what the sampling the twin exists to
      // save costs, so an integral is UNKNOWN, [-inf, inf]. Only a constant one (no variable, no
      // @param, no loop in a bound) is a number, folded here once like any constant. Its bounds are
      // run (a bound may hold a loop that charges the budget, as in the scalar); the integrand never
      // is: its loops count in a budget of their own, put back after, so they never reach the nest
      // the integral is in, and its value is not wanted. It is built only to say what it reads.
      const { lo, hi, free, par } = binderParts(expr, env, ctx, 'variable of integration')
      const out = iv()
      settle(lo, ctx)
      settle(hi, ctx)
      const run = () => {
        lo.run()
        hi.run()
        setUnknown(out)
      }
      return { out, run, expr, free, par, keep: lo.keep || hi.keep || par, point: false }
    }
  }
  throw new CompileError(`"${name}" is reserved and not supported here`, [name])
}

// compile's compileCall, in its order: a reserved name; a built-in the document's value
// shadows (an error); a user function that is not a constant called with one argument; a
// built-in; a value called with one argument, which is a product.
function callNode(expr: Expr & { kind: 'call' }, env: Env, ctx: Ctx): INode {
  const { name } = expr
  if (isReserved(name)) return reservedNode(expr, env, ctx)
  const shadowed = builtinShadowError(name, ctx.scope)
  if (shadowed) throw shadowed
  const fn = ctx.scope.functions.get(name)
  if (fn && !(fn.params.length === 0 && expr.args.length === 1)) {
    shape(expr.args.length === fn.params.length, name)
    return inline(
      expr,
      name,
      fn,
      expr.args.map((arg) => build(arg, env, ctx)),
      ctx
    )
  }

  const entry = BUILTIN_REGISTRY.get(name)
  if (!entry) {
    shape(expr.args.length === 1 && namesValueIn(name, env.names, ctx.scope), name)
    const value = varNode({ kind: 'var', name }, name, env, ctx)
    const arg = build(expr.args[0], env, ctx)
    return combine(expr, [value, arg], ctx, (out) => () => {
      value.run()
      arg.run()
      mul(out, value.out, arg.out)
    })
  }
  const arity = builtinArity(name)
  shape(arity !== null && expr.args.length >= arity.min && expr.args.length <= arity.max, name)
  const nodes = expr.args.map((arg) => build(arg, env, ctx))
  const twin = entry.twin
  const angle = ctx.scope.angle
  return combine(expr, nodes, ctx, (out) => {
    const inputs = nodes.map((n) => n.out)
    return () => {
      for (let i = 0; i < nodes.length; i++) nodes[i].run()
      twin(out, inputs, angle)
    }
  })
}

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

function build(expr: Expr, env: Env, ctx: Ctx): INode {
  switch (expr.kind) {
    case 'num':
      return pointNode(expr, expr.value)
    case 'var':
      return varNode(expr, expr.name, env, ctx)
    case 'unary': {
      const a = build(expr.arg, env, ctx)
      return combine(expr, [a], ctx, (out) => () => {
        a.run()
        neg(out, a.out)
      })
    }
    case 'binary': {
      // A literal p/q exponent with q odd takes the real root (math/rational.ts). The exponent is
      // made of integer literals, so it is one constant, and the one the scalar computes: the twin
      // reads exactly that number, not a widened enclosure of it.
      if (expr.op === '^') {
        const odd = oddRootExponent(expr.right)
        if (odd) {
          const base = build(expr.left, env, ctx)
          const exponent = build(expr.right, env, ctx)
          settle(exponent, ctx)
          shape(exponent.point, '^')
          const pOdd = Math.abs(odd.p) % 2 === 1
          return combine(expr, [base, exponent], ctx, (out) => () => {
            base.run()
            exponent.run()
            powOddRoot(out, base.out, exponent.out.lo, pOdd)
          })
        }
      }
      const l = build(expr.left, env, ctx)
      const r = build(expr.right, env, ctx)
      switch (expr.op) {
        case '+':
          return combine(expr, [l, r], ctx, (out) => () => {
            l.run()
            r.run()
            add(out, l.out, r.out)
          })
        case '-':
          return combine(expr, [l, r], ctx, (out) => () => {
            l.run()
            r.run()
            sub(out, l.out, r.out)
          })
        case '*':
          return combine(expr, [l, r], ctx, (out) => () => {
            l.run()
            r.run()
            mul(out, l.out, r.out)
          })
        case '/':
          return combine(expr, [l, r], ctx, (out) => () => {
            l.run()
            r.run()
            div(out, l.out, r.out)
          })
        case '^':
          return combine(expr, [l, r], ctx, (out) => () => {
            l.run()
            r.run()
            powGeneral(out, l.out, r.out)
          })
      }
      break
    }
    case 'call':
      return callNode(expr, env, ctx)
  }
  throw new Error('Unreachable expression kind')
}

export function compileInterval(expr: Expr, vars: readonly string[], scope: MathScope): CompiledInterval {
  // the same compile errors, thrown here
  compileScalar(expr, vars, scope)
  if (vars.length > 3) throw new Error(`An interval twin takes at most three variables, got ${vars.length}`)
  const inputs = vars.map(() => iv())
  const bound = new Map<string, Binding>()
  vars.forEach((v, i) => bound.set(v, { out: inputs[i], level: 0 }))
  const ctx: Ctx = { scope, stack: [] }
  const root = build(expr, bindVars(bound, 0), ctx)
  settle(root, ctx)
  const [x, y, z] = inputs
  return (out, xLo = 0, xHi = 0, yLo = 0, yHi = 0, zLo = 0, zHi = 0) => {
    budget.used = 0
    budget.depth = 0
    if (x) setBox(x, xLo, xHi)
    if (y) setBox(y, yLo, yHi)
    if (z) setBox(z, zLo, zHi)
    root.run()
    return copy(out, root.out)
  }
}
