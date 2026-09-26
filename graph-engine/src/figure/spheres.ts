import { GEOM_EPS } from '../scene/geometry/types'
import { authorText } from './authorFrame'
import { add3, centroid3, cross3, distance3, dot3, length3, pointPlaneDistance, scale3, sub3, type Plane3 } from './construct3d'
import type { Solid3D, Vec3 } from './project3d'
import { toWorld } from './silhouette'
import { frustumRadii, type SolidBody } from './solids'

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

// ---------------------------------------------------------------------------
// Exact linear algebra: determinants and Cramer's rule
// ---------------------------------------------------------------------------
//
// A fixed-order solve: every determinant is a cofactor expansion along its
// first row, and Cramer's rule chooses nothing. The same inputs give the same
// arithmetic, in the same order, every time.

function det3(m: readonly (readonly number[])[]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  )
}

function det4(m: readonly (readonly number[])[]): number {
  let total = 0
  for (let j = 0; j < 4; j++) {
    const minor = [1, 2, 3].map((r) => m[r].filter((_, c) => c !== j))
    total += (j % 2 === 0 ? 1 : -1) * m[0][j] * det3(minor)
  }
  return total
}

// x with A x = b, by Cramer's rule: x_j = det(A with column j replaced by b)
// / det(A). The caller has already chosen rows that determine x (a
// non-singular A), so det(A) is not zero.
function cramer(a: readonly (readonly number[])[], b: readonly number[]): number[] {
  const det = a.length === 3 ? det3 : det4
  const whole = det(a)
  return a.map((_, j) => det(a.map((row, i) => row.map((v, c) => (c === j ? b[i] : v)))) / whole)
}

// ---------------------------------------------------------------------------
// Names, for messages
// ---------------------------------------------------------------------------

// The author's name for each vertex, where the figure gave it one; an entry
// that is missing names the vertex by where it is instead.
export type VertexNames = readonly (string | undefined)[]

function vertexText(vertices: readonly Vec3[], names: VertexNames, i: number): string {
  return names[i] ?? `the vertex at ${authorText(vertices[i])}`
}

function listText(items: readonly string[]): string {
  return items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

// A point set's spread about its own centroid (at least 1), which is what a
// tolerance is scaled by — so a small solid far from the origin is judged by
// its own size, exactly as the hull builder judges it.
function extentOf(points: readonly Vec3[]): number {
  const centre = centroid3([...points])
  let extent = 1
  for (const p of points) extent = Math.max(extent, length3(sub3(p, centre)))
  return extent
}

// ---------------------------------------------------------------------------
// R3 — the circumsphere of points, by a fixed-order solve, verified
// ---------------------------------------------------------------------------

// The first four points, in the order given, that are not coplanar — the
// stated scan order: P0 is the first point; P1 the first after it not at P0;
// P2 the first not on the line P0 P1; P3 the first not in the plane P0 P1 P2.
// Null when every point lies in one plane.
function circumBasis(points: readonly Vec3[]): [number, number, number, number] | null {
  const extent = extentOf(points)
  const eps = GEOM_EPS * extent
  const p0 = points[0]
  const i1 = points.findIndex((p) => length3(sub3(p, p0)) > eps)
  if (i1 < 0) return null
  const along = sub3(points[i1], p0)
  const i2 = points.findIndex((p) => length3(cross3(along, sub3(p, p0))) > eps * extent)
  if (i2 < 0) return null
  const raw = cross3(along, sub3(points[i2], p0))
  const normal = scale3(raw, 1 / length3(raw))
  const i3 = points.findIndex((p) => Math.abs(dot3(normal, sub3(p, p0))) > eps)
  if (i3 < 0) return null
  return [0, i1, i2, i3]
}

// The sphere through four points not in one plane. Its centre c solves
// 2 (P_k - P_0) . c = |P_k|^2 - |P_0|^2 for k = 1, 2, 3; written about P_0
// (c = P_0 + u, so 2 (P_k - P_0) . u = |P_k - P_0|^2), which is the same
// system shifted, and keeps the arithmetic at the size of the solid rather
// than of its distance from the origin.
function sphereThrough(points: readonly Vec3[], basis: readonly number[]): SphereFit {
  const p0 = points[basis[0]]
  const rows = basis.slice(1).map((k) => sub3(points[k], p0))
  const u = cramer(
    rows.map((d) => [2 * d.x, 2 * d.y, 2 * d.z]),
    rows.map((d) => dot3(d, d))
  )
  const offset = { x: u[0], y: u[1], z: u[2] }
  return { center: add3(p0, offset), radius: length3(offset) }
}

// The first vertex, in vertex order, that is not on the sphere; -1 when all
// of them are. The tolerance is GEOM_EPS scaled by the solid's own size.
function firstOffSphere(points: readonly Vec3[], fit: SphereFit): number {
  const eps = GEOM_EPS * Math.max(extentOf(points), fit.radius)
  return points.findIndex((p) => Math.abs(distance3(p, fit.center) - fit.radius) > eps)
}

// "solid circumsphere A-B-C-D": the sphere through four named points.
export function circumsphereOfPoints(points: readonly Vec3[], names: readonly string[]): SphereFit {
  const basis = circumBasis(points)
  if (!basis) {
    throw new Error(
      `${listText(names)} lie in one plane, so no sphere passes through all four — a circumsphere needs four points not in one plane`
    )
  }
  return sphereThrough(points, basis)
}

// A polyhedron's circumsphere: the sphere through the first four vertices
// that fix it, then EVERY vertex checked against it. A polyhedron whose
// vertices do not all lie on one sphere (a dented cube, a pyramid on a kite)
// is refused, naming the first vertex the sphere misses — never drawn with a
// sphere through some of them.
function circumsphereOfPolyhedron(solid: Solid3D, title: string, names: VertexNames): SphereFit {
  const vertices = solid.vertices
  // A solid has volume, so its vertices never all lie in one plane.
  const basis = circumBasis(vertices)!
  const fit = sphereThrough(vertices, basis)
  const off = firstOffSphere(vertices, fit)
  if (off >= 0) {
    const through = listText(basis.map((i) => vertexText(vertices, names, i)))
    throw new Error(
      `"${title}" has no circumscribed sphere — no sphere passes through all ${vertices.length} of its vertices: ` +
        `the sphere through ${through} misses ${vertexText(vertices, names, off)}`
    )
  }
  return fit
}

// ---------------------------------------------------------------------------
// R4 — round solids, closed form in their own frame
// ---------------------------------------------------------------------------
//
// In local coordinates the axis is y, the base (a frustum's WIDER rim, P2)
// at -h/2 and the top at +h/2. Every centre is on the axis; it is taken to
// the world through the solid's placement (P1), so a placed or tilted solid
// needs nothing more.

interface LocalSphere {
  // Height of the centre on the local axis.
  y: number
  radius: number
  // The points that fix it — a point of each rim, the apex, a touch point —
  // which the answer is checked against, as a polyhedron's are.
  through: Vec3[]
}

function localCircumsphere(body: SolidBody, title: string): LocalSphere {
  const spec = body.spec
  switch (spec.kind) {
    case 'cylinder': {
      // Always: centre at the middle, radius sqrt(r^2 + (h/2)^2).
      const h = spec.height / 2
      return {
        y: 0,
        radius: Math.hypot(spec.radius, h),
        through: [
          { x: spec.radius, y: -h, z: 0 },
          { x: spec.radius, y: h, z: 0 },
        ],
      }
    }
    case 'cone': {
      // Always: through the apex and the base rim. x = (H^2 - R^2) / (2H)
      // above the base, radius H - x (x < 0, below the base, for a cone
      // wider than it is tall).
      const { radius: r, height: h } = spec
      const x = (h * h - r * r) / (2 * h)
      return {
        y: -h / 2 + x,
        radius: h - x,
        through: [
          { x: 0, y: h / 2, z: 0 },
          { x: r, y: -h / 2, z: 0 },
        ],
      }
    }
    case 'frustum': {
      // Always: through both rims. y = (h^2 + r2^2 - r1^2) / (2h) above the
      // wider rim r1, radius sqrt(y^2 + r1^2).
      const { bottom: r1, top: r2 } = frustumRadii(spec)
      const h = spec.height
      const y = (h * h + r2 * r2 - r1 * r1) / (2 * h)
      return {
        y: -h / 2 + y,
        radius: Math.hypot(y, r1),
        through: [
          { x: r1, y: -h / 2, z: 0 },
          { x: r2, y: h / 2, z: 0 },
        ],
      }
    }
    case 'sphere':
      throw new Error(`"${title}" is already a sphere — it is its own circumscribed sphere`)
    default:
      // Unreachable: every other solid is a polyhedron.
      throw new Error(`"${title}" has no circumscribed sphere`)
  }
}

// The local answer, checked against the points that fix it (each must be
// exactly one radius from the centre) and taken to the world through the
// placement.
function placeLocal(body: SolidBody, local: LocalSphere, title: string, what: string): SphereFit {
  const centre = { x: 0, y: local.y, z: 0 }
  const eps = GEOM_EPS * Math.max(1, local.radius, ...local.through.map(length3))
  for (const p of local.through) {
    if (Math.abs(distance3(p, centre) - local.radius) > eps) {
      throw new Error(`The ${what} sphere of "${title}" does not touch it where its formula says — refused rather than drawn wrong`)
    }
  }
  return { center: toWorld(body.placement, centre), radius: local.radius }
}

// "solid circumsphere of S": R3 for a polyhedron, R4 for a round solid.
// `names` names the polyhedron's vertices where the figure did.
export function circumsphereOf(body: SolidBody, title: string, names: VertexNames = []): SphereFit {
  if (body.polyhedron) return circumsphereOfPolyhedron(body.polyhedron, title, names)
  return placeLocal(body, localCircumsphere(body, title), title, 'circumscribed')
}
