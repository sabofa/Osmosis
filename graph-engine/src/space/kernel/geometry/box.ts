// The authored box: @bounds3d where it is given and [-5, 5] on every axis it
// does not name. S4a's unbounded forms (an implicit surface, a line, a plane,
// a coordinate surface, a curve frame's arrows) no longer read it: since the
// box pass (integration J1) they are box-dependent and build in the box the
// scene resolves to (registry.ts, boxOf). What still reads it: a cross
// product's right-angle mark, whose statement sizes the box itself.

import type { GraphConfig } from '../../../parser/config'
import type { Box3, Range } from '../../scene/types'

const DEFAULT: Range = { min: -5, max: 5 }

export function spaceBox(config: GraphConfig): Box3 {
  const { x, y, z } = config.space.bounds
  return { x: x ?? DEFAULT, y: y ?? DEFAULT, z: z ?? DEFAULT }
}

export function largestSpan(box: Box3): number {
  return Math.max(box.x.max - box.x.min, box.y.max - box.y.min, box.z.max - box.z.min)
}
