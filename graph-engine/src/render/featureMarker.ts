import type { FeatureKind } from '../parser/config'

export type MarkerShape = 'dot' | 'ring' | 'square' | 'diamond' | 'triangle-up' | 'triangle-down'

// One shape per feature kind, so a reader can tell what a marker means without
// hovering it. v1 drew every feature as an identical outline dot, which is the
// real reason "@points: intercepts" and "@points: all" looked the same.
//
// The pairings are meant to be readable rather than arbitrary: a maximum
// points up, a minimum points down, both intercept kinds share a ring because
// both are roots, and an intersection gets the shape that reads as two things
// crossing.
const SHAPES: Record<FeatureKind, MarkerShape> = {
  'x-intercept': 'ring',
  'y-intercept': 'ring',
  'local-max': 'triangle-up',
  'local-min': 'triangle-down',
  inflection: 'square',
  intersection: 'diamond',
  center: 'dot',
  focus: 'diamond',
  'conic-vertex': 'triangle-up',
}

export function markerShape(feature: FeatureKind | null | undefined): MarkerShape {
  if (!feature) return 'dot'
  return SHAPES[feature] ?? 'dot'
}
