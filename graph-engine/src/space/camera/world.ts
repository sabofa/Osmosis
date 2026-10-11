// World space is the axis box, normalised (plan G1). The author box B maps to
// world by a per-axis affine map w = (a - c) * k, where c is the box centre
// and k is chosen so the box's half-extents in world are h (the aspect, G4,
// normalised so max(h) = 1).
//
// The GPU never sees c: positions are uploaded as (a - c), computed in
// Float64 and then cast, and the model matrix applies k. That is how a
// surface at x ~ 4500 keeps its precision in Float32.

import type { Box3, Vec3 } from '../scene/types'

export interface WorldMap {
  // The author box this map normalises.
  box: Box3
  // The box centre c, in author coordinates.
  centre: Vec3
  // Per-axis scale k: world units per author unit.
  scale: Vec3
  // The box's half-extents in world, h = k * (span / 2).
  halfExtents: Vec3
  toWorld(a: Vec3): Vec3
  toAuthor(w: Vec3): Vec3
}

// A zero span cannot be normalised; resolveBox never produces one, but a
// defensive k of 1 keeps every downstream number finite if one slips through.
function scaleFor(half: number, span: number): number {
  return span > 0 ? half / (span / 2) : 1
}

export function worldMap(box: Box3, halfExtents: Vec3): WorldMap {
  const centre: Vec3 = [(box.x.min + box.x.max) / 2, (box.y.min + box.y.max) / 2, (box.z.min + box.z.max) / 2]
  const scale: Vec3 = [
    scaleFor(halfExtents[0], box.x.max - box.x.min),
    scaleFor(halfExtents[1], box.y.max - box.y.min),
    scaleFor(halfExtents[2], box.z.max - box.z.min),
  ]
  return {
    box,
    centre,
    scale,
    halfExtents,
    toWorld: (a) => [(a[0] - centre[0]) * scale[0], (a[1] - centre[1]) * scale[1], (a[2] - centre[2]) * scale[2]],
    toAuthor: (w) => [w[0] / scale[0] + centre[0], w[1] / scale[1] + centre[1], w[2] / scale[2] + centre[2]],
  }
}

// A normal transforms by the inverse of k, then renormalises: n_w =
// normalise(n / k). Non-uniform scale makes this necessary — a normal is not a
// direction between points. A zero normal (undefined, per the scene contract)
// stays zero.
export function worldNormal(n: Vec3, scale: Vec3): Vec3 {
  const x = n[0] / scale[0]
  const y = n[1] / scale[1]
  const z = n[2] / scale[2]
  const len = Math.hypot(x, y, z)
  return len > 0 ? [x / len, y / len, z / len] : [0, 0, 0]
}
