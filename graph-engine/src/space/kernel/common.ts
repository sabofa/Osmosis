// Helpers every builder shares: bound variables, what a statement reads,
// resolution and the triangle budget, line styles and colour scales.

import type { GraphConfig } from '../../parser/config'
import type { Expr, Statement } from '../../parser/types'
import { compileScalar, freeVariablesDeep, type CompiledFn } from '../../math/compile'
import { renameVars } from '../../math/expr'
import type { MathScope } from '../../math/scope'
import type { ColormapClause } from '../grammar/types'
import { robustRange } from '../scene/extent'
import type { ColorScale, ColorSpec, LineStyle, Range } from '../scene/types'

// A statement's own bound variables (t, or u and v, or x and y) are renamed
// to names no author can write before anything is differentiated: diff
// inlines a user function's body into the statement, and a parameter or
// constant that body reads must not be captured by a bound variable of the
// same name. Compiled, the renamed expression means exactly what the
// original does.
export function boundNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `$${i}`)
}

export function renameBound(expr: Expr, names: readonly string[]): Expr {
  const map = new Map<string, string>()
  names.forEach((name, i) => map.set(name, `$${i}`))
  return renameVars(expr, map)
}

// Collects the free names of several expressions, each with its own bound
// variables, followed through user functions.
export class Reads {
  readonly names = new Set<string>()
  private readonly scope: MathScope

  constructor(scope: MathScope) {
    this.scope = scope
  }

  add(expr: Expr | null, bound: readonly string[] = []): this {
    if (expr) for (const name of freeVariablesDeep(expr, this.scope, new Set(bound))) this.names.add(name)
    return this
  }
}

export function constant(expr: Expr, scope: MathScope): CompiledFn {
  return compileScalar(expr, [], scope)
}

// res: wins, then @resolution, then the form's default.
export function resolution(res: number | null, config: GraphConfig, fallback: number): number {
  return res ?? config.space.resolution ?? fallback
}

export const MAX_TRIANGLES = 1_000_000

export function checkBudget(triangles: number, res: number): void {
  if (triangles > MAX_TRIANGLES) {
    throw new Error(
      `res ${res} would make ${triangles.toLocaleString('en-US')} triangles, over the ${MAX_TRIANGLES.toLocaleString('en-US')} limit — lower the resolution`
    )
  }
}

// The x and y extent a form samples when its statement does not say: the
// author's @bounds3d, else [-5, 5] (v1's default domain).
export function boxX(config: GraphConfig): Range {
  return config.space.bounds.x ?? { min: -5, max: 5 }
}

export function boxY(config: GraphConfig): Range {
  return config.space.bounds.y ?? { min: -5, max: 5 }
}

export const CURVE_WIDTH = 2.5
export const SEGMENT_WIDTH = 2
export const DASH: readonly number[] = [6, 4]

export function lineStyle(color: ColorSpec, width: number, dashed: boolean): LineStyle {
  return { color, width, dash: dashed ? DASH : null, hidden: 'dashed' }
}

const HEIGHT: ColormapClause = { by: { kind: 'height' }, map: null, diverging: false }
const NONE: ColormapClause = { by: { kind: 'none' }, map: null, diverging: false }

// SP8: colormap defaults to height for z = f and to none when color: is
// given; a parametric surface is flat unless its style says otherwise.
export function surfaceColormap(statement: Statement): ColormapClause {
  const clause = statement.kind === 'space' && statement.form.form === 'surface' ? statement.form.style.colormap : null
  return clause ?? (statement.color ? NONE : HEIGHT)
}

export function parametricColormap(statement: Statement): ColormapClause {
  return statement.kind === 'space' && statement.form.form === 'parametricSurface' ? (statement.form.style.colormap ?? NONE) : NONE
}

// A colour scale over `values`. Height is sequential unless the statement
// says diverging; an expression diverges when its range straddles zero and no
// sequential map was named ("colormap: x map viridis" stays viridis). A
// diverging scale is symmetric about zero on the balance map. @bounds3d z, if
// set, is a height scale's domain. A zero-width domain is widened by 1/2 each
// way so a flat surface still maps to one colour.
export function colorScale(clause: ColormapClause, values: Float64Array, config: GraphConfig, id: number): ColorScale {
  const height = clause.by.kind === 'height'
  let domain: Range = (height ? config.space.bounds.z : null) ?? robustRange(values) ?? { min: 0, max: 1 }
  // An expression diverges on its own only when no sequential map was named.
  const mapFree = clause.map === null || clause.map === 'balance'
  const diverging = clause.diverging || (!height && mapFree && domain.min < 0 && domain.max > 0)
  if (diverging) {
    const m = Math.max(Math.abs(domain.min), Math.abs(domain.max))
    domain = { min: -m, max: m }
  }
  if (!(domain.max > domain.min)) domain = { min: domain.min - 0.5, max: domain.max + 0.5 }
  return {
    id,
    title: clause.by.kind === 'expr' ? clause.by.text : 'height',
    map: diverging ? 'balance' : (clause.map ?? config.space.colormap),
    domain,
    diverging,
  }
}

// calc P1: an "if" clause the old shape cannot say (and, or, !=, a condition on
// another variable, an if on an implicit or a region line) rides on the
// statement as `where`, in reserved calls (math/reserved.ts). Space does not
// read it yet, and drawing the shape without it would be a wrong picture, so a
// builder that takes one of these kinds refuses a non-null `where`: a line
// error, through the builder's own error path.
export const WHERE_REFUSAL = "this condition isn't supported in a 3D scene yet"

export function refuseWhere(statement: Statement): void {
  switch (statement.kind) {
    case 'explicit':
    case 'implicit':
    case 'region':
    case 'regionChain':
      if (statement.where) throw new Error(WHERE_REFUSAL)
  }
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
