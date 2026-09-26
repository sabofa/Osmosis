import { GEOM_EPS } from '../scene/geometry/types'
import { add3, cross3, dot3, length3, scale3, sub3 } from './construct3d'
import { faceNormal, type Camera, type Solid3D, type Vec3 } from './project3d'
import type { SolidBody } from './solids'

// S6 — construction segments in a solid figure, and the glass rule.
//
// Solids are glass to EACH OTHER: each draws its own back dashed by its own
// convex rule, exactly as phase 5 does, and nothing here touches that. A
// construction SEGMENT, though, is occluded by every solid in the figure. A
// point p of a segment is hidden when the open ray from p toward the viewer,
// p + t d for t > 0 (d the camera's `direction`), meets the INTERIOR of any
// solid. For one convex solid that is a single interval of the segment; the
// union over solids may be several.
//
// **Exact, never sampled.** The drawn result is the segment split at exact
// parameters. The method: collect every CANDIDATE parameter at which the
// status can change — each closed form, linear or quadratic in the segment
// parameter — sort them, and classify each open span between neighbours by
// testing its midpoint. The midpoint test only classifies a span whose ends
// are already exact; it never locates one. Candidates may be superfluous
// (a split between two spans of the same status merges away), but they must
// never be missing, so every candidate family has a test that deletes it.
//
// Everything is in the internal y-up frame; nothing here knows the author's.

// Segment parameters in [0, 1], ordered and contiguous from the first
// endpoint to the second.
export interface Span {
  from: number
  to: number
  hidden: boolean
}

// ---------------------------------------------------------------------------
// Polyhedra
// ---------------------------------------------------------------------------

// A face as a half-space: the interior is `normal . x < offset`, with the
// normal unit and outward (the face winding makes it so — see project3d).
interface HalfSpace {
  normal: Vec3
  offset: number
}

function halfSpaces(solid: Solid3D): HalfSpace[] {
  return solid.faces.map((face, i) => {
    const n = faceNormal(solid, i)
    const normal = scale3(n, 1 / length3(n))
    return { normal, offset: dot3(normal, solid.vertices[face[0]]) }
  })
}

// How big the solid is, for scaling GEOM_EPS into a length (GEOM_EPS is a
// relative tolerance; see scene/geometry/types.ts).
function sizeOf(solid: Solid3D): number {
  let size = 1
  for (const p of solid.vertices) size = Math.max(size, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z))
  return size
}

// The half-space clip. The ray p + t d meets the interior exactly when the
// open interval of t that every face allows, intersected with t > 0, is not
// empty.
//
// The solid is shrunk by a rounding-sized margin first, so a point lying ON a
// face — a segment drawn along an edge or across a front face — is judged by
// where its ray goes rather than by the sign of a rounding error. Without it
// a point on a front face would find a sliver (0, 1e-17) of "interior" and
// dash an edge a reader can plainly see.
function polyhedronHides(solid: Solid3D, p: Vec3, d: Vec3): boolean {
  const margin = GEOM_EPS * sizeOf(solid)
  let lo = 0
  let hi = Infinity
  for (const face of halfSpaces(solid)) {
    const slack = face.offset - dot3(face.normal, p) - margin
    const rate = dot3(face.normal, d)
    if (Math.abs(rate) <= GEOM_EPS) {
      // The ray runs parallel to this face: inside it for every t, or never.
      if (slack <= 0) return false
      continue
    }
    const t = slack / rate
    if (rate > 0) hi = Math.min(hi, t)
    else lo = Math.max(lo, t)
    if (hi <= lo) return false
  }
  return hi > lo
}

// Which way a face turns: toward the viewer, away, or edge-on.
function facing(normal: Vec3, d: Vec3): -1 | 0 | 1 {
  const along = dot3(normal, d)
  return along > GEOM_EPS ? 1 : along < -GEOM_EPS ? -1 : 0
}

// The silhouette edges: every edge whose two faces do not both turn the same
// way. An edge-on face counts as turning neither way, so its edges are all
// included — superfluous candidates are harmless, missing ones are not.
function silhouetteEdges(solid: Solid3D, d: Vec3): [number, number][] {
  const faces = halfSpaces(solid).map((face) => facing(face.normal, d))
  const seen = new Map<string, { edge: [number, number]; sides: number[] }>()
  solid.faces.forEach((face, f) => {
    for (let i = 0; i < face.length; i++) {
      const a = face[i]
      const b = face[(i + 1) % face.length]
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      const entry = seen.get(key) ?? { edge: [a, b] as [number, number], sides: [] }
      entry.sides.push(faces[f])
      seen.set(key, entry)
    }
  })
  const edges: [number, number][] = []
  for (const { edge, sides } of seen.values()) {
    const bothFront = sides.every((s) => s === 1)
    const bothBack = sides.every((s) => s === -1)
    if (!bothFront && !bothBack) edges.push(edge)
  }
  return edges
}

// Where the segment a + u (b - a) crosses the plane `normal . x = offset`,
// if it does so strictly inside the segment. A segment parallel to the plane
// contributes nothing: its status cannot change there.
function planeCrossing(a: Vec3, ab: Vec3, normal: Vec3, offset: number, out: number[]): void {
  const den = dot3(normal, ab)
  if (Math.abs(den) <= GEOM_EPS * length3(normal) * length3(ab)) return
  const u = (offset - dot3(normal, a)) / den
  if (u > 0 && u < 1) out.push(u)
}

// A polyhedron's candidates, two families:
//
//  - FACE PLANES. Where the segment passes into or out of the solid itself:
//    a segment entering through a front face is visible on the face and
//    hidden just inside it.
//  - SILHOUETTE PLANES. Where the segment's projection crosses the outline:
//    the plane containing a silhouette edge and the view direction is the
//    set of points whose ray toward the viewer grazes that edge.
function polyhedronCandidates(solid: Solid3D, a: Vec3, b: Vec3, d: Vec3): number[] {
  const ab = sub3(b, a)
  const out: number[] = []
  for (const face of halfSpaces(solid)) planeCrossing(a, ab, face.normal, face.offset, out)
  for (const [i, j] of silhouetteEdges(solid, d)) {
    const p = solid.vertices[i]
    const normal = cross3(sub3(solid.vertices[j], p), d)
    planeCrossing(a, ab, normal, dot3(normal, p), out)
  }
  return out
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

function roundSolid(body: SolidBody): Error {
  return new Error(`Segments against a ${body.spec.kind} arrive in the next task — this figure cannot draw one's occlusion yet`)
}

// S6's ray test for one solid.
export function hidesPoint(body: SolidBody, p: Vec3, camera: Camera): boolean {
  if (body.polyhedron) return polyhedronHides(body.polyhedron, p, camera.direction)
  throw roundSolid(body)
}

// Every parameter in (0, 1) at which this solid could change the segment's
// status. Unsorted, possibly with repeats: segmentSpans tidies them.
export function occlusionCandidates(body: SolidBody, a: Vec3, b: Vec3, camera: Camera): number[] {
  if (body.polyhedron) return polyhedronCandidates(body.polyhedron, a, b, camera.direction)
  throw roundSolid(body)
}

// The segment a-b, split into alternating visible and hidden spans against
// every solid in the figure, in order from `a`.
export function segmentSpans(a: Vec3, b: Vec3, solids: SolidBody[], camera: Camera): Span[] {
  const cuts = [0, 1]
  for (const body of solids) cuts.push(...occlusionCandidates(body, a, b, camera))
  cuts.sort((x, y) => x - y)
  const ordered: number[] = []
  for (const u of cuts) {
    if (ordered.length > 0 && u - ordered[ordered.length - 1] <= GEOM_EPS) continue
    ordered.push(u)
  }
  // Keep the far end exactly 1, whatever candidate landed within GEOM_EPS of it.
  if (ordered[ordered.length - 1] !== 1) ordered[ordered.length - 1] = 1

  const ab = sub3(b, a)
  const spans: Span[] = []
  for (let i = 0; i + 1 < ordered.length; i++) {
    const from = ordered[i]
    const to = ordered[i + 1]
    const mid = add3(a, scale3(ab, (from + to) / 2))
    const hidden = solids.some((body) => hidesPoint(body, mid, camera))
    const last = spans[spans.length - 1]
    if (last && last.hidden === hidden) last.to = to
    else spans.push({ from, to, hidden })
  }
  return spans
}
