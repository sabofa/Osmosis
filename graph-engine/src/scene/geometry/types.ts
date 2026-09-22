import type { Vec2 } from '../types'

// The geometry object model (Geometry v2, phase 1 — "the construction core").
//
// Three kinds, and only three: a point, a line and a circle. Every
// construction in this phase either produces or consumes one of them. The
// structural fix over v1 is `line` — v1 had segments as *drawn output* but
// nowhere for "the line through P parallel to A-B" to live as a value, which
// is why the parallel/perpendicular/bisector constructions were missing
// rather than merely unimplemented.
//
// Everything here is exact closed-form arithmetic over Vec2. There is no
// numeric constraint solver anywhere in this layer, by design: an AI tutor
// authors these figures, and a solver that can return a different-but-valid
// figure between runs (or fail with "did not converge") is unusable for that.

// How far a line extends past its two defining points.
//   infinite — the full line; clipped to the view only at render time
//   ray      — starts at `a`, through `b`, on forever
//   segment  — exactly from `a` to `b`
export type LineExtent = 'infinite' | 'ray' | 'segment'

export interface GeometryPoint {
  kind: 'point'
  at: Vec2
}

// A line is stored as its two defining points plus an extent, never as
// (slope, intercept): the two-point form has no vertical-line special case,
// and it keeps the points that *defined* the line available to constructions
// that need them (a segment's own endpoints, a ray's origin).
export interface GeometryLine {
  kind: 'line'
  a: Vec2
  b: Vec2
  extent: LineExtent
}

export interface GeometryCircle {
  kind: 'circle'
  center: Vec2
  radius: number
}

export type GeometryObject = GeometryPoint | GeometryLine | GeometryCircle

export type GeometryKind = GeometryObject['kind']

// The tolerance every predicate in this layer compares against. Constructions
// are closed form, so residuals come from floating-point rounding only —
// nothing here converges toward an answer — which is why this can be this
// tight. Comparisons that involve a length are scaled by that length before
// being compared, so this stays a *relative* tolerance rather than silently
// becoming an absolute one at large coordinates.
export const GEOM_EPS = 1e-9
