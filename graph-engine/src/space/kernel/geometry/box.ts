// The box S4a's unbounded forms are built in (plan A1, A3, A5): an implicit
// surface, a line, a plane and a coordinate surface have no extent of their
// own to size the box from, so they are sampled, clipped or ranged over
// @bounds3d where it is given and [-5, 5] on every axis it does not name.
// (The frame's own box comes later, from the scene's extent; for these forms
// that extent is this box.) Sizes that scale with the box (a frame's arrows,
// a right-angle mark) read its largest span.

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
