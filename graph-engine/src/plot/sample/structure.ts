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
// parameters, so a pole inside f is found where f(x) is called; a binder's body
// is never walked, because it binds a name no generator could use (its bounds are
// outside it and are walked).
//
// Each generator says where it came from. A SEAM is a condition the author wrote
// (a piecewise or domain condition): the curve is built to change there, so a
// jump at a seam is the author's, not a defect. A NATURAL spot is the function's
// own domain, pole or step. When one expression is both, the seam wins.
//
// The walk does not validate the expression: a call with the wrong number of
// arguments gets no rule, and the compile is left to say so. The one thing it can
// throw is the compile's own refusal of a derivative (one that is too large, or of
// a function that is not there), from expanding it; the sampler compiles the curve
// first and reports that refusal before it walks.

import { builtinArity, freeVariablesDeep } from '../../math/compile'
import { add, call, div, mul, num, sub, substitute } from '../../math/expr'
import { expandPrime } from '../../math/prime'
import { BINDERS, comparisonOp, isReserved } from '../../math/reserved'
import { isVectorBody, type MathScope } from '../../math/scope'
import type { Expr } from '../../parser/types'

export type Origin = 'seam' | 'natural'
export interface Generator {
  expr: Expr
  origin: Origin
  why: string
}

// How many user functions (or derivatives) deep a walk goes, and how many it
// expands in all. The depth cap alone bounds a chain, not the work: a function
// that calls itself twice (fib(n) = fib(n - 1) + fib(n - 2)) is two branches at
// every level of it. The compile refuses a function that calls itself, but a
// caller is free to walk before it compiles, and a walk must not hang on a
// definition the author is still typing. Past either cap the call is walked by its
// arguments alone, so the walk ends and the compile's own error stays the report.
const MAX_INLINE_DEPTH = 32
const MAX_EXPANSIONS = 4096

type Emit = (expr: Expr, origin: Origin, why: string) => void
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
  if (comparisonOp(name) && argc === 2) return ([a, b], _k, emit) => emit(sub(a, b), 'seam', 'condition')
  if (name === '__factorial' && argc === 1) return ([u], k, emit) => emit(call('sin', mul(num(k), add(u, num(1)))), 'natural', 'factorial pole')
  return null
}

// The generators of `expr` over `param`, in the order the walk finds them. A
// generator that does not read `param` (through user functions and constants) is
// no trouble spot of this curve and is dropped; duplicates are one.
export function troubleGenerators(expr: Expr, param: string, scope: MathScope): Generator[] {
  const k = scope.angle === 'degrees' ? 180 : Math.PI
  const found = new Map<string, Generator>()

  const emit: Emit = (generator, origin, why) => {
    const key = JSON.stringify(generator)
    const known = found.get(key)
    if (known && (known.origin === 'seam' || origin !== 'seam')) return
    if (!freeVariablesDeep(generator, scope).has(param)) return
    found.set(key, { expr: generator, origin, why })
  }

  let expansions = 0
  const mayExpand = (depth: number) => depth < MAX_INLINE_DEPTH && ++expansions <= MAX_EXPANSIONS

  // `depth` is how many user functions and derivatives the walk is inside.
  function walk(e: Expr, depth: number): void {
    switch (e.kind) {
      case 'num':
      case 'var':
        return
      case 'unary':
        walk(e.arg, depth)
        return
      case 'binary':
        if (e.op === '/') emit(e.right, 'natural', 'denominator')
        else if (e.op === '^' && !isPositiveWhole(e.right)) emit(e.left, 'natural', 'power base')
        walk(e.left, depth)
        walk(e.right, depth)
        return
      case 'call':
        walkCall(e, depth)
        return
    }
  }

  function walkCall(e: Expr & { kind: 'call' }, depth: number): void {
    const { name, args } = e
    if (name === '__prime') {
      if (mayExpand(depth)) walk(expandPrime(e, scope), depth + 1)
      return
    }
    if (BINDERS.has(name)) {
      // (variable, lo, hi, body): the bounds are outside the binding, the body is inside it.
      for (const bound of args.slice(1, 3)) walk(bound, depth)
      return
    }
    if (isReserved(name)) {
      reservedRule(name, args.length)?.(args, k, emit)
      for (const arg of args) walk(arg, depth)
      return
    }
    // A user function shadows a built-in of its name, as in the compile; a constant
    // called with one argument is a product there, not a call.
    const fn = scope.functions.get(name)
    if (fn && !(fn.params.length === 0 && args.length === 1)) {
      if (!isVectorBody(fn.body) && args.length === fn.params.length && mayExpand(depth)) {
        walk(substitute(fn.body, new Map(fn.params.map((p, i) => [p, args[i]] as const))), depth + 1)
      } else {
        for (const arg of args) walk(arg, depth)
      }
      return
    }
    const arity = builtinArity(name)
    if (arity && args.length >= arity.min && args.length <= arity.max) BUILTIN_RULES.get(name)?.(args, k, emit)
    for (const arg of args) walk(arg, depth)
  }

  walk(expr, 0)
  return [...found.values()]
}
