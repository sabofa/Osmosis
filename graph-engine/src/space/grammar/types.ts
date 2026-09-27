// The space grammar's statement shapes (K6). parser/types.ts carries one union
// member, { kind: 'space'; form: SpaceForm }, and everything space-specific
// lives here. Style lives inside the form.

import type { Expr } from '../../parser/types'
import type { ColormapName } from '../scene/types'
import type { SurfaceToolForm } from './keywords/surfaceTools'

// "t in [a, b]". Bounds are expressions: they may read parameters, and an
// iterated domain's inner bounds read the outer variable.
export interface ParamRange {
  param: string
  from: Expr
  to: Expr
}

// One condition of an inequality domain, in the shape of the existing
// region / regionChain statements: "left op right", or "low op mid op high"
// with both operators normalised to < or <=.
export type RegionCondition =
  | { kind: 'region'; left: Expr; op: '<' | '<=' | '>' | '>='; right: Expr }
  | { kind: 'regionChain'; low: Expr; lowOp: '<' | '<='; mid: Expr; highOp: '<' | '<='; high: Expr }

// Where z = f(x, y) is drawn (SP2).
//   rect:       "for x in [a, b], y in [c, d]" (constant bounds, either order)
//   iterated:   "over x in [0, 1], y in [x^2, x]" (type I or II: the outer
//               variable's bounds are constant, the inner ones may read it),
//               or "over r in [0, 2], theta in [0, pi]" (polar)
//   inequality: "over x^2 + y^2 <= 4", a conjunction joined by "and" or ","
//   named:      "over R", parsed now and resolved in phase S5
export type Domain =
  | { kind: 'rect'; x: ParamRange; y: ParamRange }
  | { kind: 'iterated'; coords: 'cartesian' | 'polar'; outer: ParamRange; inner: ParamRange }
  | { kind: 'inequality'; conditions: RegionCondition[] }
  | { kind: 'named'; name: string }

// "colormap: height | none | <expr> [map <name>] [diverging]" (SP8).
export interface ColormapClause {
  by: { kind: 'height' } | { kind: 'none' } | { kind: 'expr'; expr: Expr; text: string }
  map: ColormapName | null
  diverging: boolean
}

// The SP8 style clauses. null means "the form's default".
export interface SpaceStyle {
  opacity: number | null
  colormap: ColormapClause | null
  mesh: boolean | null
  res: number | null
  width: number | null
  dashed: boolean
}

export type SpaceForm =
  // "f(x, y) = x^2 - y^2": two or three parameters.
  | { form: 'function'; name: string; params: string[]; body: Expr }
  // "r(t) = <cos t, sin t, t>", "F(x, y, z) = <-y, x, 0>", "u = <1, 2, 3>"
  // (params [] for a vector constant).
  | { form: 'vectorFunction'; name: string; params: string[]; body: [Expr, Expr, Expr] }
  // "z = f(x, y)" with a domain, a style clause, or both.
  | { form: 'surface'; body: Expr; domain: Domain | null; style: SpaceStyle }
  | { form: 'parametricSurface'; fx: Expr; fy: Expr; fz: Expr; u: ParamRange; v: ParamRange; style: SpaceStyle }
  | { form: 'curve'; fx: Expr; fy: Expr; fz: Expr; t: ParamRange; style: SpaceStyle }
  // An equation whose free variables include z, or "implicit: <equation>"
  // (forced). Claimed in S1, built in S4.
  | { form: 'implicitSurface'; left: Expr; right: Expr; forced: boolean; style: SpaceStyle }
  // The calculus of a surface (S4b): path:, trace:, tangent-plane:, gradient:,
  // directional:, critical:, lagrange:.
  | SurfaceToolForm

// What the two hooks return: the parser/types.ts Statement member for space.
// The shared wrapper overwrites color and statementName, as for every line.
export interface SpaceStatement {
  kind: 'space'
  form: SpaceForm
  color: string | null
  statementName: string | null
}

export function spaceStatement(form: SpaceForm): SpaceStatement {
  return { kind: 'space', form, color: null, statementName: null }
}
