import { DEFAULT_CAMERA, projectSolid, rectangularPrism, type Camera, type ProjectedEdge, type Solid3D, type Vec3 } from './project3d'
import { coneOutline, cylinderOutline, sphereOutline } from './silhouette'

// The solid vocabulary: what an author can ask for, where it sits, and what
// its dimensions are called.
//
// ---------------------------------------------------------------------------
// H1 — every primitive states its placement
// ---------------------------------------------------------------------------
//
// Constraints fix a solid's **shape**, not where it sits. A solved triangle
// needed a placement convention for exactly this reason (first vertex at the
// origin, second on +x, third above), and without one for solids
// "deterministic" quietly stops being true.
//
// **The convention, for every primitive in this module:**
//
//  1. The solid is centred on the origin.
//  2. Its axis of symmetry is the **y-axis**, so the solid spans
//     `-h/2 <= y <= h/2` and the drawing's vertical direction is the solid's
//     own height — which is what makes a height dimension readable off the
//     page under every camera that draws author Z page-up.
//  3. Every cross-section perpendicular to that axis is centred on the axis,
//     so a base, a mid-section and a top all share a centre.
//  4. Rotation about the axis is pinned too, **against the default camera
//     and never the active view** (V2, phase 6b): switching `@view:` must not
//     re-orient, re-letter or re-choose the dimension edge of any solid, or
//     it would be a different figure. A regular polygonal base puts its first
//     vertex **15 degrees round from the default camera's azimuth** (toward
//     author +Y) — `BASE_START_ANGLE`. A rectangular base stays
//     **axis-aligned** (width along x, depth along z).
//
//     The offset is not decoration, and it replaces phase 5's "first vertex
//     exactly facing the viewer". Facing the viewer exactly puts the apex,
//     the front vertex and the base centroid in ONE vertical plane with the
//     view, so the altitude projects straight onto the front apex edge and
//     vanishes under it — which is what exact isometric did to a regular
//     tetrahedron. Fifteen degrees round keeps the altitude at least 8.7
//     degrees off every apex edge under the standard camera, and every face
//     at least 21 degrees from edge-on, so no rounding error can flip a
//     dashed edge. (It happens to be the 45 degrees phase 5 used: the
//     standard camera sits 15 degrees round from isometric.)
//
// A sphere has no axis, so only (1) applies to it: it is centred on the
// origin. A cylinder and a cone follow (1)-(3) — a cylinder's two rims at
// -h/2 and +h/2, a cone's base at -h/2 and its apex at +h/2, all centred on
// the y-axis. (4) says nothing about them: a circle has no first vertex.
//
// Rule 1 is `rectangularPrism`'s existing convention, extended rather than
// replaced: a prism built here is bit-for-bit the prism phase 2 built.

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

export type SolidSpec =
  | { kind: 'prism'; width: number; height: number; depth: number }
  | { kind: 'pyramid'; base: number; height: number }
  | { kind: 'tetrahedron'; edge: number }
  | { kind: 'cylinder'; radius: number; height: number }
  | { kind: 'cone'; radius: number; height: number }
  | { kind: 'sphere'; radius: number }

// The primitive names an author can write, in the order an error message
// should list them.
export const SOLID_PRIMITIVES = ['prism', 'pyramid', 'tetrahedron', 'cylinder', 'cone', 'sphere'] as const

export type SolidPrimitiveName = (typeof SOLID_PRIMITIVES)[number]

// A built solid.
//
// **H2 — two representations behind one interface.** Polyhedra carry
// vertices-and-faces and are drawn by the convex hidden-edge rule; curved
// primitives (task 4) carry their parameters and emit an analytic silhouette
// instead. `polyhedron` is null for the second kind, and no caller may assume
// a solid has vertices.
export interface SolidBody {
  spec: SolidSpec
  polyhedron: Solid3D | null
  // The vertex indices in the order an author's `vertices ABCD` names apply.
  // Separate from the solid's own vertex order because `rectangularPrism`'s
  // is a binary count over (x, y, z) — the order its faces were written
  // against, and the order the byte-identical requirement pins — while the
  // order a *problem* names a prism's vertices in is "base, then top, so A
  // sits under E". Empty for a solid with no vertices to name.
  labelOrder: number[]
}

export function buildSolid(spec: SolidSpec): SolidBody {
  switch (spec.kind) {
    case 'prism':
      return {
        spec,
        polyhedron: rectangularPrism(spec.width, spec.height, spec.depth),
        // rectangularPrism's vertices are (-x,-y,-z), (x,-y,-z), (x,y,-z),
        // (-x,y,-z) then the same four at +z. The base (y = -h/2) is
        // therefore 0, 1, 5, 4 and the top 3, 2, 6, 7 — matched position for
        // position, so A is under E.
        labelOrder: [0, 1, 5, 4, 3, 2, 6, 7],
      }
    case 'pyramid':
      return { spec, polyhedron: squarePyramid(spec.base, spec.height), labelOrder: [0, 1, 2, 3, 4] }
    case 'tetrahedron':
      return { spec, polyhedron: regularTetrahedron(spec.edge), labelOrder: [0, 1, 2, 3] }
    // H2's second representation: a curved primitive carries its parameters
    // and emits an analytic silhouette. It has no vertices, so there is
    // nothing to letter and nothing for the convex face rule to classify.
    case 'cylinder':
    case 'cone':
    case 'sphere':
      return { spec, polyhedron: null, labelOrder: [] }
  }
}

// **The one outline contract (H2).** A polyhedron is classified by the convex
// face rule; a curved primitive computes its silhouette in closed form. Both
// hand back the same drawn-edge union, and no caller above this line knows
// which it got.
export function solidOutline(body: SolidBody, camera: Camera): ProjectedEdge[] {
  if (body.polyhedron) return projectSolid(body.polyhedron, camera)
  switch (body.spec.kind) {
    case 'cylinder':
      return cylinderOutline(body.spec.radius, body.spec.height, camera)
    case 'cone':
      return coneOutline(body.spec.radius, body.spec.height, camera)
    case 'sphere':
      return sphereOutline(body.spec.radius, camera)
    default:
      // Unreachable: every polyhedral primitive builds a polyhedron above.
      return []
  }
}

// ---------------------------------------------------------------------------
// Polyhedra
// ---------------------------------------------------------------------------

// Rule 4's turn: how far round from the default camera's azimuth a regular
// base's first vertex sits, toward author +Y. In the internal xz-plane, angles
// run from +x (author Y) toward +z (author X), which is author azimuth run
// BACKWARDS — so the turn is subtracted.
export const BASE_TURN = Math.PI / 12

// Rule 4's angle for a camera: its view direction projected onto a base plane
// (internal xz), turned by BASE_TURN.
export function baseStartAngle(camera: Camera): number {
  return Math.atan2(camera.direction.z, camera.direction.x) - BASE_TURN
}

// V2 — fixed against the DEFAULT camera, whatever view is active. Under the
// standard camera (azimuth 30 degrees) this is 45 degrees round from +x.
export const BASE_START_ANGLE = baseStartAngle(DEFAULT_CAMERA)

// A pyramid on a square base, base at y = -h/2 and apex at (0, h/2, 0).
//
// The base is wound so its outward normal is -y (it is the bottom face), and
// each lateral face is the base edge **reversed** plus the apex, which is what
// winds it counter-clockwise seen from outside.
export function squarePyramid(base: number, height: number): Solid3D {
  const b = base / 2
  const y = height / 2
  const vertices: Vec3[] = [
    { x: b, y: -y, z: b },
    { x: -b, y: -y, z: b },
    { x: -b, y: -y, z: -b },
    { x: b, y: -y, z: -b },
    { x: 0, y: y, z: 0 },
  ]
  const faces = [[0, 1, 2, 3], ...lateralFaces(4, 4)]
  return { vertices, faces }
}

// The regular tetrahedron of the given edge length: an equilateral base with
// its circumradius e/sqrt(3), the apex e*sqrt(2/3) above it, and the whole
// thing dropped so the base sits at -h/2.
export function regularTetrahedron(edge: number): Solid3D {
  const radius = edge / Math.sqrt(3)
  const height = edge * Math.sqrt(2 / 3)
  const y = height / 2
  const vertices: Vec3[] = []
  for (let i = 0; i < 3; i++) {
    // First vertex 15 degrees round from the default camera (rule 4), then
    // round the base.
    const angle = BASE_START_ANGLE + (2 * Math.PI * i) / 3
    vertices.push({ x: radius * Math.cos(angle), y: -y, z: radius * Math.sin(angle) })
  }
  vertices.push({ x: 0, y, z: 0 })
  const faces = [[0, 1, 2], ...lateralFaces(3, 3)]
  return { vertices, faces }
}

// The faces joining an n-gon base (vertices 0..n-1, wound so its normal is
// -y) to an apex. Each is `[j, i, apex]` for base edge i -> j: the base edge
// reversed, which flips the winding from "seen from below" to "seen from
// outside the side of the solid".
function lateralFaces(n: number, apex: number): number[][] {
  const faces: number[][] = []
  for (let i = 0; i < n; i++) faces.push([(i + 1) % n, i, apex])
  return faces
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

// What `label: S height` can name, and what it measures to.
//
// Read off the SPEC, never off the drawing: a projected edge's length is a
// fact about the camera, and printing it would put a number on the figure
// that contradicts the solid the author asked for. This is the same
// commitment "label: AB" makes in 2D, where the drawing IS the geometry;
// here the two differ and the geometry wins.
export function solidDimensions(spec: SolidSpec): Record<string, number> {
  switch (spec.kind) {
    case 'prism':
      return { width: spec.width, height: spec.height, depth: spec.depth }
    case 'pyramid':
      return { base: spec.base, height: spec.height }
    case 'tetrahedron':
      return { edge: spec.edge }
    case 'cylinder':
    case 'cone':
      return { radius: spec.radius, height: spec.height }
    case 'sphere':
      return { radius: spec.radius }
  }
}

// The pair of points a dimension label hangs off, in world space.
//
// A dimension is usually realised by several parallel edges — a prism's width
// by four of them — so one is CHOSEN, and the choice is the front of the
// drawing under the DEFAULT camera: the edge a reader would put a ruler
// against. Fixed rather than picked per view (V2), because a label that moved
// to a different edge when the viewpoint changed would be a different figure.
//
// Re-chosen for the standard camera in phase 6b, and it chooses the same
// edges isometric did: the standard camera also looks from the author's
// (+X, +Y) side and from above, so a prism's nearest bottom corner is still
// internal (+x, -y, +z) and its three dimension edges still meet there, all
// visible. A tetrahedron's edge is its first two base vertices, which under
// the standard camera is the front-most of the three base edges (under
// isometric it tied with another).
//
// A dimension with no edge of its own — a pyramid's height — hangs off the
// axis instead, which is exactly what a dimension line does on paper.
//
// Null when the primitive has no such dimension.
export function solidDimensionSegment(spec: SolidSpec, dimension: string): [Vec3, Vec3] | null {
  switch (spec.kind) {
    case 'prism': {
      const x = spec.width / 2
      const y = spec.height / 2
      const z = spec.depth / 2
      if (dimension === 'width') {
        return [
          { x: -x, y: -y, z },
          { x, y: -y, z },
        ]
      }
      if (dimension === 'height') {
        return [
          { x, y: -y, z },
          { x, y, z },
        ]
      }
      if (dimension === 'depth') {
        return [
          { x, y: -y, z: -z },
          { x, y: -y, z },
        ]
      }
      return null
    }
    case 'pyramid': {
      const y = spec.height / 2
      if (dimension === 'height') {
        return [
          { x: 0, y: -y, z: 0 },
          { x: 0, y, z: 0 },
        ]
      }
      if (dimension === 'base') {
        const v = squarePyramid(spec.base, spec.height).vertices
        return [v[0], v[1]]
      }
      return null
    }
    case 'tetrahedron': {
      if (dimension !== 'edge') return null
      const v = regularTetrahedron(spec.edge).vertices
      return [v[0], v[1]]
    }
    case 'cylinder': {
      const y = spec.height / 2
      // The radius runs out along +x from the centre of the near rim; the
      // height runs down the surface at +x, which is a silhouette line for
      // no camera and therefore never lands on top of one.
      if (dimension === 'radius') {
        return [
          { x: 0, y, z: 0 },
          { x: spec.radius, y, z: 0 },
        ]
      }
      if (dimension === 'height') {
        return [
          { x: spec.radius, y: -y, z: 0 },
          { x: spec.radius, y, z: 0 },
        ]
      }
      return null
    }
    case 'cone': {
      const y = spec.height / 2
      if (dimension === 'radius') {
        return [
          { x: 0, y: -y, z: 0 },
          { x: spec.radius, y: -y, z: 0 },
        ]
      }
      // A cone's height is its axis, exactly as a pyramid's is.
      if (dimension === 'height') {
        return [
          { x: 0, y: -y, z: 0 },
          { x: 0, y, z: 0 },
        ]
      }
      return null
    }
    case 'sphere':
      if (dimension !== 'radius') return null
      return [
        { x: 0, y: 0, z: 0 },
        { x: spec.radius, y: 0, z: 0 },
      ]
  }
}
