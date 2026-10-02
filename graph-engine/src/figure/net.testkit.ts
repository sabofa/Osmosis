import { GEOM_EPS } from '../scene/geometry/types'
import type { Vec2 } from '../scene/types'

// TEST-ONLY — the exact overlap predicate the nets' invariant is pinned with
// (nets.ts, "No template net can overlap itself"). Not used at run time: no
// template the grammar can produce overlaps, so a runtime refusal would be a
// branch no input reaches (the phase 5 precedent).
//
// Two convex polygons overlap with positive AREA exactly when no separating
// axis exists among their edge normals (the separating-axis theorem in the
// plane): on every such axis their projections overlap by MORE than a
// tolerance. Touching along an edge or at a point projects to intervals that
// meet in a single value on the edge's own normal, so it is not an overlap.
// The tolerance is GEOM_EPS scaled to the two polygons' own extent (their
// joint bounding box), never to how far from the origin they sit.
export function convexOverlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  const all = [...a, ...b]
  const width = Math.max(...all.map((p) => p.x)) - Math.min(...all.map((p) => p.x))
  const height = Math.max(...all.map((p) => p.y)) - Math.min(...all.map((p) => p.y))
  const tolerance = GEOM_EPS * Math.max(width, height)
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i]
      const q = polygon[(i + 1) % polygon.length]
      const length = Math.hypot(q.x - p.x, q.y - p.y)
      if (length === 0) continue
      const axis = { x: -(q.y - p.y) / length, y: (q.x - p.x) / length }
      const [aMin, aMax] = project(a, axis)
      const [bMin, bMax] = project(b, axis)
      if (Math.min(aMax, bMax) - Math.max(aMin, bMin) <= tolerance) return false
    }
  }
  return true
}

function project(polygon: readonly Vec2[], axis: Vec2): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const p of polygon) {
    const t = p.x * axis.x + p.y * axis.y
    min = Math.min(min, t)
    max = Math.max(max, t)
  }
  return [min, max]
}

// Whether any two faces of a flat net overlap with positive area.
export function netOverlaps(faces: readonly { corners: readonly Vec2[] }[]): boolean {
  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) if (convexOverlap(faces[i].corners, faces[j].corners)) return true
  }
  return false
}
