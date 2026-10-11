// What picking returns (plan E6, E7). Pure.

import type { MarkSource, Vec3 } from '../scene/types'

export type HitKind = 'graph' | 'parametric' | 'implicit' | 'curve' | 'point' | 'arrow'

// One line of a readout: "x" and "0.3". Values come from format.ts.
export interface ReadoutRow {
  label: string
  value: string
}

// Where on its mark a hit is, in the mark's own terms rather than pixels, so
// a pin can re-evaluate it after the scene changes (E10).
export type HitAt =
  | { kind: 'graph'; x: number; y: number }
  | { kind: 'parametric'; u: number; v: number }
  | { kind: 'implicit'; point: Vec3 }
  // t when the curve has a pick, else the point on the polyline.
  | { kind: 'curve'; t: number | null; point: Vec3 }
  | { kind: 'point'; index: number }
  | { kind: 'arrow'; index: number }

export interface Hit {
  source: MarkSource
  kind: HitKind
  // Author coordinates, on the true function where there is one.
  position: Vec3
  values: ReadoutRow[]
  at: HitAt
}

// A ray in author coordinates: origin + s * direction, s >= 0 in front of
// the eye. The direction is not unit length (author axes are scaled).
export interface Ray {
  origin: Vec3
  direction: Vec3
}
