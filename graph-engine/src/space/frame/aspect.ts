// The box's proportions in world (plan G4). Pure.

import type { Aspect } from '../config'
import type { Box3, SpaceScene, Vec3 } from '../scene/types'

const AUTO: Vec3 = [1, 1, 0.7]

// The SP5 default rule, applied when the spec has no @aspect: `equal` when
// the scene has no z = f surface (no MeshMark whose pick is a graph) and the
// largest box span is at most 4x the smallest; otherwise `auto`. A graph
// surface's height is a different quantity from x and y, so equal
// proportions would make it a wall or a pancake; a sphere must stay round.
export function defaultAspect(box: Box3, scene: SpaceScene): Aspect {
  const hasGraph = scene.marks.some((m) => m.kind === 'mesh' && m.pick?.kind === 'graph')
  const spans = [box.x.max - box.x.min, box.y.max - box.y.min, box.z.max - box.z.min]
  const agree = Math.max(...spans) <= 4 * Math.min(...spans)
  return !hasGraph && agree ? { kind: 'equal' } : { kind: 'auto' }
}

function normalise(v: Vec3): Vec3 {
  const m = Math.max(v[0], v[1], v[2])
  return [v[0] / m, v[1] / m, v[2] / m]
}

// The half-extents h of the box in world, max(h) = 1: `equal` is
// proportional to the spans, `auto` is (1, 1, 0.7), a ratio is itself.
export function boxHalfExtents(box: Box3, aspect: Aspect | null, scene: SpaceScene): Vec3 {
  const chosen = aspect ?? defaultAspect(box, scene)
  if (chosen.kind === 'equal') {
    const spans: Vec3 = [box.x.max - box.x.min, box.y.max - box.y.min, box.z.max - box.z.min]
    return spans.every((s) => s > 0 && Number.isFinite(s)) ? normalise(spans) : AUTO
  }
  if (chosen.kind === 'ratio') {
    const r: Vec3 = [chosen.x, chosen.y, chosen.z]
    return r.every((s) => s > 0 && Number.isFinite(s)) ? normalise(r) : AUTO
  }
  return AUTO
}
