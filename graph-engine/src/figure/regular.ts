import { authorToWorld } from './authorFrame'
import { dot3, length3 } from './construct3d'
import { hullOf } from './hull'
import { DEFAULT_CAMERA, faceNormal, type Solid3D, type Vec3 } from './project3d'

// P5 — solids on a regular n-gon base, and the octahedron: ONE placement
// rule and ONE lettering rule.
//
// The box, the square pyramid and the regular tetrahedron keep the
// placements phases 5-6b pinned (solids.ts). Everything here is new in
// phase 7, and every solid here is built by the one hull builder (P3), from
// its vertices listed in LETTERING order — so the hull's vertex order is the
// letters and `labelOrder` is the identity.
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
// Ties (within GEOM_EPS-sized noise: 1e-9 degrees) go to the smallest
// rotation. The search is finite and over integer degrees; it fixes a
// CONVENTION, not a geometric answer, which is the one finite search the
// plan allows. It is fixed against the DEFAULT camera, never the active
// view (V2), so `@view:` never re-orients a solid.
//
// The rotation is the author azimuth of one base vertex (the others at
// +360k/n). Recorded values, under the standard camera (azimuth 30,
// elevation 25):
//
//   prism regular n — lateral faces are vertical and the caps are always
//   25 degrees from edge-on, so the rule does not see proportions:
//     n = 3: 16 (margin 14.0)    n = 4: 9 (21.0)     n = 5: 3 (8.15)
//     n = 6: 0 (25.0)            n = 7: 24 (6.0)     n = 8: 19 (10.41)
//     n = 10: 12 (16.26)         n = 12: 7 (7.0)
//   octahedron (any edge): 75 (margin 14.12)
//
// A pyramid's (and a pyramidal frustum's) lateral faces lean by its
// proportions, so the rule sees them, and the rotation is a function of the
// shape, not of n alone. Recorded for the shapes the tests use:
//   pyramid regular 3 side 4, height 6: 13 (margin 16.26)
//   pyramid regular 5 side 4, height 6: 8 (13.52)
//   pyramid regular 6 side 4, height 6: 0 (10.44)
//   frustum regular 4 side 6, top 3, height 4: 14 (15.25)
// A shallow hexagonal pyramid shows why no rule can promise much: side 12,
// height 5 leans its faces at 25.7 degrees, within a degree of the camera's
// elevation, so its back face is nearly edge-on at EVERY rotation (the
// best is 28, at 1.94).
//
// For comparison only (nothing here re-places them): the rule would put a
// regular tetrahedron (edge 6) at 12 (mod 120, margin 18.0, against 15.0 at
// the pinned 45) and a square pyramid (base 6, height 9) at 14 (mod 90,
// margin 16.0, against 15.0 at the pinned 45). Both have stayed at 45
// absolute (camera azimuth + 15) since phase 6b, and the pinned placement
// is within about three degrees of the rule's best margin for both.
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

// The default camera's author azimuth, in degrees. Internal (x, z) is author
// (Y, X).
const CAMERA_AZIMUTH = (Math.atan2(DEFAULT_CAMERA.direction.x, DEFAULT_CAMERA.direction.z) * 180) / Math.PI

const DEG = Math.PI / 180

// A regular base: n corners at author azimuths rotation + 360 k / n, in
// counter-clockwise order, at circumradius r.
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

// The shapes the rule places, each as its vertices in lettering order for a
// given rotation.
export type RegularShape =
  | { kind: 'regularPrism'; sides: number; side: number; height: number }
  | { kind: 'regularPyramid'; sides: number; side: number; height: number }
  | { kind: 'regularFrustum'; sides: number; side: number; top: number; height: number }
  | { kind: 'octahedron'; edge: number }

function baseCount(shape: RegularShape): number {
  return shape.kind === 'octahedron' ? 4 : shape.sides
}

function verticesAt(shape: RegularShape, rotation: number): Vec3[] {
  switch (shape.kind) {
    case 'regularPrism': {
      const around = lettered(shape.sides, rotation)
      const r = circumradius(shape.sides, shape.side)
      return [...ring(around, r, -shape.height / 2), ...ring(around, r, shape.height / 2)]
    }
    case 'regularPyramid': {
      const around = lettered(shape.sides, rotation)
      return [...ring(around, circumradius(shape.sides, shape.side), -shape.height / 2), authorToWorld({ x: 0, y: 0, z: shape.height / 2 })]
    }
    case 'regularFrustum': {
      const around = lettered(shape.sides, rotation)
      return [
        ...ring(around, circumradius(shape.sides, shape.side), -shape.height / 2),
        ...ring(around, circumradius(shape.sides, shape.top), shape.height / 2),
      ]
    }
    case 'octahedron': {
      const r = shape.edge / Math.SQRT2
      return [...ring(lettered(4, rotation), r, 0), authorToWorld({ x: 0, y: 0, z: r }), authorToWorld({ x: 0, y: 0, z: -r })]
    }
  }
}

function build(shape: RegularShape, rotation: number): Solid3D {
  const vertices = verticesAt(shape, rotation)
  return hullOf(
    vertices,
    vertices.map((_, i) => `V${i}`)
  )
}

// The rule's objective for one rotation: the least of every face's margin
// from edge-on and every base corner's azimuthal distance from the camera's
// vertical plane, in degrees.
export function placementMargin(shape: RegularShape, rotation: number): number {
  const solid = build(shape, rotation)
  const d = DEFAULT_CAMERA.direction
  let least = Infinity
  for (let f = 0; f < solid.faces.length; f++) {
    const n = faceNormal(solid, f)
    least = Math.min(least, Math.asin(Math.min(1, Math.abs(dot3(n, d)) / length3(n))) / DEG)
  }
  for (const azimuth of baseAzimuths(baseCount(shape), rotation)) {
    const m = ((((azimuth - CAMERA_AZIMUTH) % 180) + 180) % 180)
    least = Math.min(least, Math.min(m, 180 - m))
  }
  return least
}

// P5's rotation: integer degrees in [0, 360/n), the best margin, ties to the
// smallest.
export function regularRotation(shape: RegularShape): number {
  const period = 360 / baseCount(shape)
  let best = 0
  let bestMargin = -Infinity
  for (let rotation = 0; rotation < period; rotation++) {
    const margin = placementMargin(shape, rotation)
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
// front-most base edge, counter-clockwise, apex E.
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
  const vertices = [...corners.map(authorToWorld), authorToWorld({ x: 0, y: 0, z: height / 2 })]
  return hullOf(
    vertices,
    vertices.map((_, i) => `V${i}`)
  )
}
