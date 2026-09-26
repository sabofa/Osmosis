import { GEOM_EPS } from '../scene/geometry/types'
import { distance3, length3, pointPlaneDistance, type Plane3 } from './construct3d'
import type { Vec3 } from './project3d'

// Phase 9 — spheres a figure CONSTRUCTS rather than states: placed by
// tangency (R5), inscribed in a solid, or circumscribed about one (R3, R4).
//
// Every answer here is an ordinary sphere — a centre and a radius in the
// INTERNAL frame — which the solid-figure walk places exactly as it places
// "sphere center M radius r" (R1). Nothing here draws: the glass rule,
// occlusion and sections already treat a sphere like any other solid.
//
// **Closed form, never a solver** (the spec's non-goal). A tangency is a
// distance; a round solid's in- or circumsphere is a formula in its own frame;
// a polyhedron's is a FIXED-ORDER linear solve (Cramer's rule, no pivoting to
// choose) on the first rows that determine it, and the answer is then
// VERIFIED against every vertex or face. A configuration that does not exist
// is refused, naming why — never approximated.

// A sphere, in the internal frame.
export interface SphereFit {
  center: Vec3
  radius: number
}

// GEOM_EPS is relative (see construct3d.ts's `negligible`): a length is
// negligible when it is small next to the coordinates it came from. The
// floor of 1 keeps a figure drawn near unit size from demanding exact zeros.
function tolerance(...scales: number[]): number {
  return GEOM_EPS * Math.max(1, ...scales.map(Math.abs))
}

// ---------------------------------------------------------------------------
// R5 — spheres by tangency
// ---------------------------------------------------------------------------

// The radius of the sphere centred at `center` tangent to `plane`: the
// distance to it. A centre ON the plane would give a sphere of radius 0.
// `centerName` and `planeText` are the author's words, for the refusal.
export function radiusTangentToPlane(center: Vec3, plane: Plane3, centerName: string, planeText: string): number {
  const radius = pointPlaneDistance(center, plane)
  if (radius <= tolerance(length3(center), length3(plane.point))) {
    throw new Error(`${centerName} lies on the plane ${planeText}, so a sphere centred there cannot be tangent to it — its radius would be 0`)
  }
  return radius
}

// The radius of the sphere centred at `center` tangent to `other`: from
// outside, |PT| - r (P must be outside T); from inside, r - |PT| (P must be
// inside T, and not its centre, where the two spheres would be concentric
// and touch everywhere or nowhere).
export function radiusTangentToSphere(
  center: Vec3,
  other: SphereFit,
  side: 'external' | 'internal',
  centerName: string,
  otherName: string
): number {
  const d = distance3(center, other.center)
  const eps = tolerance(length3(center), length3(other.center), other.radius)
  const quoted = `"${otherName}"`
  if (Math.abs(d - other.radius) <= eps) {
    throw new Error(`${centerName} lies on ${quoted}, so a sphere centred there and tangent to it would have radius 0`)
  }
  if (side === 'external') {
    if (d < other.radius) {
      throw new Error(
        `${centerName} is inside ${quoted}, so no sphere centred there is externally tangent to it — external tangency needs the centre outside ${otherName}`
      )
    }
    return d - other.radius
  }
  if (d > other.radius) {
    throw new Error(
      `${centerName} is outside ${quoted}, so no sphere centred there is internally tangent to it — internal tangency needs the centre inside ${otherName}`
    )
  }
  if (d <= eps) {
    throw new Error(`${centerName} is the centre of ${quoted}, so a sphere centred there is concentric with it and touches it everywhere or nowhere, never at one point`)
  }
  return other.radius - d
}
