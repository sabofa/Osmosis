import { GEOM_EPS } from '../scene/geometry/types'
import { add3, dot3, length3, scale3 } from './construct3d'
import { planeRadii, type Section, type SectionPiece, type SectionPlane } from './crossSection'
import { faceNormal, type Camera, type Solid3D, type Vec3 } from './project3d'
import { frustumApexHeight, rotateToLocal, toLocal } from './silhouette'
import { frustumRadii, type SolidBody } from './solids'

// Q6 (phase 8) — an in-place section's outline shows what the solid hides.
//
// Every piece of a cut's outline lies ON the solid's surface: a polygon side
// on a face (or along an edge), a cap chord on a cap, an arc on a cylinder's
// or cone's side or on a sphere. On a convex solid a point of the surface is
// visible exactly when a surface it lies on faces the viewer, so each piece
// is classified in closed form:
//  - on a polyhedron's face: visible iff the face faces the viewer — the
//    convex rule projectSolid uses — and along an edge (two faces) iff
//    either does;
//  - on a cap: visible iff the cap faces the viewer;
//  - on a curved surface: the outward normal is AFFINE in the point (radial
//    for a cylinder, p - c for a sphere, (x, k^2 (apex - y), z) for a cone),
//    so on an arc c + u cos t + v sin t its facing is A cos t + B sin t + C,
//    whose zeros are the exact split angles. Each span between them is
//    classified at its middle.
//
// The outline is not occluded by OTHER solids: the glass rule stands.

export interface OutlinePiece {
  piece: SectionPiece
  hidden: boolean
}

export function sectionOutline(body: SolidBody, section: Section, plane: SectionPlane, camera: Camera): OutlinePiece[] {
  const pieces = outlinePieces(section, plane)
  if (body.polyhedron) {
    const faces = facePlanes(body.polyhedron)
    return pieces.map((piece) => ({ piece, hidden: !onFacingFace(piece, faces, camera) }))
  }
  return pieces.flatMap((piece) => roundPiece(body, piece, camera))
}

// The outline as pieces: a polygon's sides, a circle as one arc of a whole
// turn (radius vectors as the in-place ellipse is drawn with, so its angle is
// the circle's own), a region's boundary as it is.
function outlinePieces(section: Section, plane: SectionPlane): SectionPiece[] {
  switch (section.kind) {
    case 'polygon':
      return section.points.map((a, i) => ({ kind: 'segment', a, b: section.points[(i + 1) % section.points.length] }))
    case 'circle': {
      const [u, v] = planeRadii(plane, section.radius)
      return [{ kind: 'arc', center: section.center, u, v, from: 0, to: 2 * Math.PI }]
    }
    case 'region':
      return section.boundary
  }
}

// ---------------------------------------------------------------------------
// Polyhedra
// ---------------------------------------------------------------------------

interface FacePlane {
  normal: Vec3
  offset: number
  facing: Vec3
}

function facePlanes(solid: Solid3D): FacePlane[] {
  return solid.faces.map((face, i) => {
    const facing = faceNormal(solid, i)
    const normal = scale3(facing, 1 / length3(facing))
    return { normal, offset: dot3(normal, solid.vertices[face[0]]), facing }
  })
}

// Whether a side lies on a face that faces the camera. A side of a convex
// solid's section with both ends on a face's plane lies in that face.
function onFacingFace(piece: SectionPiece, faces: FacePlane[], camera: Camera): boolean {
  if (piece.kind !== 'segment') return true
  const size = Math.max(1, length3(piece.a), length3(piece.b))
  const on = faces.filter(
    (f) => Math.abs(dot3(f.normal, piece.a) - f.offset) <= GEOM_EPS * size && Math.abs(dot3(f.normal, piece.b) - f.offset) <= GEOM_EPS * size
  )
  // The convex rule, exactly as projectSolid applies it to an edge.
  return on.some((f) => dot3(f.facing, camera.direction) > 0)
}

// ---------------------------------------------------------------------------
// Round solids, in their own frame
// ---------------------------------------------------------------------------

// A surface's facing as an affine function of the (local) point: g . p + g0,
// positive where its outward normal faces the viewer.
interface Facing {
  g: Vec3
  g0: number
}

interface RoundSurfaces {
  caps: { y: number; faces: boolean }[]
  lateral: Facing
  onLateral(p: Vec3): boolean
}

function roundSurfaces(body: SolidBody, d: Vec3): RoundSurfaces {
  const spec = body.spec
  const tolerance = (size: number) => GEOM_EPS * Math.max(1, size)
  switch (spec.kind) {
    case 'sphere':
      return { caps: [], lateral: { g: d, g0: 0 }, onLateral: (p) => Math.abs(length3(p) - spec.radius) <= tolerance(spec.radius) }
    case 'cylinder': {
      const H = spec.height / 2
      return {
        caps: [
          { y: H, faces: d.y > 0 },
          { y: -H, faces: -d.y > 0 },
        ],
        lateral: { g: { x: d.x, y: 0, z: d.z }, g0: 0 },
        onLateral: (p) => Math.abs(Math.hypot(p.x, p.z) - spec.radius) <= tolerance(spec.radius),
      }
    }
    case 'cone':
    case 'frustum': {
      const H = spec.height / 2
      const { bottom, top } = spec.kind === 'frustum' ? frustumRadii(spec) : { bottom: spec.radius, top: 0 }
      const apexHeight = top === 0 ? spec.height : frustumApexHeight(bottom, top, spec.height)
      const apexY = -H + apexHeight
      const k = bottom / apexHeight
      // F = x^2 + z^2 - k^2 (apex - y)^2; its gradient (x, k^2 (apex - y), z)
      // is the outward normal, and its dot with d is affine in p.
      const caps = [{ y: -H, faces: -d.y > 0 }]
      if (top > 0) caps.push({ y: H, faces: d.y > 0 })
      return {
        caps,
        lateral: { g: { x: d.x, y: -k * k * d.y, z: d.z }, g0: k * k * apexY * d.y },
        onLateral: (p) => p.y >= -H - tolerance(H) && p.y <= H + tolerance(H) && Math.abs(Math.hypot(p.x, p.z) - k * (apexY - p.y)) <= tolerance(bottom),
      }
    }
    default:
      throw new Error(`A ${spec.kind} is not a round solid`)
  }
}

function roundPiece(body: SolidBody, piece: SectionPiece, camera: Camera): OutlinePiece[] {
  const placement = body.placement
  const d = rotateToLocal(placement, camera.direction)
  const surfaces = roundSurfaces(body, d)
  const H = 'height' in body.spec ? body.spec.height / 2 : 0
  const eps = GEOM_EPS * Math.max(1, H)

  if (piece.kind === 'segment') {
    const a = toLocal(placement, piece.a)
    const b = toLocal(placement, piece.b)
    const mid = scale3(add3(a, b), 0.5)
    const onCap = surfaces.caps.filter((cap) => Math.abs(a.y - cap.y) <= eps && Math.abs(b.y - cap.y) <= eps)
    if (onCap.some((cap) => cap.faces)) return [{ piece, hidden: false }]
    // A generator: the side's normal is the same all along it.
    if (surfaces.onLateral(mid)) return [{ piece, hidden: !(dot3(surfaces.lateral.g, mid) + surfaces.lateral.g0 > 0) }]
    return [{ piece, hidden: true }]
  }

  // An arc c + u cos t + v sin t, in the local frame.
  const c = toLocal(placement, piece.center)
  const u = rotateToLocal(placement, piece.u)
  const v = rotateToLocal(placement, piece.v)
  const level = Math.abs(u.y) <= eps && Math.abs(v.y) <= eps
  const onCap = level ? surfaces.caps.filter((cap) => Math.abs(c.y - cap.y) <= eps) : []
  if (onCap.some((cap) => cap.faces)) return [{ piece, hidden: false }]
  const pointAt = (t: number) => add3(c, add3(scale3(u, Math.cos(t)), scale3(v, Math.sin(t))))
  if (!surfaces.onLateral(pointAt((piece.from + piece.to) / 2))) return [{ piece, hidden: true }]
  const { g, g0 } = surfaces.lateral
  return splitArc(piece, dot3(g, u), dot3(g, v), dot3(g, c) + g0)
}

// The arc split where A cos t + B sin t + C changes sign, each span hidden
// where it is negative. The zeros are t = phi +- acos(-C / R), R = |(A, B)|,
// phi = atan2(B, A). A whole turn that crosses the silhouette is re-based at
// its first zero, so it comes out as exactly one front and one back arc.
function splitArc(piece: Extract<SectionPiece, { kind: 'arc' }>, A: number, B: number, C: number): OutlinePiece[] {
  const facing = (t: number) => A * Math.cos(t) + B * Math.sin(t) + C
  const R = Math.hypot(A, B)
  const direction = piece.to >= piece.from ? 1 : -1
  const lo = Math.min(piece.from, piece.to)
  const hi = Math.max(piece.from, piece.to)
  const whole = hi - lo >= 2 * Math.PI - GEOM_EPS
  let zeros: number[] = []
  if (R > GEOM_EPS && Math.abs(C) < R) {
    const phi = Math.atan2(B, A)
    const alpha = Math.acos(-C / R)
    for (const base of [phi - alpha, phi + alpha]) {
      // Every turn of this zero that falls strictly inside the arc.
      for (let t = base + 2 * Math.PI * Math.ceil((lo - base) / (2 * Math.PI)); t < hi; t += 2 * Math.PI) {
        if (t > lo + GEOM_EPS && t < hi - GEOM_EPS) zeros.push(t)
      }
    }
    zeros.sort((x, y) => x - y)
  }
  if (zeros.length === 0) return [{ piece, hidden: !(facing((lo + hi) / 2) > 0) }]
  let cuts: number[]
  if (whole) {
    // Re-based at the first zero: the spans between consecutive zeros, round
    // the whole turn.
    const start = zeros[0]
    zeros = zeros.filter((t) => t < start + 2 * Math.PI - GEOM_EPS)
    cuts = [...zeros, start + 2 * Math.PI]
  } else {
    cuts = [lo, ...zeros, hi]
  }
  const spans: [number, number][] = []
  for (let i = 0; i + 1 < cuts.length; i++) spans.push([cuts[i], cuts[i + 1]])
  const ordered = direction > 0 ? spans : spans.map(([a, b]): [number, number] => [b, a]).reverse()
  return ordered.map(([from, to]) => ({
    piece: { ...piece, from, to },
    hidden: !(facing((from + to) / 2) > 0),
  }))
}

