// The structure walk (calc P2; spec "Singularities from the expression's
// structure"). Samples alone cannot find a hole no sample lands on, nor a pole
// between two samples. The expression says where they can be: a denominator
// vanishes, a logarithm's argument reaches 0, a floor's argument is whole, a
// piecewise condition changes its answer. Each of those is an expression whose
// ZERO is a candidate trouble spot, and this walk collects them; locate.ts then
// isolates the zeros in the sampled range with the interval twin, and a later
// stage decides, from samples either side, what each one is. A generator is only
// a candidate: gamma's sin(pi u) is zero at every whole u, and the poles are the
// non-positive ones.
//
// The generators are Exprs, so they compile in the user's own scope: a @param
// or a user function inside one resolves exactly as it does in the curve. Value
// names (constants, @params) stay var nodes for the compile to resolve. A user
// function's body is walked with the call's arguments substituted for its
// parameters, so a pole inside f is found where f(x) is called.
//
// A binder (sum, prod, integral) walks its bounds, which are outside the binding,
// and its body, which is inside it. A body generator that does not read the bound
// name is a generator of the whole (k/x in sum(k = 1 to 5, k/x)). One that reads it
// (x - k in sum(k = 1 to 5, 1/(x - k))) is no expression of the curve until k has a
// value, so a sum or product whose bounds are constants, whole, and at most 64
// terms apart is unrolled: one generator per value of k. Any other binder (an
// integral, bounds that depend on x or a @param, a longer range) cannot say which
// values k takes, and what reads k is dropped; the curve is then left to the
// sampler's own detection there.
//
// Each generator says where it came from. A SEAM is a condition the author wrote
// (a piecewise or domain condition): the curve is built to change there, so a
// jump at a seam is the author's, not a defect. A NATURAL spot is the function's
// own domain, pole or step. When one expression is both, the seam wins. A comparison's
// generator also lists the operators of the comparisons it is the a - b of (`cmps`), so a
// zero that is not an exact double still knows whether the author's conditions include it.
//
// The walk does not validate the expression: a call with the wrong number of
// arguments gets no rule, a binder bound the compile refuses is no constant, and the
// compile is left to say so. The one thing it can throw is the compile's own refusal
// of a derivative (one that is too large, or of a function that is not there), from
// expanding it; the sampler compiles the curve first and reports that refusal before
// it walks.

import { builtinArity, compileScalar, freeVariablesDeep } from '../../math/compile'
import { CompileError } from '../../math/errors'
import { add, call, div, mul, num, sub, substitute, varNames } from '../../math/expr'
import { expandPrime } from '../../math/prime'
import { BINDERS, type ComparisonOp, comparisonOp, isReserved } from '../../math/reserved'
import { isVectorBody, type MathScope } from '../../math/scope'
import type { Expr } from '../../parser/types'
import { STRUCTURE } from './tuning'

export type Origin = 'seam' | 'natural'
export interface Generator {
  expr: Expr
  origin: Origin
  why: string
  // The operators of the comparisons whose a - b this is, each once, in the order found: an
  // operator says which side of a zero the author's condition holds on and whether the zero
  // itself is in it (< against <=), which no sample can tell where the seam is not an exact
  // double (x^2 < 2). {x^2 < 2: 0, x^2 >= 2: 1} is two comparisons of one a - b. A natural spot
  // that shares the expression adds nothing to the list and takes nothing from it. Absent for a
  // generator no comparison produced.
  cmps?: ComparisonOp[]
}

// (The walk's caps, STRUCTURE in tuning.ts: how deep it goes into user functions and derivatives, how many expansions it makes in
// all, and how many terms of a sum or product it unrolls.)

type Emit = (expr: Expr, origin: Origin, why: string, cmp?: ComparisonOp) => void
// A built-in's rule: its own generators from its arguments (already checked to be
// in the built-in's arity). `k` is the angle unit's half turn: Math.PI in radians,
// 180 in degrees, so sin(k u) is zero exactly at whole u in the user's own unit.
type Rule = (args: readonly Expr[], k: number, emit: Emit) => void

// u itself: its zero is the edge (sqrt, ln, sign).
const zeroOfArg = (why: string): Rule => ([u], _k, emit) => emit(u, 'natural', why)
// u - 1 and u + 1: the two ends of [-1, 1] (asin, acos, atanh).
const edges =
  (why: string): Rule =>
  ([u], _k, emit) => {
    emit(sub(u, num(1)), 'natural', why)
    emit(add(u, num(1)), 'natural', why)
  }
// sin(u) or cos(u): zero at the poles of tan, sec, csc, cot.
const trigOfArg =
  (name: 'sin' | 'cos', why: string): Rule =>
  ([u], _k, emit) =>
    emit(call(name, u), 'natural', why)
// sin(k u) or cos(k u): zero at whole u (floor, ceil, gamma) or at the halves (round).
const trigOfTurns =
  (name: 'sin' | 'cos', why: string): Rule =>
  ([u], k, emit) =>
    emit(call(name, mul(num(k), u)), 'natural', why)

const BUILTIN_RULES: ReadonlyMap<string, Rule> = new Map<string, Rule>([
  ['sqrt', zeroOfArg('sqrt domain')],
  ['ln', zeroOfArg('ln domain')],
  [
    'log',
    // log(a) is base 10; log(a, b) is a's log in base b, which needs b > 0 and b != 1.
    ([a, b], _k, emit) => {
      emit(a, 'natural', 'log domain')
      if (b) {
        emit(b, 'natural', 'log base')
        emit(sub(b, num(1)), 'natural', 'log base')
      }
    },
  ],
  // root(n, u): the index comes first, the radicand second.
  ['root', ([, u], _k, emit) => emit(u, 'natural', 'root domain')],
  ['asin', edges('asin edge')],
  ['acos', edges('acos edge')],
  ['atanh', edges('atanh edge')],
  ['acosh', ([u], _k, emit) => emit(sub(u, num(1)), 'natural', 'acosh edge')],
  ['tan', trigOfArg('cos', 'tan pole')],
  ['sec', trigOfArg('cos', 'sec pole')],
  ['csc', trigOfArg('sin', 'csc pole')],
  ['cot', trigOfArg('sin', 'cot pole')],
  ['gamma', trigOfTurns('sin', 'gamma pole')],
  ['floor', trigOfTurns('sin', 'floor step')],
  ['ceil', trigOfTurns('sin', 'ceil step')],
  // round steps at the halves.
  ['round', trigOfTurns('cos', 'round step')],
  ['sign', zeroOfArg('sign step')],
  ['step', zeroOfArg('step edge')],
  [
    'mod',
    ([a, b], k, emit) => {
      emit(b, 'natural', 'mod divisor')
      emit(call('sin', mul(num(k), div(a, b))), 'natural', 'mod step')
    },
  ],
  [
    'atan2',
    ([y, x], _k, emit) => {
      emit(y, 'natural', 'atan2 cut')
      emit(x, 'natural', 'atan2 axis')
    },
  ],
])

// choose, perm, gcd and lcm step at whole arguments, and the twin (an UNKNOWN or
// DEFINED verdict) and the sampler's jump test cover those, so a generator would
// add nothing. They are troubled built-ins with no rule, listed so the coverage
// test stays honest about them.
const NO_RULE = ['choose', 'perm', 'gcd', 'lcm']

// The built-ins with a domain edge, pole or step: every one with a rule, and the four with none.
export const TROUBLE_BUILTINS: ReadonlySet<string> = new Set([...BUILTIN_RULES.keys(), ...NO_RULE])

// The built-ins that are defined and smooth everywhere a real argument is. Written
// out, not derived as the rest of BUILTIN_NAMES, so that a built-in added to the
// kernel fails the coverage test until someone decides which kind it is.
export const SMOOTH_BUILTINS: ReadonlySet<string> = new Set(
  'sin cos atan sinh cosh tanh asinh exp abs min max hypot erf erfc cbrt'.split(' ')
)

const isPositiveWhole = (e: Expr): boolean => e.kind === 'num' && Number.isInteger(e.value) && e.value > 0

// The reserved names that carry a rule of their own. __and, __or, __not and
// __piecewise have none: their conditions and values are walked as arguments.
function reservedRule(name: string, argc: number): Rule | null {
  const op = comparisonOp(name)
  if (op && argc === 2) return ([a, b], _k, emit) => emit(sub(a, b), 'seam', 'condition', op)
  if (name === '__factorial' && argc === 1) return ([u], k, emit) => emit(call('sin', mul(num(k), add(u, num(1)))), 'natural', 'factorial pole')
  return null
}

// Two generators of the same expression as one: the seam's origin and reason win (the first
// seam, if both are), as they always have, and the comparisons are those of both. Whether
// they agree on who owns the zero is for the caller to say (curve.ts), from the sign of a - b
// there: this only keeps them.
export function joinGenerators(a: Generator, b: Generator): Generator {
  const keep = a.origin === 'seam' || b.origin !== 'seam' ? a : b
  const joined: Generator = { expr: keep.expr, origin: keep.origin, why: keep.why }
  const cmps = [...new Set([...(a.cmps ?? []), ...(b.cmps ?? [])])]
  if (cmps.length > 0) joined.cmps = cmps
  return joined
}

// The generators of `expr` over `param`, in the order the walk finds them. A
// generator that does not read `param` (through user functions and constants) is
// no trouble spot of this curve and is dropped; duplicates are one.
//
// `naturals`, when given, is pushed the expression of every NATURAL spot the walk meets, as it meets it and before
// duplicates are joined: a natural spot that has the expression of a seam is joined into it (the seam wins, and the
// generator no longer says the function has a spot there too), and the caller that wants to know whether a seam's zero
// is also a denominator's or a step's needs the spots as they were (curve.ts, sharedWithNatural).
export function troubleGenerators(expr: Expr, param: string, scope: MathScope, naturals?: Expr[]): Generator[] {
  const k = scope.angle === 'degrees' ? 180 : Math.PI
  const found = new Map<string, Generator>()

  const emit: Emit = (generator, origin, why, cmp) => {
    if (!freeVariablesDeep(generator, scope).has(param)) return
    if (origin === 'natural') naturals?.push(generator)
    const key = JSON.stringify(generator)
    const known = found.get(key)
    const g: Generator = cmp ? { expr: generator, origin, why, cmps: [cmp] } : { expr: generator, origin, why }
    found.set(key, known ? joinGenerators(known, g) : g)
  }

  let expansions = 0
  const mayExpand = (depth: number) => depth < STRUCTURE.inlineDepth && ++expansions <= STRUCTURE.expansions

  // `depth` is how many user functions and derivatives the walk is inside; `out`
  // is where the generators found go (`emit`, or a binder's filter in front of it).
  function walk(e: Expr, depth: number, out: Emit): void {
    switch (e.kind) {
      case 'num':
      case 'var':
        return
      case 'unary':
        walk(e.arg, depth, out)
        return
      case 'binary':
        if (e.op === '/') out(e.right, 'natural', 'denominator')
        else if (e.op === '^' && !isPositiveWhole(e.right)) out(e.left, 'natural', 'power base')
        walk(e.left, depth, out)
        walk(e.right, depth, out)
        return
      case 'call':
        walkCall(e, depth, out)
        return
    }
  }

  function walkCall(e: Expr & { kind: 'call' }, depth: number, out: Emit): void {
    const { name, args } = e
    if (name === '__prime') {
      // Past the limit the derivative is not expanded, but what is passed to it is still walked.
      if (mayExpand(depth)) walk(expandPrime(e, scope), depth + 1, out)
      else for (const arg of args.slice(2)) walk(arg, depth, out)
      return
    }
    if (BINDERS.has(name)) {
      walkBinder(e, depth, out)
      return
    }
    if (isReserved(name)) {
      reservedRule(name, args.length)?.(args, k, out)
      for (const arg of args) walk(arg, depth, out)
      return
    }
    // A user function shadows a built-in of its name, as in the compile; a constant
    // called with one argument is a product there, not a call.
    const fn = scope.functions.get(name)
    if (fn && !(fn.params.length === 0 && args.length === 1)) {
      if (!isVectorBody(fn.body) && args.length === fn.params.length && mayExpand(depth)) {
        walk(substitute(fn.body, new Map(fn.params.map((p, i) => [p, args[i]] as const))), depth + 1, out)
      } else {
        for (const arg of args) walk(arg, depth, out)
      }
      return
    }
    const arity = builtinArity(name)
    if (arity && args.length >= arity.min && args.length <= arity.max) BUILTIN_RULES.get(name)?.(args, k, out)
    for (const arg of args) walk(arg, depth, out)
  }

  // sum, prod and integral (variable, lo, hi, body).
  function walkBinder(e: Expr & { kind: 'call' }, depth: number, out: Emit): void {
    const [variable, lo, hi, body] = e.args
    // Not the shape the parser builds: the compile reports it. Walk what is there.
    if (e.args.length !== 4 || variable.kind !== 'var') {
      for (const arg of e.args.slice(1, 3)) walk(arg, depth, out)
      return
    }
    const bound = variable.name
    // The bounds are outside the binding.
    walk(lo, depth, out)
    walk(hi, depth, out)
    // The plot variable bound inside its own body is another variable there: nothing
    // in the body is a function of the curve's.
    if (bound === param) return
    let terms: readonly number[] | null | undefined
    walk(body, depth, (generator, origin, why, cmp) => {
      // Syntactically: a document constant of the bound name is shadowed in the body.
      if (!varNames(generator).has(bound)) {
        out(generator, origin, why, cmp)
        return
      }
      if (e.name === '__integral') return
      if (terms === undefined) terms = unrolledTerms(lo, hi)
      if (terms === null) return
      for (const n of terms) {
        if (++expansions > STRUCTURE.expansions) return
        out(substitute(generator, new Map([[bound, num(n)]])), origin, why, cmp)
      }
    })
  }

  // The values a sum or product's name takes when its bounds are constants and whole
  // and few; null when they are not. Both bounds must read no name (a @param or the
  // plot variable would): the document's constants and pi are fine. Whole means a safe
  // integer, as in the compile's loops: past 2^53 n++ stops changing n. A bound the
  // compile refuses (a call with the wrong arguments) is no constant here either; the
  // curve's own compile reports it.
  function unrolledTerms(lo: Expr, hi: Expr): readonly number[] | null {
    const constant = (bound: Expr): number | null => {
      if (freeVariablesDeep(bound, scope).size > 0) return null
      try {
        const value = compileScalar(bound, [], scope)()
        return Number.isSafeInteger(value) ? value : null
      } catch (err) {
        if (err instanceof CompileError) return null
        throw err
      }
    }
    const first = constant(lo)
    const last = constant(hi)
    if (first === null || last === null || last - first + 1 > STRUCTURE.unrolledTerms) return null
    const terms: number[] = []
    for (let n = first; n <= last; n++) terms.push(n)
    return terms
  }

  walk(expr, 0, emit)
  return [...found.values()]
}
