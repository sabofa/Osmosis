import { GEOM_EPS } from '../scene/geometry/types'
import { add3, cross3, dot3, length3, scale3, sub3 } from './construct3d'
import type { Vec3 } from './project3d'
import { frustumApexHeight } from './silhouette'
import type { SolidSpec } from './solids'
import { frustumRadii } from './solids'

// Q4 (phase 8) — a round solid cut by ANY plane, in the solid's own frame.
//
// Everything here is in the LOCAL frame of P1's placement: the solid centred
// on the origin, its axis along +y, spanning y in [-H, H]. The caller
// (crossSection.ts) turns the world plane into `n . p = d` here, with `n` a
// unit vector, and carries the answer back out. So a tilted cylinder cut by
// "plane x = 0" is, in its own frame, a plane square to its axis: a circle.
//
// **Closed form throughout, and never a solver or a sample.** Each case is
// the formula for its conic:
//  - a sphere: the circle about the foot of the centre, sqrt(r^2 - d^2);
//  - a cylinder: square to the axis a circle, parallel to it a rectangle,
//    otherwise the ellipse c + a cos(theta) + b sin(theta) in the CYLINDER
//    angle theta — the point (r cos theta, y(theta), r sin theta) has y
//    linear in cos theta and sin theta — trimmed by the two caps;
//  - a cone or frustum: square to the axis a circle; cutting every generator
//    of the (extended) cone an ellipse, from the cone's quadratic form
//    restricted to the plane (its centre and principal semi-axes, a 2 x 2
//    symmetric eigenproblem in closed form), trimmed by the base (and a
//    frustum's top); through the (virtual) apex and steeper than the
//    generators, the triangle (or trapezoid) of two generators and the cap
//    chords; parallel to a generator a parabola, steeper a hyperbola —
//    refused, since only circles and ellipses are drawn.
//
// **The trim is one rule for every ellipse.** Whatever produced it, an
// ellipse `c + a cos t + b sin t` has height y(t) = c.y + K cos(t - phi),
// K = |(a.y, b.y)|, so where it crosses a cap plane y = Y is a closed-form
// pair of angles, and the part between the caps is at most two arcs joined
// by at most two cap chords — a convex region.
//
// **Touching is not cutting.** The range of `n . p` over a round solid is a
// closed form (its support in the direction n). A plane at either end of it
// only touches the solid — at a point, or along a line — and is refused in
// words that say where; beyond it, it misses.

// One piece of a section's boundary, LOCAL or world: a straight chord, or
// the arc `center + u cos t + v sin t` for t from `from` to `to`. The pieces
// of a boundary chain end to end, closed.
export type SectionPiece =
  | { kind: 'segment'; a: Vec3; b: Vec3 }
  | { kind: 'arc'; center: Vec3; u: Vec3; v: Vec3; from: number; to: number }

export type LocalSection =
  | { kind: 'circle'; center: Vec3; radius: number }
  | { kind: 'polygon'; points: Vec3[] }
  | { kind: 'region'; boundary: SectionPiece[] }

// The refusals, each written by the caller in the author's words for the
// plane and the solid.
export interface SectionRefusals {
  misses(): Error
  // Meets the solid only `where` ("at its apex", "along one generator").
  touches(where: string): Error
  // A plane tangent to a sphere.
  tangent(): Error
  conic(kind: 'parabola' | 'hyperbola'): Error
}

const AXIS: Vec3 = { x: 0, y: 1, z: 0 }

export function localSection(spec: SolidSpec, n: Vec3, d: number, refuse: SectionRefusals): LocalSection {
  // How far the normal leans off the axis (the sine of its angle to it), and
  // its component along it.
  const s = Math.hypot(n.x, n.z)
  const ny = n.y
  switch (spec.kind) {
    case 'sphere':
      return sphereSection(spec.radius, n, d, refuse)
    case 'cylinder':
      return cylinderSection(spec.radius, spec.height / 2, n, s, ny, d, refuse)
    case 'cone':
      return coneSection(spec.radius, 0, spec.height, n, s, ny, d, refuse)
    case 'frustum': {
      const { bottom, top } = frustumRadii(spec)
      return coneSection(bottom, top, spec.height, n, s, ny, d, refuse)
    }
    default:
      throw new Error(`A ${spec.kind} is not a round solid`)
  }
}

function sphereSection(r: number, n: Vec3, d: number, refuse: SectionRefusals): LocalSection {
  const eps = GEOM_EPS * Math.max(1, r)
  if (Math.abs(d) > r + eps) throw refuse.misses()
  if (Math.abs(d) >= r - eps) throw refuse.tangent()
  return { kind: 'circle', center: scale3(n, d), radius: Math.sqrt(r * r - d * d) }
}

function cylinderSection(R: number, H: number, n: Vec3, s: number, ny: number, d: number, refuse: SectionRefusals): LocalSection {
  const eps = GEOM_EPS * Math.max(1, R, H)
  // Square to the axis: a circle of the cylinder's radius, a cap included.
  if (s <= GEOM_EPS) {
    const y0 = d / ny
    if (Math.abs(y0) > H + eps) throw refuse.misses()
    return { kind: 'circle', center: { x: 0, y: y0, z: 0 }, radius: R }
  }
  const reach = H * Math.abs(ny) + R * s
  if (Math.abs(d) > reach + eps) throw refuse.misses()
  if (Math.abs(d) >= reach - eps) throw refuse.touches(Math.abs(ny) <= GEOM_EPS ? 'along one line of its side' : 'at one point of a rim')
  // Parallel to the axis: the chord across the circular cross-section, as
  // tall as the cylinder.
  if (Math.abs(ny) <= GEOM_EPS) {
    const across = { x: -n.z / s, y: 0, z: n.x / s }
    const centre = { x: (n.x * d) / (s * s), y: 0, z: (n.z * d) / (s * s) }
    return { kind: 'polygon', points: chordRectangle(centre, across, Math.sqrt(R * R - (d * d) / (s * s)), -H, H) }
  }
  // Oblique: n.x R cos(t) + n.y y + n.z R sin(t) = d, so
  // y(t) = d/ny - (R/ny)(n.x cos t + n.z sin t): the point is
  // c + a cos t + b sin t with these conjugate semi-diameters.
  const c = { x: 0, y: d / ny, z: 0 }
  const a = { x: R, y: (-R * n.x) / ny, z: 0 }
  const b = { x: 0, y: (-R * n.z) / ny, z: R }
  return trimEllipse(c, a, b, -H, H, refuse)
}

// A cone (top 0) or a frustum (top > 0): base rim of radius R at y = -H, top
// rim of radius `top` at y = +H, axis +y. A frustum is its extended cone,
// clipped; a cone is its own.
function coneSection(R: number, top: number, h: number, n: Vec3, s: number, ny: number, d: number, refuse: SectionRefusals): LocalSection {
  const H = h / 2
  const apexHeight = top === 0 ? h : frustumApexHeight(R, top, h)
  const apex = { x: 0, y: -H + apexHeight, z: 0 }
  const eps = GEOM_EPS * Math.max(1, R, apexHeight)

  if (s <= GEOM_EPS) {
    const y0 = d / ny
    if (y0 < -H - eps || y0 > H + eps) throw refuse.misses()
    const radius = R + ((top - R) * (y0 + H)) / h
    if (radius <= eps) throw refuse.touches('at its apex')
    return { kind: 'circle', center: { x: 0, y: y0, z: 0 }, radius }
  }

  // The support of the solid along n: its base rim, and its apex or top rim.
  const base = -H * ny
  const values = top === 0 ? [base - R * s, base + R * s, H * ny] : [base - R * s, base + R * s, H * ny - top * s, H * ny + top * s]
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  // Parallel to a generator (a parabola) when the plane leans exactly as far
  // off the axis as the generators do: apexHeight |ny| = R s.
  const lean = apexHeight * Math.abs(ny) - R * s
  const parabolic = Math.abs(lean) <= eps
  const throughApex = Math.abs(d - dot3(n, apex)) <= eps
  if (d < lo - eps || d > hi + eps) throw refuse.misses()
  if (d <= lo + eps || d >= hi - eps) {
    if (throughApex && top === 0) throw refuse.touches(parabolic ? 'along one generator' : 'at its apex')
    throw refuse.touches(parabolic ? 'along one generator' : 'at one point of a rim')
  }
  if (parabolic) throw refuse.conic('parabola')

  if (lean > 0) {
    // Every generator crosses the plane: an ellipse, on the lower nappe (the
    // support test above has already refused the upper one).
    const { c, a, b } = coneEllipse(n, d, R / apexHeight, apex)
    return trimEllipse(c, a, b, -H, H, refuse)
  }

  // Steeper than the generators. Through the (virtual) apex the plane holds
  // two generators: the triangle apex-chord, or the trapezoid of the two cap
  // chords. Anywhere else it is a hyperbola.
  if (!throughApex) throw refuse.conic('hyperbola')
  const baseChord = capChord(n, s, d, -H, R)
  if (top === 0) return { kind: 'polygon', points: [baseChord[0], baseChord[1], apex] }
  const topChord = capChord(n, s, d, H, top)
  return { kind: 'polygon', points: [baseChord[0], baseChord[1], topChord[1], topChord[0]] }
}

// Where the plane crosses the cap disc at height y (radius `radius`): the two
// ends of that chord.
function capChord(n: Vec3, s: number, d: number, y: number, radius: number): [Vec3, Vec3] {
  // n.x x + n.z z = d - n.y y: a line in the cap, (d - n.y y)/s from the axis.
  const offset = (d - n.y * y) / s
  const half = Math.sqrt(Math.max(0, radius * radius - offset * offset))
  const along = { x: -n.z / s, z: n.x / s }
  const foot = { x: (n.x / s) * offset, z: (n.z / s) * offset }
  return [
    { x: foot.x - half * along.x, y, z: foot.z - half * along.z },
    { x: foot.x + half * along.x, y, z: foot.z + half * along.z },
  ]
}

function chordRectangle(centre: Vec3, across: Vec3, half: number, low: number, high: number): Vec3[] {
  const at = (side: number, y: number): Vec3 => ({ x: centre.x + side * half * across.x, y, z: centre.z + side * half * across.z })
  return [at(-1, low), at(1, low), at(1, high), at(-1, high)]
}

// The ellipse a plane cuts from the cone x^2 + z^2 = k^2 (y - apex.y)^2.
//
// In the plane, p = P0 + s e1 + t e2 (P0 the foot of the origin, e1 the axis
// projected into the plane, e2 = n x e1, horizontal). The cone's form
// Q(u, w) = u.x w.x + u.z w.z - k^2 u.y w.y, evaluated at p - apex, is the
// quadratic w^T M w + 2 beta . w + gamma in w = (s, t). Its centre is
// w0 = -M^-1 beta; there the form is f0 = gamma + beta . w0, and the ellipse
// is (w - w0)^T M (w - w0) = -f0. M's eigenvectors (a 2 x 2 symmetric
// eigenproblem, closed form) are its principal directions, and its semi-axes
// are sqrt(-f0 / lambda).
function coneEllipse(n: Vec3, d: number, k: number, apex: Vec3): { c: Vec3; a: Vec3; b: Vec3 } {
  const form = (u: Vec3, w: Vec3) => u.x * w.x + u.z * w.z - k * k * u.y * w.y
  const p0 = scale3(n, d)
  const up = sub3(AXIS, scale3(n, n.y))
  const e1 = scale3(up, 1 / length3(up))
  const e2 = cross3(n, e1)
  const D = sub3(p0, apex)
  const m11 = form(e1, e1)
  const m12 = form(e1, e2)
  const m22 = form(e2, e2)
  const b1 = form(D, e1)
  const b2 = form(D, e2)
  const det = m11 * m22 - m12 * m12
  const w0 = { s: -(m22 * b1 - m12 * b2) / det, t: -(m11 * b2 - m12 * b1) / det }
  const f0 = form(D, D) + b1 * w0.s + b2 * w0.t
  const mid = (m11 + m22) / 2
  const root = Math.hypot((m11 - m22) / 2, m12)
  const phi = 0.5 * Math.atan2(2 * m12, m11 - m22)
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)]
  const major = Math.sqrt(-f0 / (mid - root))
  const minor = Math.sqrt(-f0 / (mid + root))
  const first = add3(scale3(e1, cos), scale3(e2, sin))
  const second = add3(scale3(e1, -sin), scale3(e2, cos))
  return {
    c: add3(p0, add3(scale3(e1, w0.s), scale3(e2, w0.t))),
    // lambda = mid + root belongs to `first`, the smaller semi-axis.
    a: scale3(first, minor),
    b: scale3(second, major),
  }
}

// The part of the ellipse c + a cos t + b sin t between the caps y = low and
// y = high: the whole ellipse, one arc and a chord, or two arcs and two
// chords — in increasing t, chained end to end.
function trimEllipse(c: Vec3, a: Vec3, b: Vec3, low: number, high: number, refuse: SectionRefusals): LocalSection {
  const K = Math.hypot(a.y, b.y)
  const phi = Math.atan2(b.y, a.y)
  const at = (t: number): Vec3 => add3(c, add3(scale3(a, Math.cos(t)), scale3(b, Math.sin(t))))
  const arc = (from: number, to: number): SectionPiece => ({ kind: 'arc', center: c, u: a, v: b, from, to })
  const chord = (from: number, to: number): SectionPiece => ({ kind: 'segment', a: at(from), b: at(to) })
  // y(t) = c.y + K cos(t - phi). Below `high` where cos(t - phi) <= upper,
  // above `low` where cos(t - phi) >= lower.
  const upper = K === 0 ? Infinity : (high - c.y) / K
  const lower = K === 0 ? -Infinity : (low - c.y) / K
  if (upper < -1 - GEOM_EPS || lower > 1 + GEOM_EPS) throw refuse.misses()
  const topCuts = upper < 1 - GEOM_EPS
  const baseCuts = lower > -1 + GEOM_EPS
  if (!topCuts && !baseCuts) return { kind: 'region', boundary: [arc(0, 2 * Math.PI)] }
  const alphaTop = topCuts ? Math.acos(Math.max(-1, upper)) : 0
  const alphaBase = baseCuts ? Math.acos(Math.min(1, lower)) : Math.PI
  if (topCuts && !baseCuts) {
    return { kind: 'region', boundary: [arc(phi + alphaTop, phi + 2 * Math.PI - alphaTop), chord(phi - alphaTop, phi + alphaTop)] }
  }
  if (!topCuts && baseCuts) {
    return { kind: 'region', boundary: [arc(phi - alphaBase, phi + alphaBase), chord(phi + alphaBase, phi - alphaBase)] }
  }
  return {
    kind: 'region',
    boundary: [
      arc(phi + alphaTop, phi + alphaBase),
      chord(phi + alphaBase, phi - alphaBase),
      arc(phi + 2 * Math.PI - alphaBase, phi + 2 * Math.PI - alphaTop),
      chord(phi - alphaTop, phi + alphaTop),
    ],
  }
}
