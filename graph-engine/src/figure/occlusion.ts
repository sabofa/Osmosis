import { GEOM_EPS } from '../scene/geometry/types'
import { add3, cross3, dot3, length3, scale3, sub3 } from './construct3d'
import { faceNormal, type Camera, type Solid3D, type Vec3 } from './project3d'
import { coneSilhouetteAngles, cylinderSilhouetteAngles } from './silhouette'
import type { SolidBody, SolidSpec } from './solids'

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
// Round solids
// ---------------------------------------------------------------------------
//
// A sphere, a cylinder and a cone, each in H1's placement: centred on the
// origin, axis along +y. Every surface below is linear or quadratic in both
// the ray parameter t and the segment parameter u, so every answer is a root
// of a polynomial of degree at most two.

type RoundSpec = Extract<SolidSpec, { kind: 'sphere' | 'cylinder' | 'cone' }>

const AXIS: Vec3 = { x: 0, y: 1, z: 0 }

function roundSize(spec: RoundSpec): number {
  return Math.max(1, spec.radius, spec.kind === 'sphere' ? 0 : spec.height / 2)
}

// Whether f(t) = A t^2 + 2 B t + C is negative somewhere in the open
// interval (lo, hi), lo >= 0 and hi possibly infinite. A quadratic's least
// value on an interval is at an end or at its vertex, so three evaluations
// decide it — no sampling.
function negativeSomewhere(A: number, B: number, C: number, lo: number, hi: number): boolean {
  if (!(hi > lo)) return false
  const f = (t: number) => (A * t + 2 * B) * t + C
  if (f(lo) < 0) return true
  if (Number.isFinite(hi)) {
    if (f(hi) < 0) return true
  } else {
    // Unbounded above: negative far out exactly when the leading term is.
    if (A < -GEOM_EPS) return true
    if (Math.abs(A) <= GEOM_EPS && B < 0) return true
  }
  if (A > GEOM_EPS) {
    const vertex = -B / A
    if (vertex > lo && vertex < hi && f(vertex) < 0) return true
  }
  return false
}

// The t-interval a ray spends between the planes y = bottom and y = top (the
// slab a cylinder or a cone lives in), intersected with t > 0.
function slab(p: Vec3, d: Vec3, bottom: number, top: number): [number, number] {
  if (Math.abs(d.y) <= GEOM_EPS) return p.y > bottom && p.y < top ? [0, Infinity] : [0, 0]
  const t1 = (bottom - p.y) / d.y
  const t2 = (top - p.y) / d.y
  return [Math.max(0, Math.min(t1, t2)), Math.max(t1, t2)]
}

// S6's ray test against a round solid: does p + t d, t > 0, meet the
// interior? The solid is shrunk by a rounding-sized margin, for the reason
// polyhedronHides gives: a point ON the surface is judged by where its ray
// goes, not by the sign of a rounding error.
function roundHides(spec: RoundSpec, p: Vec3, d: Vec3): boolean {
  const margin = GEOM_EPS * roundSize(spec)
  switch (spec.kind) {
    case 'sphere': {
      const r = spec.radius - margin
      return negativeSomewhere(dot3(d, d), dot3(p, d), dot3(p, p) - r * r, 0, Infinity)
    }
    case 'cylinder': {
      const r = spec.radius - margin
      const h = spec.height / 2 - margin
      const [lo, hi] = slab(p, d, -h, h)
      return negativeSomewhere(d.x * d.x + d.z * d.z, p.x * d.x + p.z * d.z, p.x * p.x + p.z * p.z - r * r, lo, hi)
    }
    case 'cone': {
      // Inside: -h/2 < y < h/2 and sqrt(x^2 + z^2) < k (h/2 - y), k = r/h.
      // The squared form is a double cone; the slab keeps the lower nappe,
      // which is the solid.
      const apex = spec.height / 2
      const k = (spec.radius - margin) / spec.height
      const k2 = k * k
      const above = apex - p.y
      const [lo, hi] = slab(p, d, -apex + margin, apex)
      return negativeSomewhere(
        d.x * d.x + d.z * d.z - k2 * d.y * d.y,
        p.x * d.x + p.z * d.z + k2 * above * d.y,
        p.x * p.x + p.z * p.z - k2 * above * above,
        lo,
        hi
      )
    }
  }
}

// The roots in (0, 1) of A u^2 + B u + C = 0.
//
// GEOM_EPS decides both borderline calls. A discriminant within rounding of
// zero is a TANGENCY and yields its root once; one below that yields none.
// Either way a root is only ever a candidate, so a tangency counted as one
// merely splits a span that classification merges back.
function quadraticRoots(A: number, B: number, C: number, out: number[]): void {
  const push = (u: number) => {
    if (u > 0 && u < 1) out.push(u)
  }
  const scale = Math.max(Math.abs(A), Math.abs(B), Math.abs(C))
  if (scale === 0) return
  if (Math.abs(A) <= GEOM_EPS * scale) {
    if (Math.abs(B) > GEOM_EPS * scale) push(-C / B)
    return
  }
  const disc = B * B - 4 * A * C
  const tolerance = GEOM_EPS * Math.max(B * B, Math.abs(4 * A * C))
  if (disc < -tolerance) return
  if (disc <= tolerance) {
    push(-B / (2 * A))
    return
  }
  // The cancellation-free pair: one root from the formula, the other from
  // the product of the roots.
  const q = -(B + (B < 0 ? -1 : 1) * Math.sqrt(disc)) / 2
  push(q / A)
  if (q !== 0) push(C / q)
}

// Where |w0 + u w1|^2 = r0 + r1 u + r2 u^2 — the segment meeting a quadric
// once the caller has written the quadric as a squared length (of a
// projection of the point) against a quadratic right-hand side.
function squaredLengthRoots(w0: Vec3, w1: Vec3, rhs: { u2: number; u1: number; u0: number }, out: number[]): void {
  quadraticRoots(dot3(w1, w1) - rhs.u2, 2 * dot3(w0, w1) - rhs.u1, dot3(w0, w0) - rhs.u0, out)
}

function constant(value: number): { u2: number; u1: number; u0: number } {
  return { u2: 0, u1: 0, u0: value }
}

// The xz part of a point, as a Vec3 with y = 0.
function flat(p: Vec3): Vec3 {
  return { x: p.x, y: 0, z: p.z }
}

// A rim — the circle of radius r in the plane y = level — swept along d: the
// elliptic cylinder of points whose line along d passes through the rim.
// Following the line from q to the rim's plane lands at
// q + ((level - q.y) / d.y) d, which is linear in u, and its xz part having
// length r is the quadratic. A camera square to the axis sweeps the rim into
// its own plane, which the cap-plane candidates already cover.
function rimSweepRoots(a: Vec3, ab: Vec3, d: Vec3, level: number, r: number, out: number[]): void {
  if (Math.abs(d.y) <= GEOM_EPS) return
  const w0 = flat(add3(a, scale3(d, (level - a.y) / d.y)))
  const w1 = flat(sub3(ab, scale3(d, ab.y / d.y)))
  squaredLengthRoots(w0, w1, constant(r * r), out)
}

// The plane through a silhouette LINE (a point `on` it, its direction
// `along`) and d: the points whose ray toward the viewer grazes that line.
function silhouettePlaneRoots(a: Vec3, ab: Vec3, on: Vec3, along: Vec3, d: Vec3, out: number[]): void {
  const normal = cross3(along, d)
  planeCrossing(a, ab, normal, dot3(normal, on), out)
}

// Each round solid's candidate families, as S6 names them. Every family has
// a test that fails when it is deleted.
function roundCandidates(spec: RoundSpec, a: Vec3, b: Vec3, camera: Camera): number[] {
  const d = camera.direction
  const ab = sub3(b, a)
  const out: number[] = []
  switch (spec.kind) {
    case 'sphere': {
      const r2 = spec.radius * spec.radius
      // The sphere itself.
      squaredLengthRoots(a, ab, constant(r2), out)
      // The view-direction cylinder of the same radius through the centre:
      // the points whose projection lies on the outline circle.
      const across = (p: Vec3) => sub3(p, scale3(d, dot3(p, d)))
      squaredLengthRoots(across(a), across(ab), constant(r2), out)
      break
    }
    case 'cylinder': {
      const h = spec.height / 2
      // The lateral surface, and the two cap planes.
      squaredLengthRoots(flat(a), flat(ab), constant(spec.radius * spec.radius), out)
      planeCrossing(a, ab, AXIS, h, out)
      planeCrossing(a, ab, AXIS, -h, out)
      // The planes through each silhouette line and d — silhouette.ts's
      // lines, the same ones the outline draws.
      for (const angle of cylinderSilhouetteAngles(camera) ?? []) {
        const on = { x: spec.radius * Math.cos(angle), y: 0, z: spec.radius * Math.sin(angle) }
        silhouettePlaneRoots(a, ab, on, AXIS, d, out)
      }
      // Both rims, swept along d.
      rimSweepRoots(a, ab, d, h, spec.radius, out)
      rimSweepRoots(a, ab, d, -h, spec.radius, out)
      break
    }
    case 'cone': {
      const apexY = spec.height / 2
      const k2 = (spec.radius / spec.height) ** 2
      // The lateral surface, x^2 + z^2 = k^2 (h/2 - y)^2 with h/2 - y
      // linear in u. (The double cone's other nappe only adds candidates.)
      const above0 = apexY - a.y
      const above1 = -ab.y
      squaredLengthRoots(flat(a), flat(ab), { u2: k2 * above1 * above1, u1: 2 * k2 * above0 * above1, u0: k2 * above0 * above0 }, out)
      // The base plane.
      planeCrossing(a, ab, AXIS, -apexY, out)
      // The planes through each silhouette generator and d, all through the
      // apex. The generators are silhouette.ts's, the same the outline draws.
      const apex = { x: 0, y: apexY, z: 0 }
      for (const angle of coneSilhouetteAngles(spec.radius, spec.height, camera) ?? []) {
        const foot = { x: spec.radius * Math.cos(angle), y: -apexY, z: spec.radius * Math.sin(angle) }
        silhouettePlaneRoots(a, ab, apex, sub3(foot, apex), d, out)
      }
      // The base rim, swept along d.
      rimSweepRoots(a, ab, d, -apexY, spec.radius, out)
      break
    }
  }
  return out
}

function roundSpec(body: SolidBody): RoundSpec {
  const spec = body.spec
  if (spec.kind === 'sphere' || spec.kind === 'cylinder' || spec.kind === 'cone') return spec
  // Unreachable: every other primitive builds a polyhedron (solids.ts, H2).
  throw new Error(`A ${spec.kind} has no polyhedron to occlude with`)
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

// S6's ray test for one solid.
export function hidesPoint(body: SolidBody, p: Vec3, camera: Camera): boolean {
  if (body.polyhedron) return polyhedronHides(body.polyhedron, p, camera.direction)
  return roundHides(roundSpec(body), p, camera.direction)
}

// Every parameter in (0, 1) at which this solid could change the segment's
// status. Unsorted, possibly with repeats: segmentSpans tidies them.
export function occlusionCandidates(body: SolidBody, a: Vec3, b: Vec3, camera: Camera): number[] {
  if (body.polyhedron) return polyhedronCandidates(body.polyhedron, a, b, camera.direction)
  return roundCandidates(roundSpec(body), a, b, camera)
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
