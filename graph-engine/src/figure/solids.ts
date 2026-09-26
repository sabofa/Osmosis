import { DEFAULT_CAMERA, projectSolid, rectangularPrism, type Camera, type ProjectedEdge, type Solid3D, type Vec3 } from './project3d'
import { rectanglePyramidSolid, regularSolid, type RegularShape } from './regular'
import {
  coneOutline,
  cylinderOutline,
  frustumOutline,
  IDENTITY_PLACEMENT,
  isIdentityPlacement,
  localCamera,
  placementAlong,
  rotateToWorld,
  sphereOutline,
  toWorld,
  type Placement,
} from './silhouette'

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
// **Vertex lettering (V3, phase 6b) is textbook order**, and like the rest of
// placement it is fixed against the default camera, never the active view. A
// prism's ABCD run counter-clockwise seen from above, A the front-left bottom
// corner, so the front face is ABFE and D is the hidden corner; E-H sit above
// A-D, E over A. A square pyramid's base is lettered the same way, apex E. A
// tetrahedron's A is its first base vertex, B and C follow counter-clockwise
// seen from above, and D is the apex. Lettering lives in `labelOrder`.
//
// Rule 1 is `rectangularPrism`'s existing convention, extended rather than
// replaced: a prism built here is bit-for-bit the prism phase 2 built.
//
// **Phase 7.** A cube is the box. A frustum follows (1)-(3), base rim at
// -h/2. The regular prisms, pyramids and frusta, the rectangle pyramid and
// the octahedron follow (1)-(3), and (4) becomes P5 (regular.ts): the base's
// rotation is the integer degree keeping every face farthest from edge-on
// under the default camera, and the letters start at the left end of the
// front-most base edge — the box's textbook lettering, generalised. A solid
// ON NAMED POINTS is placed by them, not by this convention (spec, "Placement
// by points"): a polyhedron is the hull of its points, and a round solid
// carries a placement (P1, silhouette.ts) taking H1's frame to where its
// points put it.

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
  // A conical frustum (P2): base radius, top radius, height. `top` may be
  // larger than `radius` — the frustum wider at the top — and is then built
  // as the same solid with its axis reversed (see frustumRadii).
  | { kind: 'frustum'; radius: number; top: number; height: number }
  // A polyhedron built from named points by the one hull builder (P3,
  // hull.ts). `shape` is what the author called it — a hull, or a
  // tetrahedron, pyramid or prism on points — for messages; the polyhedron
  // is the whole of its geometry, already in world coordinates.
  | { kind: 'hull'; shape: PointSolidShape; polyhedron: Solid3D }
  // Phase 7 by dimensions. A cube is the box with three equal sides, drawn
  // by the box's own builder so its bytes are the box's. The rest are placed
  // and lettered by P5 (regular.ts), their faces written in closed form.
  | { kind: 'cube'; edge: number }
  | { kind: 'regularPrism'; sides: number; side: number; height: number }
  | { kind: 'regularPyramid'; sides: number; side: number; height: number }
  | { kind: 'rectanglePyramid'; width: number; depth: number; height: number }
  | { kind: 'octahedron'; edge: number }
  | { kind: 'regularFrustum'; sides: number; side: number; top: number; height: number }

export type PointSolidShape = 'hull' | 'tetrahedron' | 'pyramid' | 'prism'

// The primitive names an author can write, in the order an error message
// should list them.
export const SOLID_PRIMITIVES = ['prism', 'pyramid', 'tetrahedron', 'cylinder', 'cone', 'sphere', 'frustum', 'hull', 'cube', 'octahedron'] as const

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
  // order a *problem* names a prism's vertices in is textbook order (V3).
  // Empty for a solid with no vertices to name.
  labelOrder: number[]
  // P1 — where a round solid sits and which way its axis points: local
  // coordinates (H1's placement, axis +y) map to world through it. The
  // identity for every polyhedron, whose vertices are already world points,
  // and for every round solid placed by H1's convention.
  placement: Placement
  // Built on named points rather than by dimensions (P6). Such a solid has
  // no named dimensions: its points already name everything measurable.
  byPoints?: boolean
}

// `placement` places a ROUND solid; a polyhedron ignores it. A frustum wider
// at the top reverses it (P2).
export function buildSolid(spec: SolidSpec, placement: Placement = IDENTITY_PLACEMENT): SolidBody {
  const body = buildShape(spec)
  if (body.polyhedron) return body
  if (spec.kind === 'frustum' && frustumRadii(spec).reversed) {
    return { ...body, placement: placementAlong(placement.origin, rotateToWorld(placement, { x: 0, y: -1, z: 0 })) }
  }
  return { ...body, placement }
}

function buildShape(spec: SolidSpec): SolidBody {
  const placement = IDENTITY_PLACEMENT
  switch (spec.kind) {
    case 'prism':
      return {
        spec,
        polyhedron: rectangularPrism(spec.width, spec.height, spec.depth),
        // rectangularPrism's vertices are internal (-x,-y,-z), (x,-y,-z),
        // (x,y,-z), (-x,y,-z) then the same four at +z. In the author frame
        // (X, Y, Z) = (z, x, y) the bottom corners are 4 (+X,-Y), 5 (+X,+Y),
        // 1 (-X,+Y), 0 (-X,-Y) — counter-clockwise from the front-left one —
        // and the top corners above them are 7, 6, 2, 3, matched position
        // for position so A is under E.
        labelOrder: [4, 5, 1, 0, 7, 6, 2, 3],
        placement,
      }
    case 'pyramid':
      // squarePyramid's base runs 0 (+X,+Y), 1 (+X,-Y), 2 (-X,-Y), 3 (-X,+Y)
      // in the author frame, which is clockwise from above; textbook order
      // starts at the front-left corner, 1, and runs the other way.
      return { spec, polyhedron: squarePyramid(spec.base, spec.height), labelOrder: [1, 0, 3, 2, 4], placement }
    case 'tetrahedron':
      // The base is built at increasing INTERNAL angle, which is decreasing
      // author azimuth — clockwise from above. A stays the first vertex; B
      // and C swap so the base reads counter-clockwise, and D is the apex.
      return { spec, polyhedron: regularTetrahedron(spec.edge), labelOrder: [0, 2, 1, 3], placement }
    // The box's builder and the box's lettering: a cube IS a box (P6).
    case 'cube':
      return { spec, polyhedron: rectangularPrism(spec.edge, spec.edge, spec.edge), labelOrder: [4, 5, 1, 0, 7, 6, 2, 3], placement }
    // Vertex order is the input order (P3), so the letters are the identity.
    case 'hull':
      return { spec, polyhedron: spec.polyhedron, labelOrder: identityOrder(spec.polyhedron), placement, byPoints: true }
    // P5: built with their vertices already in lettering order.
    case 'regularPrism':
    case 'regularPyramid':
    case 'regularFrustum':
    case 'octahedron':
    case 'rectanglePyramid': {
      const polyhedron = dimensionPolyhedron(spec)
      return { spec, polyhedron, labelOrder: identityOrder(polyhedron), placement }
    }
    // H2's second representation: a curved primitive carries its parameters
    // and emits an analytic silhouette. It has no vertices, so there is
    // nothing to letter and nothing for the convex face rule to classify.
    case 'cylinder':
    case 'cone':
    case 'sphere':
    case 'frustum':
      return { spec, polyhedron: null, labelOrder: [], placement }
  }
}

function identityOrder(solid: Solid3D): number[] {
  return solid.vertices.map((_, i) => i)
}

function isPhase7Polyhedron(spec: SolidSpec): spec is Extract<SolidSpec, { kind: RegularShape['kind'] | 'rectanglePyramid' }> {
  return (
    spec.kind === 'regularPrism' ||
    spec.kind === 'regularPyramid' ||
    spec.kind === 'regularFrustum' ||
    spec.kind === 'octahedron' ||
    spec.kind === 'rectanglePyramid'
  )
}

// The polyhedron of a phase 7 dimension primitive, vertices in lettering
// order (P5).
function dimensionPolyhedron(spec: Extract<SolidSpec, { kind: RegularShape['kind'] | 'rectanglePyramid' }>): Solid3D {
  return spec.kind === 'rectanglePyramid' ? rectanglePyramidSolid(spec.width, spec.depth, spec.height) : regularSolid(spec)
}

// P2 — a frustum's two radii as its geometry uses them: the wider rim is
// always the local BASE (y = -h/2), so the silhouette and occlusion maths
// only ever see R > r. A frustum written wider at the top is `reversed`: the
// same solid, its placement's axis turned over (buildSolid), which puts the
// wide rim back on top in the world. One code path, not two.
export function frustumRadii(spec: { radius: number; top: number }): { bottom: number; top: number; reversed: boolean } {
  return spec.top > spec.radius
    ? { bottom: spec.top, top: spec.radius, reversed: true }
    : { bottom: spec.radius, top: spec.top, reversed: false }
}

// **The one outline contract (H2).** A polyhedron is classified by the convex
// face rule; a curved primitive computes its silhouette in closed form. Both
// hand back the same drawn-edge union, and no caller above this line knows
// which it got.
//
// A round solid is drawn in its own frame, through the world camera
// re-expressed there (P1) — which for an identity placement is the world
// camera itself.
export function solidOutline(body: SolidBody, camera: Camera): ProjectedEdge[] {
  if (body.polyhedron) return projectSolid(body.polyhedron, camera)
  const local = localCamera(camera, body.placement)
  switch (body.spec.kind) {
    case 'cylinder':
      return cylinderOutline(body.spec.radius, body.spec.height, local)
    case 'cone':
      return coneOutline(body.spec.radius, body.spec.height, local)
    case 'sphere':
      return sphereOutline(body.spec.radius, local)
    case 'frustum': {
      const radii = frustumRadii(body.spec)
      return frustumOutline(radii.bottom, radii.top, body.spec.height, local)
    }
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
    case 'frustum':
      return { radius: spec.radius, top: spec.top, height: spec.height }
    case 'hull':
      return {}
    case 'cube':
      return { edge: spec.edge }
    case 'regularPrism':
    case 'regularPyramid':
      return { side: spec.side, height: spec.height }
    case 'rectanglePyramid':
      return { width: spec.width, depth: spec.depth, height: spec.height }
    case 'octahedron':
      return { edge: spec.edge }
    case 'regularFrustum':
      return { side: spec.side, top: spec.top, height: spec.height }
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
    case 'frustum': {
      // In the frustum's LOCAL frame (P2): the author's base rim is the
      // local bottom unless the frustum is reversed, when it is the local
      // top. Each radius runs out along +x from its rim's centre, as a
      // cone's does; the height is the axis.
      const y = spec.height / 2
      const baseY = frustumRadii(spec).reversed ? y : -y
      if (dimension === 'radius') {
        return [
          { x: 0, y: baseY, z: 0 },
          { x: spec.radius, y: baseY, z: 0 },
        ]
      }
      if (dimension === 'top') {
        return [
          { x: 0, y: -baseY, z: 0 },
          { x: spec.top, y: -baseY, z: 0 },
        ]
      }
      if (dimension === 'height') {
        return [
          { x: 0, y: -y, z: 0 },
          { x: 0, y, z: 0 },
        ]
      }
      return null
    }
    case 'hull':
      return null
    // The box's width edge, AB: the front-bottom edge nearest the viewer.
    case 'cube':
      return dimension === 'edge' ? solidDimensionSegment({ kind: 'prism', width: spec.edge, height: spec.edge, depth: spec.edge }, 'width') : null
    // P5's lettering makes AB the front-most base edge, so every side, edge
    // and width hangs there; a prism's height hangs off B's vertical edge
    // (the box's BF), a rectangle pyramid's depth off BC (the box's BC),
    // and a frustum's top off the top edge over AB. A height with no edge of
    // its own hangs off the axis, as a square pyramid's does.
    case 'regularPrism':
    case 'regularPyramid':
    case 'regularFrustum':
    case 'octahedron':
    case 'rectanglePyramid': {
      return polyhedronDimensionSegment(spec, dimensionPolyhedron(spec).vertices, dimension)
    }
  }
}

// A phase 7 polyhedron's dimension segment, read off its vertices in
// lettering order. Separate so a BUILT solid's own vertices serve it
// (bodyDimensionSegment) rather than every label building the solid again.
function polyhedronDimensionSegment(
  spec: Extract<SolidSpec, { kind: RegularShape['kind'] | 'rectanglePyramid' }>,
  v: Vec3[],
  dimension: string
): [Vec3, Vec3] | null {
  if (spec.kind === 'octahedron') return dimension === 'edge' ? [v[0], v[1]] : null
  const half = spec.height / 2
  const axis = (): [Vec3, Vec3] => [
    { x: 0, y: -half, z: 0 },
    { x: 0, y: half, z: 0 },
  ]
  if (spec.kind === 'rectanglePyramid') {
    if (dimension === 'width') return [v[0], v[1]]
    if (dimension === 'depth') return [v[1], v[2]]
    return dimension === 'height' ? axis() : null
  }
  if (dimension === 'side') return [v[0], v[1]]
  if (spec.kind === 'regularPrism') return dimension === 'height' ? [v[1], v[spec.sides + 1]] : null
  if (spec.kind === 'regularFrustum' && dimension === 'top') return [v[spec.sides], v[spec.sides + 1]]
  return dimension === 'height' ? axis() : null
}

// The dimension segment of a BUILT solid, in world coordinates: a round
// solid's comes out of `solidDimensionSegment` in its local frame and is
// carried through its placement (P1). Untouched for an identity placement,
// so every pre-phase-7 label sits on exactly the bytes it did.
export function bodyDimensionSegment(body: SolidBody, dimension: string): [Vec3, Vec3] | null {
  const spec = body.spec
  if (body.polyhedron && isPhase7Polyhedron(spec)) return polyhedronDimensionSegment(spec, body.polyhedron.vertices, dimension)
  const segment = solidDimensionSegment(spec, dimension)
  if (!segment || body.polyhedron || isIdentityPlacement(body.placement)) return segment
  return [toWorld(body.placement, segment[0]), toWorld(body.placement, segment[1])]
}
