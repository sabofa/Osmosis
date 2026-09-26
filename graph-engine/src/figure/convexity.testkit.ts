import { faceNormal, type Solid3D } from './project3d'

// Test support, not engine code: the convexity invariant solids.test.ts pins
// for every polyhedral primitive (H4), as a function, so the hull's tests and
// the phase 7 primitives' can apply the SAME check rather than a copy of it.
//
// The largest signed distance of any vertex OUTSIDE any face plane, measured
// along the face's outward (winding) normal. A convex, outward-wound solid
// has every vertex at or behind every face, so this is <= 0 up to rounding;
// solids.test.ts holds it below 1e-9.
export function maxOutsideDistance(solid: Solid3D): number {
  let worst = -Infinity
  for (let f = 0; f < solid.faces.length; f++) {
    const n = faceNormal(solid, f)
    const onFace = solid.vertices[solid.faces[f][0]]
    for (const p of solid.vertices) {
      const d = (p.x - onFace.x) * n.x + (p.y - onFace.y) * n.y + (p.z - onFace.z) * n.z
      worst = Math.max(worst, d)
    }
  }
  return worst
}
