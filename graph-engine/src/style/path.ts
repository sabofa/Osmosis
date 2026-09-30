import type { Point } from './tokens'

// Abstract strokes: what every line type in lines/ takes as input.
//
// A CHAIN is a run of pieces — straight lines, circular arcs, elliptical arcs
// and cubic Béziers — in drawing coordinates, each starting where the last
// one ended. A closed chain returns to its first point. Nothing here knows
// what drew the chain (a triangle's side, a cylinder's rim, a hatch line);
// that is the point: a line type is one algorithm over chains.
//
// Angles are radians in drawing coordinates, where y points DOWN (the SVG
// convention). An arc runs from `start` to `end`; the sign of `end - start`
// is its direction. An elliptical arc's angles are the ELLIPSE PARAMETER t,
// the point at t being center + rx cos t u + ry sin t v, with u the rx axis
// turned by `rotation` and v a quarter turn on from u.

export type Piece =
  | { kind: 'line'; from: Point; to: Point }
  | { kind: 'arc'; center: Point; radius: number; start: number; end: number }
  | { kind: 'ellipticalArc'; center: Point; rx: number; ry: number; rotation: number; start: number; end: number }
  | { kind: 'cubic'; from: Point; c1: Point; c2: Point; to: Point }

export interface Chain {
  pieces: Piece[]
  closed: boolean
}
