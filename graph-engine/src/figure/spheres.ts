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

// **Every threshold in this module is purely relative** (fix round 2): GEOM_EPS
// times a length the configuration itself supplies — the points' spread
// about their centroid, the distance between two centres, a radius — with
// no absolute floor and no distance from the origin in it. A floor of 1
// refused a genuine tetrahedron of edge below about 3e-5 as "in one plane";
// a term in |coordinates| judged a small figure far from the origin by where
// it sits rather than by its size. And every computation runs about a point
// of the configuration (P0, the vertex centroid), so its rounding is at the
// configuration's size too. The one degenerate case, every point at one
// place, is caught explicitly.

// ---------------------------------------------------------------------------
// R5 — spheres by tangency
// ---------------------------------------------------------------------------

// The radius of the sphere centred at `center` tangent to `plane`: the
// distance to it. A centre ON the plane would give a sphere of radius 0.
// `centerName` and `planeText` are the author's words, for the refusal.
export function radiusTangentToPlane(center: Vec3, plane: Plane3, centerName: string, planeText: string): number {
  const radius = pointPlaneDistance(center, plane)
  // Negligible next to how far P is from the plane's own point: P lies in
  // the plane to within an angle of GEOM_EPS.
  if (radius <= GEOM_EPS * distance3(center, plane.point)) {
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
  const eps = GEOM_EPS * Math.max(d, other.radius)
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

// A number in a refusal: six significant figures, trailing zeros dropped —
// so a small solid's height and radius stay distinguishable in the text
// (fix round 1: svg.ts's fmt, three decimals, printed "height 0.001, radius
// 0" for a cylinder 0.0007 high and 0.0003 across). Coordinates in messages
// stay on authorText, which every solid-figure message shares.
function numberText(n: number): string {
  return String(Number(n.toPrecision(6)))
}

function listText(items: readonly string[]): string {
  return items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

// A point set's spread about its own centroid, which is what a tolerance is
// scaled by — so a solid is judged by its own size, never by where it sits
// or by an absolute floor (fix round 2). Zero only when every point is at
// one place.
function extentOf(points: readonly Vec3[]): number {
  const centre = centroid3([...points])
  let extent = 0
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
  // Every point at one place: no line, let alone a plane or a sphere.
  if (extent === 0) return null
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
interface FitAbout extends SphereFit {
  // The centre as P0 + offset: the check runs on the offset, at the
  // configuration's own size, not on the centre's absolute coordinates.
  p0: Vec3
  offset: Vec3
}

function sphereThrough(points: readonly Vec3[], basis: readonly number[]): FitAbout {
  const p0 = points[basis[0]]
  const rows = basis.slice(1).map((k) => sub3(points[k], p0))
  const u = cramer(
    rows.map((d) => [2 * d.x, 2 * d.y, 2 * d.z]),
    rows.map((d) => dot3(d, d))
  )
  const offset = { x: u[0], y: u[1], z: u[2] }
  return { center: add3(p0, offset), radius: length3(offset), p0, offset }
}

// The first vertex, in vertex order, that is not on the sphere; -1 when all
// of them are. The tolerance is GEOM_EPS scaled by the POINTS' own size and
// never by the fitted radius (fix round 1): four points barely off one plane
// fit an enormous sphere, and a tolerance that grew with it accepted a
// non-cyclic solid (a 1 x 1 x 0.01 slab with one base corner nudged 1.5e-9
// off the base fitted R = 3e7 and passed).
function firstOffSphere(points: readonly Vec3[], fit: FitAbout): number {
  const eps = GEOM_EPS * extentOf(points)
  return points.findIndex((p) => Math.abs(length3(sub3(sub3(p, fit.p0), fit.offset)) - fit.radius) > eps)
}

// "solid circumsphere A-B-C-D": the sphere through four named points,
// checked against all four like any other answer. It is exact by
// construction when the points are well apart from one plane; when they are
// barely off it, the sphere is so large that it cannot be fixed to within
// tolerance, and the check refuses it rather than draw it.
export function circumsphereOfPoints(points: readonly Vec3[], names: readonly string[]): SphereFit {
  const basis = circumBasis(points)
  const coplanar = () =>
    new Error(`${listText(names)} lie in one plane, so no sphere passes through all four — a circumsphere needs four points not in one plane`)
  if (!basis) throw coplanar()
  const fit = sphereThrough(points, basis)
  const off = firstOffSphere(points, fit)
  if (off >= 0) {
    throw new Error(
      `${listText(names)} lie so nearly in one plane that no sphere through all four can be fixed — the sphere through ${listText(basis.map((i) => names[i]))} misses ${names[off]} by more than rounding allows`
    )
  }
  return { center: fit.center, radius: fit.radius }
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
  return { center: fit.center, radius: fit.radius }
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
  const eps = GEOM_EPS * Math.max(local.radius, ...local.through.map(length3))
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

// ---------------------------------------------------------------------------
// R3 — the insphere of a polyhedron, by a fixed-order solve, verified
// ---------------------------------------------------------------------------

// A face as its plane n . x = d, n the OUTWARD unit normal. The normal is
// Newell's (exact for a planar polygon, whatever its winding) turned away
// from the vertex centroid, which is inside a convex solid — so nothing here
// depends on how a builder wound its faces.
interface FacePlane {
  normal: Vec3
  offset: number
  centre: Vec3
}

function facePlanes(solid: Solid3D): FacePlane[] {
  const inside = centroid3(solid.vertices)
  return solid.faces.map((face) => {
    const corners = face.map((i) => solid.vertices[i])
    let n = { x: 0, y: 0, z: 0 }
    corners.forEach((p, k) => {
      const q = corners[(k + 1) % corners.length]
      n = add3(n, { x: (p.y - q.y) * (p.z + q.z), y: (p.z - q.z) * (p.x + q.x), z: (p.x - q.x) * (p.y + q.y) })
    })
    const centre = centroid3(corners)
    let normal = scale3(n, 1 / length3(n))
    if (dot3(normal, sub3(centre, inside)) < 0) normal = scale3(normal, -1)
    return { normal, offset: dot3(normal, centre), centre }
  })
}

// The first four faces, in face order, whose rows (n, 1) are independent —
// the stated scan order: a face is taken when its row is not a combination
// of the rows already taken (its residual after removing their span, by
// Gram-Schmidt in that order, is not negligible). For a bounded solid four
// always exist: rows spanning less would put every normal in one plane or on
// one cone, and a closed surface's area-weighted normals sum to zero.
function inBasis(faces: readonly FacePlane[]): number[] {
  const taken: number[] = []
  const basis: number[][] = []
  faces.forEach((face, i) => {
    if (taken.length === 4) return
    let row = [face.normal.x, face.normal.y, face.normal.z, 1]
    for (const e of basis) {
      const along = row.reduce((s, v, k) => s + v * e[k], 0)
      row = row.map((v, k) => v - along * e[k])
    }
    const size = Math.hypot(...row)
    if (size <= GEOM_EPS * Math.SQRT2) return
    taken.push(i)
    basis.push(row.map((v) => v / size))
  })
  return taken
}

function faceText(solid: Solid3D, faceIndex: number, names: VertexNames): string {
  const face = solid.faces[faceIndex]
  const letters = face.map((i) => names[i])
  if (letters.every((name): name is string => name !== undefined)) {
    return `the face ${letters.join(letters.every((name) => name.length === 1) ? '' : '-')}`
  }
  return `the face centred at ${authorText(centroid3(face.map((i) => solid.vertices[i])))}`
}

// A polyhedron's insphere. Every face is n_i . x = d_i with n_i outward, so
// a point c inside is d_i - n_i . c from face i. The insphere's centre is
// equally far, r, from all of them: n_i . c + r = d_i. The first four faces
// that fix (c, r) give a 4x4 system, solved by Cramer's rule (written about
// the vertex centroid g, c = g + u, so the arithmetic is at the solid's own
// size); then EVERY face is checked: strictly in front of c, and at r. A
// solid with no such point (a box that is not a cube) is refused, naming the
// first face that fails — never drawn with a sphere touching some faces. The
// "only candidate centre" is exactly that: the four faces fix (c, r) uniquely,
// so if it fails any face, no point is equidistant from all of them.
//
// For a tetrahedron this is the face-area-weighted mean of the vertices
// (each weighted by the area of the face opposite it), the spec's formula;
// the tests pin that identity.
function insphereOfPolyhedron(solid: Solid3D, title: string, names: VertexNames): SphereFit {
  // Everything about the vertex centroid g (fix round 2): the face planes,
  // the solve and the check all run at the solid's own size, so a small
  // solid far from the origin loses nothing to its coordinates' rounding.
  const g = centroid3(solid.vertices)
  const about: Solid3D = { vertices: solid.vertices.map((v) => sub3(v, g)), faces: solid.faces }
  const faces = facePlanes(about)
  const basis = inBasis(faces)
  // Unreachable for a solid (see inBasis); a guard, so nothing is ever
  // solved from fewer rows than unknowns.
  if (basis.length < 4) throw new Error(`"${title}" has no inscribed sphere — its faces do not fix a centre`)
  const [ux, uy, uz, r] = cramer(
    basis.map((i) => [faces[i].normal.x, faces[i].normal.y, faces[i].normal.z, 1]),
    basis.map((i) => faces[i].offset)
  )
  const u = { x: ux, y: uy, z: uz }
  const center = add3(g, u)
  // The solid's own size only, never the solved radius (as fix round 1 did
  // for the circumsphere): a wild solve must not widen its own check.
  const eps = GEOM_EPS * extentOf(about.vertices)
  const refuse = (detail: string) =>
    new Error(`"${title}" has no inscribed sphere — no point inside it is equidistant from all ${faces.length} of its faces: ${detail}`)
  for (let i = 0; i < faces.length; i++) {
    const distance = faces[i].offset - dot3(faces[i].normal, u)
    if (distance <= eps || r <= eps) throw refuse(`the only candidate centre lies on or outside ${faceText(solid, i, names)}`)
    if (Math.abs(distance - r) > eps) {
      throw refuse(`${faceText(solid, i, names)} is ${numberText(distance)} from the only candidate centre, not ${numberText(r)}`)
    }
  }
  return { center, radius: r }
}

// ---------------------------------------------------------------------------
// R4 — the insphere of a round solid, closed form in its own frame
// ---------------------------------------------------------------------------

// Where a sphere centred on the axis at height y touches the side through
// the rim points (r1, y1) and (r2, y2): the foot on that generator, in the
// local xy half-plane. The check is then that the foot is one radius away.
function footOnSide(y: number, r1: number, y1: number, r2: number, y2: number): Vec3 {
  const a = { x: r1, y: y1, z: 0 }
  const d = { x: r2 - r1, y: y2 - y1, z: 0 }
  const t = dot3(sub3({ x: 0, y, z: 0 }, a), d) / dot3(d, d)
  return add3(a, scale3(d, t))
}

function localInsphere(body: SolidBody, title: string): LocalSphere {
  const spec = body.spec
  switch (spec.kind) {
    case 'cylinder': {
      // Only when h = 2r: then radius r at the middle, touching both ends
      // and the side.
      const { radius: r, height: h } = spec
      if (Math.abs(h - 2 * r) > GEOM_EPS * h) {
        throw new Error(
          `"${title}" has no inscribed sphere — a sphere touches both ends and the side of ${title} only when its height is twice its radius ` +
            `(height ${numberText(h)}, radius ${numberText(r)})`
        )
      }
      return {
        y: 0,
        radius: r,
        through: [
          { x: 0, y: -h / 2, z: 0 },
          { x: 0, y: h / 2, z: 0 },
          { x: r, y: 0, z: 0 },
        ],
      }
    }
    case 'cone': {
      // Always: rho = R H / (R + sqrt(R^2 + H^2)), the inradius of the
      // cone's axial triangle, rho above the base.
      const { radius: r, height: h } = spec
      const rho = (r * h) / (r + Math.hypot(r, h))
      const y = -h / 2 + rho
      return { y, radius: rho, through: [{ x: 0, y: -h / 2, z: 0 }, footOnSide(y, r, -h / 2, 0, h / 2)] }
    }
    case 'frustum': {
      // Only when h = 2 sqrt(r1 r2): then radius h/2 at mid-height.
      const { bottom: r1, top: r2 } = frustumRadii(spec)
      const h = spec.height
      const needed = 2 * Math.sqrt(r1 * r2)
      if (Math.abs(h - needed) > GEOM_EPS * h) {
        throw new Error(
          `"${title}" has no inscribed sphere — a sphere touches both rims and the side of ${title} only when its height is ` +
            `2 sqrt(r1 r2) = ${numberText(needed)} (height ${numberText(h)})`
        )
      }
      return {
        y: 0,
        radius: h / 2,
        through: [{ x: 0, y: -h / 2, z: 0 }, { x: 0, y: h / 2, z: 0 }, footOnSide(0, r1, -h / 2, r2, h / 2)],
      }
    }
    case 'sphere':
      throw new Error(`"${title}" is already a sphere — it is its own inscribed sphere`)
    default:
      // Unreachable: every other solid is a polyhedron.
      throw new Error(`"${title}" has no inscribed sphere`)
  }
}

// "solid insphere of S": R3 for a polyhedron, R4 for a round solid.
export function insphereOf(body: SolidBody, title: string, names: VertexNames = []): SphereFit {
  if (body.polyhedron) return insphereOfPolyhedron(body.polyhedron, title, names)
  return placeLocal(body, localInsphere(body, title), title, 'inscribed')
}
