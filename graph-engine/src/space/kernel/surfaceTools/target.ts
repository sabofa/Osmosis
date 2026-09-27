// Targets, points and domains for the calculus of a surface (S4b, B1).
//
// A target is a defined function's name ("f", for f(x, y) = … or
// F(x, y, z) = …) or an inline expression, read as a function of x and y, or
// of x, y and z when it reads z. It resolves once per statement to an
// expression over the bound names $0, $1 (, $2) — renamed so a parameter a
// user function reads is never captured (common.ts) — whose partials are
// symbolic (math/diff), never finite differences.
//
// A point is a list of expressions, so it may read parameters: that is how a
// slider moves a tangent plane. The domain is "over <rect>" when the
// statement gives one, else the box's x/y range (@bounds3d, else [-5, 5]^2).

import type { Expr } from '../../../parser/types'
import { compileScalar, freeVariablesDeep, type CompiledFn } from '../../../math/compile'
import { diff } from '../../../math/diff'
import { call, variable } from '../../../math/expr'
import { isVectorBody, type MathScope } from '../../../math/scope'
import { simplify } from '../../../math/simplify'
import type { GraphConfig } from '../../../parser/config'
import type { RectOver } from '../../grammar/keywords/surfaceTools'
import type { Range } from '../../scene/types'
import { boundNames, boxX, boxY, constant, type Reads, renameBound } from '../common'

const XY = ['x', 'y'] as const
const XYZ = ['x', 'y', 'z'] as const

export interface Target {
  arity: 2 | 3
  // The body over $0, $1 (, $2).
  body: Expr
  // The bound names, $0, $1 (, $2).
  vars: string[]
}

// Whether a target is a function of two variables or three, without
// compiling it: a defined function by its parameter count, an expression by
// whether it reads z (followed through user functions). S4a's contour:
// dispatcher uses this to send a two-variable target to contourCurves.
export function targetArity(target: Expr, scope: MathScope): 2 | 3 {
  if (target.kind === 'var' && !scope.params.index.has(target.name)) {
    const fn = scope.functions.get(target.name)
    if (fn && fn.params.length === 3) return 3
    if (fn && fn.params.length > 0) return 2
  }
  return freeVariablesDeep(target, scope).has('z') ? 3 : 2
}

// Resolves a target and records what it reads. `keyword` names the statement
// in a refusal.
export function resolveTarget(target: Expr, scope: MathScope, reads: Reads, keyword: string): Target {
  let body = target
  if (target.kind === 'var' && !scope.params.index.has(target.name)) {
    const fn = scope.functions.get(target.name)
    if (fn && isVectorBody(fn.body)) {
      throw new Error(`"${target.name}" is vector-valued — ${keyword}: needs a scalar function of x and y`)
    }
    if (fn && fn.params.length === 1) {
      throw new Error(`"${target.name}" is a function of one variable — ${keyword}: needs a function of x and y, e.g. "${target.name}(x, y) = …"`)
    }
    if (fn && fn.params.length > 3) {
      throw new Error(`"${target.name}" takes ${fn.params.length} variables — ${keyword}: needs a function of x and y (or of x, y and z)`)
    }
    if (fn && fn.params.length >= 2) body = call(target.name, ...(fn.params.length === 2 ? XY : XYZ).map((v) => variable(v)))
  }
  const arity = targetArity(target, scope)
  const names = arity === 2 ? XY : XYZ
  reads.add(body, [...names])
  return { arity, body: renameBound(body, names), vars: boundNames(arity) }
}

// d(body)/d(bound i), simplified.
export function partialOf(body: Expr, i: number, scope: MathScope): Expr {
  return simplify(diff(body, `$${i}`, scope))
}

export function compileOver(expr: Expr, target: Target, scope: MathScope): CompiledFn {
  return compileScalar(expr, target.vars, scope)
}

// f, its gradient and its Hessian, compiled, for a two-variable target.
export interface Surface2 {
  f: CompiledFn
  fx: CompiledFn
  fy: CompiledFn
  fxx: CompiledFn
  fxy: CompiledFn
  fyy: CompiledFn
  // The symbolic partials, for composing (a trace, a path).
  dx: Expr
  dy: Expr
}

export function surface2(target: Target, scope: MathScope): Surface2 {
  const dx = partialOf(target.body, 0, scope)
  const dy = partialOf(target.body, 1, scope)
  const c = (e: Expr) => compileOver(e, target, scope)
  return {
    f: c(target.body),
    fx: c(dx),
    fy: c(dy),
    fxx: c(partialOf(dx, 0, scope)),
    fxy: c(partialOf(dx, 1, scope)),
    fyy: c(partialOf(dy, 1, scope)),
    dx,
    dy,
  }
}

// F and its gradient, for a three-variable target.
export interface Surface3 {
  F: CompiledFn
  grad: [CompiledFn, CompiledFn, CompiledFn]
  // d/dx_i d/dx_j, row-major, for Newton on a Lagrange system.
  hessian: CompiledFn[][]
}

export function surface3(target: Target, scope: MathScope): Surface3 {
  const d = [0, 1, 2].map((i) => partialOf(target.body, i, scope))
  const c = (e: Expr) => compileOver(e, target, scope)
  return {
    F: c(target.body),
    grad: [c(d[0]), c(d[1]), c(d[2])],
    hessian: [0, 1, 2].map((i) => [0, 1, 2].map((j) => c(partialOf(d[i], j, scope)))),
  }
}

// A refusal when a statement's target has the wrong number of variables.
export function requireArity(target: Target, arity: 2 | 3, keyword: string): void {
  if (target.arity === arity) return
  if (arity === 2) throw new Error(`${keyword}: needs a function of x and y, and this one reads z`)
  throw new Error(`${keyword}: needs a function of x, y and z here, and this one does not read z`)
}

// Point coordinates, compiled; each may read parameters.
export function preparePoint(exprs: readonly Expr[], scope: MathScope, reads: Reads): () => number[] {
  const fns = exprs.map((e) => {
    reads.add(e)
    return constant(e, scope)
  })
  return () => fns.map((f) => f())
}

export interface Rect {
  x: Range
  y: Range
}

// The statement's domain: its "over <rect>", else the box's x/y range.
export function prepareDomain(over: RectOver | null, config: GraphConfig, scope: MathScope, reads: Reads): () => Rect {
  if (!over) return () => ({ x: boxX(config), y: boxY(config) })
  const [x0, x1, y0, y1] = [over.x.from, over.x.to, over.y.from, over.y.to].map((e) => {
    reads.add(e)
    return constant(e, scope)
  })
  return () => {
    const rect = { x: { min: x0(), max: x1() }, y: { min: y0(), max: y1() } }
    for (const axis of ['x', 'y'] as const) {
      const r = rect[axis]
      if (!(r.max > r.min)) throw new Error(`the domain's ${axis} range [${r.min}, ${r.max}] is empty — write "over x in [a, b], y in [c, d]" with a < b and c < d`)
    }
    return rect
  }
}
