// Targets (S5): what a volume or a Riemann sum integrates. A target is a
// defined function of two variables written by its name ("f"), or an
// expression in x and y — and in r and theta over a polar region, where x and
// y are r cos(theta) and r sin(theta), as on a polar surface (S1).

import type { Expr } from '../../../parser/types'
import { compileScalar, paramCallsAsProducts } from '../../../math/compile'
import { call, mul, substitute, variable } from '../../../math/expr'
import type { MathScope } from '../../../math/scope'
import type { Target } from '../../grammar/keywords/integrals'
import type { Reads } from '../common'

// The target as an expression in x and y: a bare function name becomes its
// call f(x, y). A function of any other number of variables is refused.
export function targetExpr(target: Target, scope: MathScope): Expr {
  const e = target.expr
  if (e.kind !== 'var' || scope.params.index.has(e.name)) return e
  const fn = scope.functions.get(e.name)
  if (!fn || fn.params.length === 0) return e
  if (fn.params.length !== 2) {
    throw new Error(`"${e.name}" is a function of ${fn.params.length} variable${fn.params.length === 1 ? '' : 's'} — this needs a function of x and y`)
  }
  return call(e.name, variable('x'), variable('y'))
}

// How a target is written in a readout: a name or a number as it is, anything
// else in parentheses.
export function targetText(target: Target): string {
  return /^([A-Za-z_][A-Za-z0-9_]*|[0-9.]+)$/.test(target.text) ? target.text : `(${target.text})`
}

// The defined function a target names, so a readout can say "f < g" in the
// author's names; null for an expression.
export function targetName(target: Target | null, scope: MathScope): string | null {
  if (!target || target.expr.kind !== 'var') return null
  return (scope.functions.get(target.expr.name)?.params.length ?? 0) > 0 ? target.expr.name : null
}

export const POLAR_XY: ReadonlyMap<string, Expr> = new Map([
  ['x', mul(variable('r'), call('cos', variable('theta')))],
  ['y', mul(variable('r'), call('sin', variable('theta')))],
])

// An expression in x and y over polar coordinates: x and y replaced by
// r cos(theta) and r sin(theta). x(x + 1) is a product, said outright first
// (common.ts's renameBound says why); r and theta stay bound for compile.
export function polarCartesian(expr: Expr, scope: MathScope): Expr {
  return substitute(paramCallsAsProducts(expr, ['x', 'y'], scope), POLAR_XY)
}

// An expression in x and y compiled over a region's own coordinates: (x, y),
// or (r, theta) with x and y substituted (it may also read r and theta).
export function compileOnRegion(expr: Expr, coords: 'cartesian' | 'polar', scope: MathScope, reads: Reads): (a: number, b: number) => number {
  if (coords === 'polar') {
    reads.add(expr, ['x', 'y', 'r', 'theta'])
    const f = compileScalar(polarCartesian(expr, scope), ['r', 'theta'], scope)
    return (a, b) => f(a, b)
  }
  reads.add(expr, ['x', 'y'])
  const f = compileScalar(expr, ['x', 'y'], scope)
  return (a, b) => f(a, b)
}
