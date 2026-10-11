import { GEOM_EPS } from '../scene/geometry/types'
import type { Vec2 } from '../scene/types'
import type { Solid3D, Vec3 } from './project3d'
import { dot3, scale3, sub3 } from './construct3d'
import { frustumRadii, type SolidBody, type SolidSpec } from './solids'
import { authorText, describeAuthorPlane } from './authorFrame'
import { planeOfSection, signedDistance } from './plane'
import { isIdentityPlacement, rotateToLocal, rotateToWorld, toLocal, toWorld, type Placement } from './silhouette'
import { localSection, type LocalSection, type SectionPiece } from './conicSection'

// Plane ∩ solid.
//
// ---------------------------------------------------------------------------
// H5 — a cross-section is 2D geometry
// ---------------------------------------------------------------------------
//
// A section is a plane figure. So this module's job ends at geometry: it
// returns the section in space (for the shaded-in-place form) and the section
// in its own plane (for the lifted true-shape form), and the lifted one goes
// back through the ORDINARY 2D figure path, where measures, notation and
// label layout already work.
//
// Growing a parallel pipeline inside the 3D layer instead would mean building
// a second figure renderer, and every 2D capability twice.

export const PLANE_AXES = ['x', 'y', 'z'] as const

export type PlaneAxis = (typeof PLANE_AXES)[number]

// Q1 (phase 8) — one internal plane, in two forms.
//
// The AXIS form is phase 5's: a plane square to an internal axis, `axis = at`.
// Every author form whose normal is parallel to an axis canonicalises to it
// (figure/plane.ts), so "plane A-B-C" through three points at author z = 1 is
// this object exactly, cut by the code path and drawn in the bytes that
// "plane z = 1" always was. `source` is the author's text when the plane was
// written some other way, for a message; "plane z = 1" itself carries none,
// and its messages print "z = 1" as they always did.
//
// The GENERAL form is any other plane: a point on it (the foot of the
// origin), its unit normal facing the default camera, and an orthonormal
// in-plane frame (u, v) with u x v = normal and v as near author Z as the
// plane allows. `source` is the plane as the author wrote it.
export type SectionPlane =
  | { kind: 'axis'; axis: PlaneAxis; at: number; source?: string }
  | { kind: 'general'; point: Vec3; normal: Vec3; u: Vec3; v: Vec3; source: string }

type AxisPlane = Extract<SectionPlane, { kind: 'axis' }>

// The section, in space. A polygon for a polyhedron; a circle for a plane
// square to a cylinder's, a cone's or a sphere's axis, and for any plane
// through a sphere; and (Q5, phase 8) a REGION bounded by straight chords and
// elliptical arcs — an oblique cut of a cylinder, cone or frustum. A region's
// pieces chain end to end, closed; a whole ellipse is one arc of a full turn.
// A circle stays a circle, so every axis cut keeps its shape and its bytes.
export type Section =
  | { kind: 'polygon'; points: Vec3[] }
  | { kind: 'circle'; center: Vec3; radius: number }
  | { kind: 'region'; boundary: SectionPiece[] }

export type { SectionPiece }

// A piece of a region's boundary in the plane: a chord, or the arc
// `center + u cos t + v sin t` for t from `from` to `to`.
export type TrueShapePiece =
  | { kind: 'segment'; a: Vec2; b: Vec2 }
  | { kind: 'arc'; center: Vec2; u: Vec2; v: Vec2; from: number; to: number }

// The same section, in its OWN plane — the true shape, at true size. A
// region's vectors are expressed in the plane's own frame (Q5).
export type TrueShape =
  | { kind: 'polygon'; vertices: Vec2[] }
  | { kind: 'circle'; center: Vec2; radius: number }
  | { kind: 'region'; boundary: TrueShapePiece[] }

// ---------------------------------------------------------------------------
// The plane's own 2D frame
// ---------------------------------------------------------------------------

// **The two world coordinates the plane does not fix, in x, y, z order.**
//
// A section has to be laid down in its plane somehow, and the convention has
// to be stated for the same reason a solid's placement does (H1): without one,
// "the section of this prism" is a shape with no orientation. Keeping the
// remaining coordinates in their own order means a width stays a width — a
// horizontal cut of an 8-by-5-by-6 prism comes out 8 across and 6 down, not
// transposed.
//
// A general plane's own frame is (u, v) about its point (Q1).
export function inPlane(plane: SectionPlane, p: Vec3): Vec2 {
  if (plane.kind === 'general') {
    const d = sub3(p, plane.point)
    return { x: dot3(d, plane.u), y: dot3(d, plane.v) }
  }
  switch (plane.axis) {
    case 'x':
      return { x: p.y, y: p.z }
    case 'y':
      return { x: p.x, y: p.z }
    case 'z':
      return { x: p.x, y: p.y }
  }
}

// A VECTOR lying in the plane, in the plane's own frame: the linear part of
// `inPlane`. A region's arcs carry their conjugate semi-diameters this way.
export function inPlaneVector(plane: SectionPlane, v: Vec3): Vec2 {
  if (plane.kind === 'general') return { x: dot3(v, plane.u), y: dot3(v, plane.v) }
  return inPlane(plane, v)
}

// The two radius vectors of a circle lying in the plane, for a circle of the
// given radius. Their order matches `inPlane`'s, so a circle's own angle and
// its true-shape angle agree.
export function planeRadii(plane: SectionPlane, radius: number): [Vec3, Vec3] {
  if (plane.kind === 'general') return [scale3(plane.u, radius), scale3(plane.v, radius)]
  switch (plane.axis) {
    case 'x':
      return [
        { x: 0, y: radius, z: 0 },
        { x: 0, y: 0, z: radius },
      ]
    case 'y':
      return [
        { x: radius, y: 0, z: 0 },
        { x: 0, y: 0, z: radius },
      ]
    case 'z':
      return [
        { x: radius, y: 0, z: 0 },
        { x: 0, y: radius, z: 0 },
      ]
  }
}

// ---------------------------------------------------------------------------
// Polyhedra
// ---------------------------------------------------------------------------

// Every edge of the solid, once. Reads the face list the same way projectSolid
// does, so the two cannot disagree about what an edge is.
function edgesOf(solid: Solid3D): [number, number][] {
  const seen = new Set<string>()
  const edges: [number, number][] = []
  for (const face of solid.faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i]
      const b = face[(i + 1) % face.length]
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push([a, b])
    }
  }
  return edges
}

// Where the plane crosses each edge, wound into a polygon.
//
// Q3 (phase 8) — which side of the plane a vertex is on is its SIGNED
// DISTANCE, `normal . p - normal . point` (plane.ts), so the walk takes any
// plane; for the axis form that is "coordinate - at", exactly the arithmetic
// phase 5 did. A plane containing a whole face returns that face (its
// corners are the on-plane vertices, and nothing crosses). A plane that only
// TOUCHES the solid — every vertex on one side, and only a vertex or an edge
// on the plane — is refused rather than drawn as a degenerate polygon.
//
// The solid is convex — not by a runtime guard (one was planned and
// deliberately not built: every solid reachable from the DSL comes from
// SOLID_PRIMITIVES, so a guard would be a branch no input can reach) but by
// the convexity invariant `solids.test.ts` pins for every primitive — so the
// section is a convex polygon and sorting the crossings by angle about their
// own centroid is both correct and the deterministic winding a drawing needs.
function polyhedronSection(solid: Solid3D, plane: SectionPlane, name: string): Section {
  const points: Vec3[] = []
  for (const [i, j] of edgesOf(solid)) {
    const a = solid.vertices[i]
    const b = solid.vertices[j]
    const da = signedDistance(plane, a)
    const db = signedDistance(plane, b)
    // An endpoint ON the plane counts once, through whichever edge finds it;
    // the dedupe below removes the repeats.
    if (Math.abs(da) <= GEOM_EPS) points.push(a)
    if (Math.abs(db) <= GEOM_EPS) points.push(b)
    if (Math.abs(da) <= GEOM_EPS || Math.abs(db) <= GEOM_EPS) continue
    if (da * db > 0) continue
    const t = da / (da - db)
    points.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) })
  }

  const unique: Vec3[] = []
  for (const p of points) {
    if (unique.some((q) => Math.abs(q.x - p.x) <= GEOM_EPS && Math.abs(q.y - p.y) <= GEOM_EPS && Math.abs(q.z - p.z) <= GEOM_EPS)) {
      continue
    }
    unique.push(p)
  }
  if (unique.length === 1) throw touches(plane, name, `at the vertex ${authorText(unique[0])}`)
  if (unique.length === 2) throw touches(plane, name, `along the edge ${authorText(unique[0])}-${authorText(unique[1])}`)
  if (unique.length < 3) throw missesSolid(plane, name)

  return { kind: 'polygon', points: windPolygon(unique, plane) }
}

// Q1's vertex order: by angle about the centroid, in the plane's own frame.
function windPolygon(unique: Vec3[], plane: SectionPlane): Vec3[] {
  const flat = unique.map((p) => inPlane(plane, p))
  const centre = flat.reduce((acc, p) => ({ x: acc.x + p.x / flat.length, y: acc.y + p.y / flat.length }), { x: 0, y: 0 })
  const order = flat
    .map((p, index) => ({ index, angle: windingAngle(plane, p.y - centre.y, p.x - centre.x), p }))
    .sort((a, b) => a.angle - b.angle || a.p.x - b.p.x || a.p.y - b.p.y)
  return order.map((entry) => unique[entry.index])
}

// Q1's winding: by angle about the centroid in the plane's own frame,
// counter-clockwise, from atan2's cut at 9 o'clock. For a GENERAL plane a
// vertex exactly at 9 o'clock (angle pi) is taken as -pi, so it is always
// the FIRST vertex and never the last by the sign of a rounding error in its
// v — the regular hexagon a cube's central cut makes puts a vertex exactly
// there. The axis form keeps phase 5's bare atan2, and its bytes.
function windingAngle(plane: SectionPlane, dy: number, dx: number): number {
  const angle = Math.atan2(dy, dx)
  if (plane.kind === 'general' && angle > Math.PI - GEOM_EPS) return angle - 2 * Math.PI
  return angle
}

// A plane that meets the solid in a vertex or an edge and nothing more.
// Every vertex is on one side of it (or on it), so it touches the solid
// without cutting through: there is no section to draw.
function touches(plane: SectionPlane, name: string, where: string): Error {
  return new Error(`The plane ${describeAuthorPlane(plane)} meets "${name}" only ${where} — it does not cut through it`)
}

function missesSolid(plane: SectionPlane, name: string): Error {
  return new Error(`The plane ${describeAuthorPlane(plane)} does not cut "${name}" — it misses the solid entirely`)
}

// ---------------------------------------------------------------------------
// The section of any solid
// ---------------------------------------------------------------------------

export function sectionOf(body: SolidBody, plane: SectionPlane, name: string): Section {
  if (body.polyhedron) return polyhedronSection(body.polyhedron, plane, name)
  // An axis plane through an upright round solid keeps phase 5's and phase
  // 7's own code paths, and their bytes. Every other cut of a round solid —
  // an oblique plane, or any plane through a tilted solid — is solved in the
  // solid's own frame (Q4).
  if (plane.kind === 'axis') {
    if (isIdentityPlacement(body.placement)) return curvedSection(body.spec, plane, name)
    if (isUpright(body.placement)) return placedSection(body, plane, name)
  }
  return roundSection(body, plane, name)
}

function isUpright(placement: Placement): boolean {
  return Math.abs(Math.abs(placement.frame.axis.y) - 1) <= GEOM_EPS
}

// ---------------------------------------------------------------------------
// Q4 — a round solid by any plane, in its own frame
// ---------------------------------------------------------------------------
//
// The world plane becomes `n . p = d` in the solid's local frame (P1: centred,
// axis +y), conicSection.ts solves it there in closed form, and the answer is
// carried back out: points through the placement, vectors through its
// rotation. This is what lifts P7's refusal of a tilted round solid.
function roundSection(body: SolidBody, plane: SectionPlane, name: string): Section {
  const world = planeOfSection(plane)
  const n = rotateToLocal(body.placement, world.normal)
  const d = dot3(n, toLocal(body.placement, world.point))
  const where = describeAuthorPlane(plane)
  const local = localSection(body.spec, n, d, {
    misses: () => missesSolid(plane, name),
    touches: (at) => new Error(`The plane ${where} meets "${name}" only ${at} — it does not cut through it`),
    tangent: () => tangentTo(plane, name),
    conic: (kind) => new Error(`The plane ${where} cuts "${name}" in a ${kind}, which is not drawn — only circles and ellipses are`),
  })
  return worldSection(local, body.placement, plane)
}

function tangentTo(plane: SectionPlane, name: string): Error {
  return new Error(`The plane ${describeAuthorPlane(plane)} touches "${name}" at one point — it does not cut through it`)
}

function worldSection(local: LocalSection, placement: Placement, plane: SectionPlane): Section {
  switch (local.kind) {
    case 'circle':
      return { kind: 'circle', center: toWorld(placement, local.center), radius: local.radius }
    case 'polygon':
      return { kind: 'polygon', points: windPolygon(local.points.map((p) => toWorld(placement, p)), plane) }
    case 'region': {
      const boundary = local.boundary.map(
        (piece): SectionPiece =>
          piece.kind === 'segment'
            ? { kind: 'segment', a: toWorld(placement, piece.a), b: toWorld(placement, piece.b) }
            : {
                kind: 'arc',
                center: toWorld(placement, piece.center),
                u: rotateToWorld(placement, piece.u),
                v: rotateToWorld(placement, piece.v),
                from: piece.from,
                to: piece.to,
              }
      )
      return { kind: 'region', boundary: orderRegion(boundary, plane) }
    }
  }
}

// Q5's boundary order, fixed so a region's corners can be named: counter-
// clockwise in the plane's own frame (the frame a lifted section is drawn
// in), starting with the chord lowest in that frame — its midpoint's v, then
// its u — so a region's first corner is the left end of its lowest chord.
// A whole ellipse has no chord and keeps its one arc.
function orderRegion(boundary: SectionPiece[], plane: SectionPlane): SectionPiece[] {
  const arc = boundary.find((piece) => piece.kind === 'arc')
  let pieces = boundary
  if (arc && arc.kind === 'arc') {
    const u = inPlaneVector(plane, arc.u)
    const v = inPlaneVector(plane, arc.v)
    // Increasing t turns counter-clockwise when u x v > 0; every arc of one
    // boundary runs the same way round, so one arc decides.
    if ((u.x * v.y - u.y * v.x) * (arc.to - arc.from) < 0) {
      pieces = [...boundary].reverse().map(
        (piece): SectionPiece =>
          piece.kind === 'segment' ? { kind: 'segment', a: piece.b, b: piece.a } : { ...piece, from: piece.to, to: piece.from }
      )
    }
  }
  let first = -1
  let lowest = { x: Infinity, y: Infinity }
  pieces.forEach((piece, i) => {
    if (piece.kind !== 'segment') return
    const mid = inPlane(plane, { x: (piece.a.x + piece.b.x) / 2, y: (piece.a.y + piece.b.y) / 2, z: (piece.a.z + piece.b.z) / 2 })
    if (mid.y < lowest.y - GEOM_EPS || (Math.abs(mid.y - lowest.y) <= GEOM_EPS && mid.x < lowest.x)) {
      first = i
      lowest = mid
    }
  })
  return first <= 0 ? pieces : [...pieces.slice(first), ...pieces.slice(0, first)]
}

// ---------------------------------------------------------------------------
// P7 — sections of a PLACED, UPRIGHT round solid by an axis plane
// ---------------------------------------------------------------------------
//
// A round solid placed by points (P1) with its axis author-vertical: its
// local frame is the world's, turned about the vertical by at most a half
// turn, and every axis plane stays an axis plane. It is cut where it actually
// is: the world plane's offset is converted into the local frame, the section
// solved there, and its points carried back out. (A TILTED round solid, which
// P7 refused, is cut by roundSection above since phase 8.)
function placedSection(body: SolidBody, plane: AxisPlane, name: string): Section {
  const { origin, frame } = body.placement
  // A vertical frame is (u, axis, w) = (+-x, +-y, z) exactly (see
  // frameForAxis), so each world axis is one local axis, perhaps reversed.
  const sign: Record<PlaneAxis, number> = { x: Math.sign(frame.u.x), y: Math.sign(frame.axis.y), z: Math.sign(frame.w.z) }
  const toLocalPlane = (p: AxisPlane): AxisPlane => ({ kind: 'axis', axis: p.axis, at: (p.at - origin[p.axis]) * sign[p.axis] })
  const toWorldPlane = (p: AxisPlane): AxisPlane => ({ ...p, kind: 'axis', axis: p.axis, at: p.at * sign[p.axis] + origin[p.axis] })
  const local = curvedSection(body.spec, toLocalPlane(plane), name, toWorldPlane)
  return placeSection(local, body.placement)
}

function placeSection(section: Section, placement: Placement): Section {
  if (section.kind === 'circle') return { kind: 'circle', center: toWorld(placement, section.center), radius: section.radius }
  if (section.kind === 'region') throw new Error('An axis section of an upright round solid is a circle or a polygon')
  return { kind: 'polygon', points: section.points.map((p) => toWorld(placement, p)) }
}

// Solved in closed form per primitive, never by faceting and cutting the
// facets: a circle is the answer, and a 96-gon is a picture of the answer.
//
// `plane` is in the solid's own frame; `world` converts it back for a
// message, so an author reads the plane they wrote (P7).
function curvedSection(
  spec: SolidSpec,
  plane: AxisPlane,
  name: string,
  world: (p: AxisPlane) => AxisPlane = (p) => p
): Section {
  const misses = () => missesSolid(world(plane), name)
  switch (spec.kind) {
    case 'sphere': {
      const inside = spec.radius * spec.radius - plane.at * plane.at
      // Q4 (phase 8): tangent is not "misses".
      if (Math.abs(inside) <= GEOM_EPS) throw tangentTo(world(plane), name)
      if (inside <= GEOM_EPS) throw misses()
      return { kind: 'circle', center: centreOnPlane(plane), radius: Math.sqrt(inside) }
    }
    case 'cylinder': {
      const y = spec.height / 2
      if (plane.axis === 'y') {
        if (Math.abs(plane.at) > y + GEOM_EPS) throw misses()
        return { kind: 'circle', center: { x: 0, y: plane.at, z: 0 }, radius: spec.radius }
      }
      // A plane parallel to the axis cuts a rectangle: as deep as the chord
      // it takes across the circular cross-section, as tall as the cylinder.
      const inside = spec.radius * spec.radius - plane.at * plane.at
      if (inside <= GEOM_EPS) throw misses()
      const half = Math.sqrt(inside)
      return { kind: 'polygon', points: rectangleInPlane(plane, half, y) }
    }
    case 'cone': {
      const y = spec.height / 2
      if (plane.axis === 'y') {
        if (plane.at < -y - GEOM_EPS || plane.at > y + GEOM_EPS) throw misses()
        const radius = (spec.radius * (y - plane.at)) / spec.height
        if (radius <= GEOM_EPS) {
          throw new Error(`The plane ${describeAuthorPlane(world(plane))} meets "${name}" only at its apex, which is a point and not a section`)
        }
        return { kind: 'circle', center: { x: 0, y: plane.at, z: 0 }, radius }
      }
      // Through the axis, the section is the cone's own triangle. Off the
      // axis it is a hyperbola, and refusing is the honest answer: this phase
      // draws polygons, circles and ellipses, and a branch of a hyperbola is
      // none of them.
      if (Math.abs(plane.at) > GEOM_EPS) throw hyperbola('cone', plane, name, world)
      return { kind: 'polygon', points: coneTriangle(plane, spec.radius, y) }
    }
    case 'frustum': {
      // P2 — square to the axis, a circle whose radius runs linearly from the
      // base rim's to the top rim's; through the axis, the isosceles
      // trapezoid of the two rims' diameters; parallel to the axis but off
      // it, a hyperbola, refused as a cone's is.
      const { bottom, top } = frustumRadii(spec)
      const y = spec.height / 2
      if (plane.axis === 'y') {
        if (Math.abs(plane.at) > y + GEOM_EPS) throw misses()
        const radius = bottom + ((top - bottom) * (plane.at + y)) / spec.height
        return { kind: 'circle', center: { x: 0, y: plane.at, z: 0 }, radius }
      }
      if (Math.abs(plane.at) >= bottom - GEOM_EPS) throw misses()
      if (Math.abs(plane.at) > GEOM_EPS) throw hyperbola('frustum', plane, name, world)
      return { kind: 'polygon', points: frustumTrapezoid(plane, bottom, top, y) }
    }
    default:
      throw new Error(`"${name}" cannot be cut`)
  }
}

// The refusal of a plane parallel to a round solid's axis but off it. The
// wording is phase 5's for the cone, unchanged.
function hyperbola(kind: 'cone' | 'frustum', plane: AxisPlane, name: string, world: (p: AxisPlane) => AxisPlane): Error {
  return new Error(
    `A plane parallel to a ${kind}'s axis but off it cuts "${name}" in a HYPERBOLA, which this phase does not draw — ` +
      `use ${describeAuthorPlane(world({ kind: 'axis', axis: plane.axis, at: 0 }))} for the axial ${kind === 'cone' ? 'triangle' : 'trapezoid'}, or cut square to the axis for a circle`
  )
}

function centreOnPlane(plane: AxisPlane): Vec3 {
  return {
    x: plane.axis === 'x' ? plane.at : 0,
    y: plane.axis === 'y' ? plane.at : 0,
    z: plane.axis === 'z' ? plane.at : 0,
  }
}

// The rectangle a plane parallel to a y-axis cylinder cuts: `half` either side
// across the plane's own first coordinate direction, `y` above and below.
function rectangleInPlane(plane: AxisPlane, half: number, y: number): Vec3[] {
  const across = plane.axis === 'x' ? 'z' : 'x'
  const corner = (side: number, up: number): Vec3 => ({
    x: plane.axis === 'x' ? plane.at : across === 'x' ? side * half : 0,
    y: up * y,
    z: plane.axis === 'z' ? plane.at : across === 'z' ? side * half : 0,
  })
  return [corner(1, -1), corner(1, 1), corner(-1, 1), corner(-1, -1)]
}

// The triangle a plane through a cone's axis cuts: the two ends of the base
// diameter that lies in the plane, and the apex.
function coneTriangle(plane: AxisPlane, radius: number, y: number): Vec3[] {
  const across = plane.axis === 'x' ? 'z' : 'x'
  const base = (side: number): Vec3 => ({
    x: plane.axis === 'x' ? 0 : across === 'x' ? side * radius : 0,
    y: -y,
    z: plane.axis === 'z' ? 0 : across === 'z' ? side * radius : 0,
  })
  return [base(-1), base(1), { x: 0, y, z: 0 }]
}

// The trapezoid a plane through a frustum's axis cuts: the base rim's
// diameter in the plane, then the top rim's, wound round.
function frustumTrapezoid(plane: AxisPlane, bottom: number, top: number, y: number): Vec3[] {
  const across = plane.axis === 'x' ? 'z' : 'x'
  const at = (side: number, level: number): Vec3 => ({
    x: across === 'x' ? side : 0,
    y: level,
    z: across === 'z' ? side : 0,
  })
  return [at(-bottom, -y), at(bottom, -y), at(top, y), at(-top, y)]
}

// ---------------------------------------------------------------------------
// The lifted true shape
// ---------------------------------------------------------------------------

// The section as ordinary 2D geometry, at true size, in its own plane's frame.
// This is what goes back to the figure renderer (H5).
export function trueShape(section: Section, plane: SectionPlane): TrueShape {
  if (section.kind === 'circle') return { kind: 'circle', center: inPlane(plane, section.center), radius: section.radius }
  if (section.kind === 'region') {
    return {
      kind: 'region',
      boundary: section.boundary.map(
        (piece): TrueShapePiece =>
          piece.kind === 'segment'
            ? { kind: 'segment', a: inPlane(plane, piece.a), b: inPlane(plane, piece.b) }
            : {
                kind: 'arc',
                center: inPlane(plane, piece.center),
                u: inPlaneVector(plane, piece.u),
                v: inPlaneVector(plane, piece.v),
                from: piece.from,
                to: piece.to,
              }
      ),
    }
  }
  return { kind: 'polygon', vertices: section.points.map((p) => inPlane(plane, p)) }
}

// A region's CORNERS, where an arc meets a chord, in boundary order from the
// first chord's start (Q5): what "vertices PQ..." names. A whole ellipse has
// none.
export function regionCorners(boundary: readonly TrueShapePiece[]): Vec2[] {
  const corners: Vec2[] = []
  boundary.forEach((piece, i) => {
    const before = boundary[(i + boundary.length - 1) % boundary.length]
    if (boundary.length > 1 && before.kind !== piece.kind) corners.push(pieceStart2(piece))
  })
  return corners
}

export function pieceStart2(piece: TrueShapePiece): Vec2 {
  if (piece.kind === 'segment') return piece.a
  return {
    x: piece.center.x + piece.u.x * Math.cos(piece.from) + piece.v.x * Math.sin(piece.from),
    y: piece.center.y + piece.u.y * Math.cos(piece.from) + piece.v.y * Math.sin(piece.from),
  }
}

// Where a lifted section sits: **beside the solid, never on top of it**.
//
// A section lifted out in place would overlap the drawing it came from, and
// the two are different pictures of different things. The convention, stated
// so it stays deterministic: the section's bounding box is placed with its
// left edge one quarter of the solid's own width clear of the solid's right
// edge, and its vertical centre level with the solid's.
//
// **Several lifts stack (phase 11, N1).** Sections, nets and path unfoldings
// are all lifted, left to right in statement order, each clear of the one
// before: `rightEdge` is the running right edge of everything lifted so far,
// and the gap is taken from the larger of it and the solid's own right edge.
// With no earlier lift it is absent, and the arithmetic is exactly phase 5's
// (the max of a number with itself), so a single lift keeps its bytes.
export const SECTION_GAP_FRACTION = 0.25

// The clearance a net or a path's strip reserves in the gap before it: 10% of
// the figure's width is about 64 view units at FIGURE_SIZE 640 — a label a
// side (15-unit type, a few units off its vertex) and air between them.
export const NET_LABEL_CLEARANCE = 0.1

type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

export function liftOffset(solid: Bounds, shape: Bounds, rightEdge: number | null = null, clearance?: number): Vec2 {
  const quarter = (solid.maxX - solid.minX) * SECTION_GAP_FRACTION
  // A net's letters face the drawing (fix rounds 1 and 2): with a clearance
  // c, the gap is also at least the fraction c of the size the figure is
  // FITTED to — the larger of its width and its height (document.ts's
  // fitProjection) — which the fit then maps to c x FIGURE_SIZE view units:
  // room for a letter on each side of the gap, at any scale and any aspect.
  // The width is the span so far, the gap and the shape (solved for the
  // gap); the height is the taller of the solid and the shape, which sits
  // level with it. Absent (every section), the gap is phase 5's quarter, bit
  // for bit.
  const span = Math.max(solid.maxX, rightEdge ?? solid.maxX) - solid.minX
  const tall = Math.max(solid.maxY - solid.minY, shape.maxY - shape.minY)
  const gap =
    clearance === undefined
      ? quarter
      : Math.max(quarter, (clearance * (span + shape.maxX - shape.minX)) / (1 - clearance), clearance * tall)
  return {
    x: Math.max(solid.maxX, rightEdge ?? solid.maxX) + gap - shape.minX,
    y: (solid.minY + solid.maxY) / 2 - (shape.minY + shape.maxY) / 2,
  }
}
