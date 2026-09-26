import { GEOM_EPS } from '../scene/geometry/types'
import type { Vec2 } from '../scene/types'
import type { Solid3D, Vec3 } from './project3d'
import type { SolidBody, SolidSpec } from './solids'
import { describeAuthorPlane } from './authorFrame'

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

// Only axis-perpendicular planes.
//
// **Oblique planes are deferred, not forgotten.** For a polyhedron they are
// no harder — the edge-crossing walk below does not care about the plane's
// normal — but for the curved primitives they are the whole conic-section
// problem, and a grammar that accepted an oblique plane and then refused it
// for three of the six primitives would be worse than one that does not
// accept it yet.
export interface SectionPlane {
  axis: PlaneAxis
  at: number
}

// The section, in space. A polygon for a polyhedron; a circle for a plane
// square to a cylinder's, a cone's or a sphere's axis.
export type Section =
  | { kind: 'polygon'; points: Vec3[] }
  | { kind: 'circle'; center: Vec3; radius: number }

// The same section, in its OWN plane — the true shape, at true size.
export type TrueShape = { kind: 'polygon'; vertices: Vec2[] } | { kind: 'circle'; center: Vec2; radius: number }

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
export function inPlane(plane: SectionPlane, p: Vec3): Vec2 {
  switch (plane.axis) {
    case 'x':
      return { x: p.y, y: p.z }
    case 'y':
      return { x: p.x, y: p.z }
    case 'z':
      return { x: p.x, y: p.y }
  }
}

function coordinate(plane: SectionPlane, p: Vec3): number {
  return plane.axis === 'x' ? p.x : plane.axis === 'y' ? p.y : p.z
}

// The two radius vectors of a circle lying in the plane, for a circle of the
// given radius. Their order matches `inPlane`'s, so a circle's own angle and
// its true-shape angle agree.
export function planeRadii(plane: SectionPlane, radius: number): [Vec3, Vec3] {
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
    const da = coordinate(plane, a) - plane.at
    const db = coordinate(plane, b) - plane.at
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
  if (unique.length < 3) throw missesSolid(plane, name)

  const flat = unique.map((p) => inPlane(plane, p))
  const centre = flat.reduce((acc, p) => ({ x: acc.x + p.x / flat.length, y: acc.y + p.y / flat.length }), { x: 0, y: 0 })
  const order = flat
    .map((p, index) => ({ index, angle: Math.atan2(p.y - centre.y, p.x - centre.x), p }))
    .sort((a, b) => a.angle - b.angle || a.p.x - b.p.x || a.p.y - b.p.y)
  return { kind: 'polygon', points: order.map((entry) => unique[entry.index]) }
}

function missesSolid(plane: SectionPlane, name: string): Error {
  return new Error(`The plane ${describeAuthorPlane(plane)} does not cut "${name}" — it misses the solid entirely`)
}

// ---------------------------------------------------------------------------
// The section of any solid
// ---------------------------------------------------------------------------

export function sectionOf(body: SolidBody, plane: SectionPlane, name: string): Section {
  if (body.polyhedron) return polyhedronSection(body.polyhedron, plane, name)
  return curvedSection(body.spec, plane, name)
}

// Solved in closed form per primitive, never by faceting and cutting the
// facets: a circle is the answer, and a 96-gon is a picture of the answer.
function curvedSection(spec: SolidSpec, plane: SectionPlane, name: string): Section {
  switch (spec.kind) {
    case 'sphere': {
      const inside = spec.radius * spec.radius - plane.at * plane.at
      if (inside <= GEOM_EPS) throw missesSolid(plane, name)
      return { kind: 'circle', center: centreOnPlane(plane), radius: Math.sqrt(inside) }
    }
    case 'cylinder': {
      const y = spec.height / 2
      if (plane.axis === 'y') {
        if (Math.abs(plane.at) > y + GEOM_EPS) throw missesSolid(plane, name)
        return { kind: 'circle', center: { x: 0, y: plane.at, z: 0 }, radius: spec.radius }
      }
      // A plane parallel to the axis cuts a rectangle: as deep as the chord
      // it takes across the circular cross-section, as tall as the cylinder.
      const inside = spec.radius * spec.radius - plane.at * plane.at
      if (inside <= GEOM_EPS) throw missesSolid(plane, name)
      const half = Math.sqrt(inside)
      return { kind: 'polygon', points: rectangleInPlane(plane, half, y) }
    }
    case 'cone': {
      const y = spec.height / 2
      if (plane.axis === 'y') {
        if (plane.at < -y - GEOM_EPS || plane.at > y + GEOM_EPS) throw missesSolid(plane, name)
        const radius = (spec.radius * (y - plane.at)) / spec.height
        if (radius <= GEOM_EPS) {
          throw new Error(`The plane ${describeAuthorPlane(plane)} meets "${name}" only at its apex, which is a point and not a section`)
        }
        return { kind: 'circle', center: { x: 0, y: plane.at, z: 0 }, radius }
      }
      // Through the axis, the section is the cone's own triangle. Off the
      // axis it is a hyperbola, and refusing is the honest answer: this phase
      // draws polygons, circles and ellipses, and a branch of a hyperbola is
      // none of them.
      if (Math.abs(plane.at) > GEOM_EPS) {
        throw new Error(
          `A plane parallel to a cone's axis but off it cuts "${name}" in a HYPERBOLA, which this phase does not draw — ` +
            `use ${describeAuthorPlane({ axis: plane.axis, at: 0 })} for the axial triangle, or cut square to the axis for a circle`
        )
      }
      return { kind: 'polygon', points: coneTriangle(plane, spec.radius, y) }
    }
    default:
      throw new Error(`"${name}" cannot be cut`)
  }
}

function centreOnPlane(plane: SectionPlane): Vec3 {
  return {
    x: plane.axis === 'x' ? plane.at : 0,
    y: plane.axis === 'y' ? plane.at : 0,
    z: plane.axis === 'z' ? plane.at : 0,
  }
}

// The rectangle a plane parallel to a y-axis cylinder cuts: `half` either side
// across the plane's own first coordinate direction, `y` above and below.
function rectangleInPlane(plane: SectionPlane, half: number, y: number): Vec3[] {
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
function coneTriangle(plane: SectionPlane, radius: number, y: number): Vec3[] {
  const across = plane.axis === 'x' ? 'z' : 'x'
  const base = (side: number): Vec3 => ({
    x: plane.axis === 'x' ? 0 : across === 'x' ? side * radius : 0,
    y: -y,
    z: plane.axis === 'z' ? 0 : across === 'z' ? side * radius : 0,
  })
  return [base(-1), base(1), { x: 0, y, z: 0 }]
}

// ---------------------------------------------------------------------------
// The lifted true shape
// ---------------------------------------------------------------------------

// The section as ordinary 2D geometry, at true size, in its own plane's frame.
// This is what goes back to the figure renderer (H5).
export function trueShape(section: Section, plane: SectionPlane): TrueShape {
  if (section.kind === 'circle') return { kind: 'circle', center: inPlane(plane, section.center), radius: section.radius }
  return { kind: 'polygon', vertices: section.points.map((p) => inPlane(plane, p)) }
}

// Where a lifted section sits: **beside the solid, never on top of it**.
//
// A section lifted out in place would overlap the drawing it came from, and
// the two are different pictures of different things. The convention, stated
// so it stays deterministic: the section's bounding box is placed with its
// left edge one quarter of the solid's own width clear of the solid's right
// edge, and its vertical centre level with the solid's.
export const SECTION_GAP_FRACTION = 0.25

export function liftOffset(solid: { minX: number; minY: number; maxX: number; maxY: number }, shape: { minX: number; minY: number; maxX: number; maxY: number }): Vec2 {
  const gap = (solid.maxX - solid.minX) * SECTION_GAP_FRACTION
  return {
    x: solid.maxX + gap - shape.minX,
    y: (solid.minY + solid.maxY) / 2 - (shape.minY + shape.maxY) / 2,
  }
}
