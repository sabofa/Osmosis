import { authorToWorld, worldToAuthor } from './authorFrame'
import { dot3, length3 } from './construct3d'
import { DEFAULT_CAMERA, faceNormal, type Solid3D, type Vec3 } from './project3d'

// P5 — solids on a regular n-gon base, and the octahedron: ONE placement
// rule and ONE lettering rule.
//
// The box, the square pyramid and the regular tetrahedron keep the
// placements phases 5-6b pinned (solids.ts). Everything here is new in
// phase 7. Each solid is built in CLOSED FORM — its vertices listed in
// LETTERING order (so `labelOrder` is the identity) and its faces written
// down, not searched for: caps, then lateral quads or triangles, each wound
// counter-clockwise seen from outside. The hull builder (P3) is O(n^4) and
// serves solids on named points only; a regular base's faces are known, and
// building them directly keeps a 24-gon as cheap as a triangle. The
// convexity invariant (solids.test.ts) covers every one of them.
//
// A regular base has 3 to 24 sides (solidScope.ts refuses the rest): more is
// a cylinder drawn badly, and a figure cannot letter it.
//
// ---------------------------------------------------------------------------
// The placement rule
// ---------------------------------------------------------------------------
//
// A regular base's rotation about the vertical axis is chosen, among integer
// degrees in one symmetry period [0, 360/n), to MAXIMISE THE MINIMUM of:
//
//  - every face's angular margin from edge-on under DEFAULT_CAMERA — the
//    angle between the face's plane and the view direction, asin|n . d| —
//    because a face near edge-on is one rounding error from flipping which
//    edges are dashed;
//  - every base vertex's angular distance (in azimuth) from the camera's
//    vertical plane through the axis — because a vertex in that plane puts
//    the apex, the vertex and the base centre in one plane with the view,
//    and the apex-to-centre segment then projects onto a lateral edge (the
//    overlap phase 6b found in exact isometric).
//
// Ties (within 1e-9 degrees) go to the smallest rotation. The search is
// finite and over integer degrees; it fixes a CONVENTION, not a geometric
// answer, which is the one finite search the plan allows. It is fixed
// against the DEFAULT camera, never the active view (V2), so `@view:` never
// re-orients a solid.
//
// **The rule is evaluated at a fixed REFERENCE proportion** (controller
// ruling, fix wave 1): height equal to the base side, so the rotation is a
// function of the kind and n alone. A prism's rule never saw proportions
// anyway (its lateral faces are vertical, its caps always 25 degrees from
// edge-on); a pyramid's faces lean with its slant, and evaluating each
// pyramid at its own slant turned two pyramids of one problem set to
// unrelated angles. A pyramidal frustum takes its pyramid's rotation, so a
// frustum and the pyramid it was cut from stand the same way.
//
// The rotation is the author azimuth of one base vertex (the others at
// +360k/n). Recorded values, under the standard camera (azimuth 30,
// elevation 25), with the least margin the reference solid achieves:
//
//   prism regular n (any proportions):
//     n = 3: 16 (14.0)    n = 4: 9 (21.0)     n = 5: 3 (8.15)
//     n = 6: 0 (25.0)     n = 7: 24 (6.0)     n = 8: 19 (10.41)
//     n = 10: 12 (16.26)  n = 12: 7 (7.0)     n = 24: 4 (3.17)
//   pyramid regular n and frustum regular n (reference: height = side):
//     n = 3: 12 (17.35)   n = 4: 16 (13.21)   n = 5: 8 (13.91)
//     n = 6: 20 (9.07)    n = 7: 10 (5.71)    n = 8: 7 (4.58)
//     n = 10: 12 (2.59)   n = 12: 2 (2.0)     n = 24: 7 (7.0)
//   octahedron: 75 (14.12)
// Many-sided pyramids cannot do well at any rotation: with that many
// lateral faces one is always nearly edge-on.
//
// For comparison only (nothing here re-places them): the rule would put a
// regular triangular pyramid at 12 (mod 120) and a square pyramid at 16
// (mod 90). The pinned regular tetrahedron and square pyramid have stayed at
// 45 absolute (camera azimuth + 15) since phase 6b; at the reference
// proportion 45 scores 15.0 against 17.35 for n = 3, and 12.49 against 13.21
// for n = 4.
//
// ---------------------------------------------------------------------------
// The lettering rule
// ---------------------------------------------------------------------------
//
// A is the LEFT end, seen from the viewer, of the FRONT-MOST base edge: the
// edge whose outward normal's azimuth is closest to the default camera's.
// The base runs counter-clockwise from above (which, along the front edge,
// runs left to right as the viewer sees it — so A is the edge's first
// vertex). A prism's or frustum's top follows in the same order, its first
// letter over A. A pyramid's apex comes last. The octahedron letters its
// equator by this rule, then the top apex, then the bottom apex. It is the
// box's textbook lettering (V3) — A front-left, the front face ABFE —
// generalised.

const DEG = Math.PI / 180

// The default camera's view direction in the author frame (S1: converted by
// authorFrame.ts, the one module that knows both frames), and its azimuth
// in degrees.
const CAMERA = worldToAuthor(DEFAULT_CAMERA.direction)
const CAMERA_AZIMUTH = (Math.atan2(CAMERA.y, CAMERA.x) * 180) / Math.PI

// A regular base: n corners at author azimuths rotation + 360 k / n, in
// counter-clockwise order.
function baseAzimuths(n: number, rotation: number): number[] {
  return Array.from({ length: n }, (_, k) => rotation + (360 * k) / n)
}

// The index of the base corner the letters start at (A): the first vertex of
// the edge whose outward normal points nearest the camera's azimuth.
function frontCorner(azimuths: number[]): number {
  const n = azimuths.length
  let best = 0
  let bestGap = Infinity
  for (let k = 0; k < n; k++) {
    const normal = azimuths[k] + 180 / n
    const gap = Math.abs(((((normal - CAMERA_AZIMUTH) % 360) + 540) % 360) - 180)
    if (gap < bestGap - 1e-9) {
      best = k
      bestGap = gap
    }
  }
  return best
}

// The base corners' azimuths starting at A.
function lettered(n: number, rotation: number): number[] {
  const azimuths = baseAzimuths(n, rotation)
  const start = frontCorner(azimuths)
  return [...azimuths.slice(start), ...azimuths.slice(0, start)]
}

function ring(azimuths: number[], radius: number, z: number): Vec3[] {
  return azimuths.map((a) => authorToWorld({ x: radius * Math.cos(a * DEG), y: radius * Math.sin(a * DEG), z }))
}

function circumradius(n: number, side: number): number {
  return side / (2 * Math.sin(Math.PI / n))
}

// The shapes the rule places.
export type RegularShape =
  | { kind: 'regularPrism'; sides: number; side: number; height: number }
  | { kind: 'regularPyramid'; sides: number; side: number; height: number }
  | { kind: 'regularFrustum'; sides: number; side: number; top: number; height: number }
  | { kind: 'octahedron'; edge: number }

function baseCount(shape: RegularShape): number {
  return shape.kind === 'octahedron' ? 4 : shape.sides
}

// ---------------------------------------------------------------------------
// The faces, in closed form
// ---------------------------------------------------------------------------
//
// The vertex layouts are: a base ring 0..n-1 counter-clockwise from above,
// then either a top ring n..2n-1 over it (prism, frustum) or an apex n
// (pyramid), or — the octahedron — an equator 0..3, the top apex 4 and the
// bottom apex 5. Winding, seen from OUTSIDE:
//  - the bottom cap is the base ring reversed (seen from below, the ring
//    runs clockwise);
//  - the top cap is the top ring as it is;
//  - a lateral quad over base edge i -> i+1 is [i, i+1, top i+1, top i]:
//    along the bottom left to right, up, back along the top;
//  - a lateral triangle up to an apex is [i, i+1, apex]; down to a bottom
//    apex it is [i+1, i, apex].

function ringFaces(n: number): number[][] {
  const bottom = Array.from({ length: n }, (_, k) => n - 1 - k)
  const top = Array.from({ length: n }, (_, k) => n + k)
  const sides = Array.from({ length: n }, (_, i) => [i, (i + 1) % n, n + ((i + 1) % n), n + i])
  return [bottom, top, ...sides]
}

function apexFaces(n: number): number[][] {
  const bottom = Array.from({ length: n }, (_, k) => n - 1 - k)
  const sides = Array.from({ length: n }, (_, i) => [i, (i + 1) % n, n])
  return [bottom, ...sides]
}

function build(shape: RegularShape, rotation: number): Solid3D {
  switch (shape.kind) {
    case 'regularPrism': {
      const around = lettered(shape.sides, rotation)
      const r = circumradius(shape.sides, shape.side)
      return { vertices: [...ring(around, r, -shape.height / 2), ...ring(around, r, shape.height / 2)], faces: ringFaces(shape.sides) }
    }
    case 'regularPyramid': {
      const around = lettered(shape.sides, rotation)
      const base = ring(around, circumradius(shape.sides, shape.side), -shape.height / 2)
      return { vertices: [...base, authorToWorld({ x: 0, y: 0, z: shape.height / 2 })], faces: apexFaces(shape.sides) }
    }
    case 'regularFrustum': {
      const around = lettered(shape.sides, rotation)
      return {
        vertices: [
          ...ring(around, circumradius(shape.sides, shape.side), -shape.height / 2),
          ...ring(around, circumradius(shape.sides, shape.top), shape.height / 2),
        ],
        faces: ringFaces(shape.sides),
      }
    }
    case 'octahedron': {
      const r = shape.edge / Math.SQRT2
      const vertices = [...ring(lettered(4, rotation), r, 0), authorToWorld({ x: 0, y: 0, z: r }), authorToWorld({ x: 0, y: 0, z: -r })]
      const upper = [0, 1, 2, 3].map((i) => [i, (i + 1) % 4, 4])
      const lower = [0, 1, 2, 3].map((i) => [(i + 1) % 4, i, 5])
      return { vertices, faces: [...upper, ...lower] }
    }
  }
}

// ---------------------------------------------------------------------------
// The placement rule
// ---------------------------------------------------------------------------

// The rule's objective for one rotation of THIS shape: the least of every
// face's margin from edge-on and every base corner's azimuthal distance
// from the camera's vertical plane, in degrees.
//
// Turning the solid about the vertical turns its face normals with it and
// changes nothing else, so the faces are found once (at rotation 0) and
// their unit normals, in the author frame, are turned for each candidate.
export function placementMargin(shape: RegularShape, rotation: number): number {
  return marginAt(unitNormals(shape), baseCount(shape), rotation)
}

function unitNormals(shape: RegularShape): Vec3[] {
  const solid = build(shape, 0)
  return solid.faces.map((_, f) => {
    const n = worldToAuthor(faceNormal(solid, f))
    const size = length3(n)
    return { x: n.x / size, y: n.y / size, z: n.z / size }
  })
}

function marginAt(normals: Vec3[], corners: number, rotation: number): number {
  const cos = Math.cos(rotation * DEG)
  const sin = Math.sin(rotation * DEG)
  let least = Infinity
  for (const n of normals) {
    const turned = { x: n.x * cos - n.y * sin, y: n.x * sin + n.y * cos, z: n.z }
    least = Math.min(least, Math.asin(Math.min(1, Math.abs(dot3(turned, CAMERA)))) / DEG)
  }
  for (const azimuth of baseAzimuths(corners, rotation)) {
    const m = (((azimuth - CAMERA_AZIMUTH) % 180) + 180) % 180
    least = Math.min(least, Math.min(m, 180 - m))
  }
  return least
}

// The solid the rule is evaluated on: the same kind and n at the reference
// proportion, height = side (a frustum by its pyramid).
export function referenceShape(shape: RegularShape): RegularShape {
  switch (shape.kind) {
    case 'regularPrism':
      return { kind: 'regularPrism', sides: shape.sides, side: 1, height: 1 }
    case 'regularPyramid':
    case 'regularFrustum':
      return { kind: 'regularPyramid', sides: shape.sides, side: 1, height: 1 }
    case 'octahedron':
      return { kind: 'octahedron', edge: 1 }
  }
}

// P5's rotation: integer degrees in [0, 360/n), the best margin of the
// reference shape, ties to the smallest.
export function regularRotation(shape: RegularShape): number {
  const reference = referenceShape(shape)
  const corners = baseCount(reference)
  const normals = unitNormals(reference)
  const period = 360 / corners
  let best = 0
  let bestMargin = -Infinity
  for (let rotation = 0; rotation < period; rotation++) {
    const margin = marginAt(normals, corners, rotation)
    if (margin > bestMargin + 1e-9) {
      best = rotation
      bestMargin = margin
    }
  }
  return best
}

// The solid, placed and lettered: vertices in lettering order.
export function regularSolid(shape: RegularShape): Solid3D {
  return build(shape, regularRotation(shape))
}

// A pyramid on a rectangle, width along author Y and depth along author X
// (like the box), axis-aligned — a rectangle's placement is its sides, not
// a searched rotation — and lettered by the same rule: A the left end of the
// front-most base edge, counter-clockwise, apex E. Faces in closed form, as
// a regular pyramid's.
export function rectanglePyramidSolid(width: number, depth: number, height: number): Solid3D {
  const x = depth / 2
  const y = width / 2
  const z = -height / 2
  // Corners counter-clockwise from above, from (+X, -Y); the front-most edge
  // is the +X one (normal azimuth 0, nearest the camera's 30), whose left
  // end from the viewer is (+X, -Y).
  const corners: Vec3[] = [
    { x, y: -y, z },
    { x, y, z },
    { x: -x, y, z },
    { x: -x, y: -y, z },
  ]
  return { vertices: [...corners.map(authorToWorld), authorToWorld({ x: 0, y: 0, z: height / 2 })], faces: apexFaces(4) }
}
