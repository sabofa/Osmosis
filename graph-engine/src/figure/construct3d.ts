import { GEOM_EPS } from '../scene/geometry/types'
import type { Vec3 } from './project3d'

// Construction maths for solid figures — what phase 1 gave the plane, in space.
//
// Pure and camera-free, and it imports nothing but `Vec3` and `GEOM_EPS`, the
// way scene/geometry/ imports nothing but `Vec2`. Every function here commutes
// with a rotation, so it is frame-agnostic: the solid-figure walk calls it in
// the internal y-up frame, and the answers are the same points an author
// would compute in their z-up one.
//
// **Closed form throughout, and never a solver** (the spec's non-goal). Every
// construction a competition figure needs in this phase — midpoints, division,
// centroids, feet to lines and planes, a line meeting a plane — is a formula.
// A degenerate input is not a near miss to be approximated: it throws, with a
// message naming the degeneracy, so the walk above can report it in the
// author's own names.

// ---------------------------------------------------------------------------
// The Vec3 toolkit — the one exported copy
// ---------------------------------------------------------------------------

export function add3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function scale3(v: Vec3, k: number): Vec3 {
  return { x: v.x * k, y: v.y * k, z: v.z * k }
}

export function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

export function length3(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z)
}

export function distance3(a: Vec3, b: Vec3): number {
  return length3(sub3(b, a))
}

// A plane as a point on it and its UNIT normal. The orientation of the normal
// is whatever the defining points' winding gave; nothing in this phase draws
// a plane, so nothing here depends on which side is "front".
export interface Plane3 {
  point: Vec3
  normal: Vec3
}

// ---------------------------------------------------------------------------
// Degeneracy
// ---------------------------------------------------------------------------

// GEOM_EPS is a RELATIVE tolerance (see scene/geometry/types.ts): a length is
// negligible when it is small next to the coordinates it came from, not next
// to 1. The floor of 1 keeps a figure drawn near the origin from demanding
// exact zeros.
function negligible(length: number, ...scale: Vec3[]): boolean {
  let size = 1
  for (const p of scale) size = Math.max(size, length3(p))
  return length <= GEOM_EPS * size
}

// The direction a-b of a line, refusing a line that is not one.
function direction(a: Vec3, b: Vec3, label: string): Vec3 {
  const d = sub3(b, a)
  if (negligible(length3(d), a, b)) throw new Error(`The two points of ${label} coincide, so they do not determine a line`)
  return d
}

// ---------------------------------------------------------------------------
// Derived points
// ---------------------------------------------------------------------------

export function midpoint3(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
}

// The point m:n of the way from `a` to `b` — the same convention as the 2D
// `divide`, so "divide A-G at 1:2" means one part from A to two parts to G.
export function divide3(a: Vec3, b: Vec3, m: number, n: number): Vec3 {
  const total = m + n
  if (!Number.isFinite(total) || Math.abs(total) <= GEOM_EPS) {
    throw new Error(`The ratio ${m}:${n} divides nothing — its two parts must not sum to zero`)
  }
  const t = m / total
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) }
}

// The mean of the points: a triangle's centroid for three, a tetrahedron's
// for four, which are the two the grammar reaches in this phase.
export function centroid3(points: Vec3[]): Vec3 {
  if (points.length === 0) throw new Error('A centroid needs at least one point')
  let x = 0
  let y = 0
  let z = 0
  for (const p of points) {
    x += p.x
    y += p.y
    z += p.z
  }
  return { x: x / points.length, y: y / points.length, z: z / points.length }
}

// ---------------------------------------------------------------------------
// Planes
// ---------------------------------------------------------------------------

// The plane through three points. Collinear points lie on infinitely many
// planes, so that is refused rather than resolved.
export function planeThrough(a: Vec3, b: Vec3, c: Vec3, label = 'the three points'): Plane3 {
  const u = sub3(b, a)
  const w = sub3(c, a)
  const n = cross3(u, w)
  const size = length3(n)
  // |u x w| = |u||w| sin(angle): negligible against |u||w| means the angle
  // between the two sides is negligible, which is collinearity whatever the
  // sides' lengths — including a side of zero length.
  if (size <= GEOM_EPS * Math.max(1, length3(u) * length3(w))) {
    throw new Error(`${capitalise(label)} are collinear, so they do not determine a plane`)
  }
  return { point: a, normal: scale3(n, 1 / size) }
}

// The foot of the perpendicular from `p` to the plane.
export function footToPlane(p: Vec3, plane: Plane3): Vec3 {
  const offset = dot3(sub3(p, plane.point), plane.normal)
  return sub3(p, scale3(plane.normal, offset))
}

// Where the INFINITE line through a and b crosses the plane. A line parallel
// to the plane either misses it or lies in it, and neither is one point.
export function lineMeetsPlane(a: Vec3, b: Vec3, plane: Plane3, label = 'the line', planeLabel = 'the plane'): Vec3 {
  const d = direction(a, b, label)
  const along = dot3(d, plane.normal)
  if (Math.abs(along) <= GEOM_EPS * length3(d)) {
    throw new Error(`${capitalise(label)} is parallel to ${planeLabel}, so it meets it nowhere or lies in it`)
  }
  const t = dot3(sub3(plane.point, a), plane.normal) / along
  return add3(a, scale3(d, t))
}

export function pointPlaneDistance(p: Vec3, plane: Plane3): number {
  return Math.abs(dot3(sub3(p, plane.point), plane.normal))
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

// The foot of the perpendicular from `p` to the INFINITE line through a and b.
export function footToLine3(p: Vec3, a: Vec3, b: Vec3, label = 'the line'): Vec3 {
  const d = direction(a, b, label)
  const t = dot3(sub3(p, a), d) / dot3(d, d)
  return add3(a, scale3(d, t))
}

export function pointLineDistance(p: Vec3, a: Vec3, b: Vec3): number {
  return distance3(p, footToLine3(p, a, b))
}

// The distance between the infinite lines a-b and c-d.
//
// Skew lines: the length of the common perpendicular, |(c - a) . n| / |n| with
// n = d1 x d2. **Parallel lines are handled on their own branch**, as the
// distance from a point of one to the other, rather than by dividing by a
// cross product that is zero or nearly so — which would be NaN for exactly
// parallel lines and noise for nearly parallel ones.
export function lineLineDistance(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const d1 = direction(a, b, 'the first line')
  const d2 = direction(c, d, 'the second line')
  const n = cross3(d1, d2)
  const size = length3(n)
  if (size <= GEOM_EPS * length3(d1) * length3(d2)) return pointLineDistance(c, a, b)
  return Math.abs(dot3(sub3(c, a), n)) / size
}

// ---------------------------------------------------------------------------
// Angles
// ---------------------------------------------------------------------------

// The non-reflex angle at `vertex` between the rays to `from` and `to`, in
// radians. atan2(|u x v|, u . v) rather than acos of the normalised dot, for
// the reason figure/measure.ts's angleMeasure gives: acos loses its precision
// near 0 and pi, where its derivative is unbounded, and atan2 does not.
//
// Unlike the 2D measure, an arm of zero length throws: in space there is no
// drawn arc to show that an angle is degenerate, so a silent zero would be a
// number nobody can check.
export function angle3(vertex: Vec3, from: Vec3, to: Vec3, label = 'the angle'): number {
  const u = sub3(from, vertex)
  const v = sub3(to, vertex)
  if (negligible(length3(u), from, vertex) || negligible(length3(v), to, vertex)) {
    throw new Error(`An arm of ${label} has zero length: its end and the vertex coincide`)
  }
  return Math.atan2(length3(cross3(u, v)), dot3(u, v))
}

function capitalise(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1)
}
