import type { Vec2 } from '../types'
import {
  add,
  distance,
  distanceToLine,
  GEOM_EPS,
  type GeometryCircle,
  type GeometryLine,
  infiniteLine,
  normalize,
  orderPoints,
  scale,
  segment,
  sub,
  withinExtent,
} from './objects'

// Circle vocabulary (Geometry v2, phase 4).
//
// v1 could draw a circle's outline and intersect it, and nothing else, which
// is most of the reason circle geometry was unauthorable: a chord, an arc, a
// sector, a tangent and a secant are the whole working vocabulary of the
// subject, and none of them existed.
//
// Everything here is closed form over the circle's own centre and radius, in
// the same style as the rest of this layer: no sampling, no solver, one
// tolerance.

// ---------------------------------------------------------------------------
// G1 — an arc states its direction
// ---------------------------------------------------------------------------

// "The arc from P to Q" is two different arcs, and a figure that silently
// draws one of them is worse than one that refuses: the reader cannot tell it
// happened. Every arc therefore carries a direction, and the four spellings
// below cover the two ways an author thinks about it.
//
//   minor / major — by size, which is how a problem states it ("the minor arc
//                   AB"). Refused on a diameter, where the two arcs are equal
//                   semicircles and neither is the smaller one.
//   ccw / cw      — by rotation, which always names exactly one arc.
export type ArcDirection = 'minor' | 'major' | 'ccw' | 'cw'

export const ARC_DIRECTIONS: readonly ArcDirection[] = ['minor', 'major', 'ccw', 'cw']

export function isArcDirection(word: string): word is ArcDirection {
  return (ARC_DIRECTIONS as readonly string[]).includes(word)
}

// An arc, stored as the angle it starts at and the angle it sweeps through.
//
// The signed sweep is the load-bearing field, and it is why the direction is
// resolved exactly once, here: an arc's *measure* is the size of this sweep
// (G2), so an arc and the central angle drawn for it read the same number
// from the same place instead of each deciding again which way round to go.
export interface Arc {
  center: Vec2
  radius: number
  // Where the arc begins, in world radians about the centre.
  start: number
  // Signed: positive counter-clockwise, negative clockwise. Never zero, and
  // never larger than a full turn.
  sweep: number
}

// Names for the failure messages. The grammar layer knows what the author
// called these things; this layer does the arithmetic, so the names are
// threaded through exactly as `intersect` already threads them.
export interface CircleNames {
  circle?: string
  from?: string
  to?: string
  point?: string
}

// ---------------------------------------------------------------------------
// Tolerance (G3)
// ---------------------------------------------------------------------------

// Whether a point is on a circle, or a line touches one, is never an exact
// question after a chain of constructions — so it is asked against the shared
// GEOM_EPS, scaled by the radius for the same reason every other predicate in
// this layer scales by a length: at large coordinates an absolute tolerance
// rejects correct figures, and at small ones it accepts wrong ones.
function toleranceFor(c: GeometryCircle): number {
  return GEOM_EPS * Math.max(1, c.radius)
}

// How far a point misses the circle by — the number every near-miss message
// quotes, because "this is not on the circle" without the gap tells an author
// nothing about whether they have a typo or a rounding artefact.
export function distanceFromCircle(c: GeometryCircle, p: Vec2): number {
  return Math.abs(distance(p, c.center) - c.radius)
}

export function isPointOnCircle(c: GeometryCircle, p: Vec2): boolean {
  return distanceFromCircle(c, p) <= toleranceFor(c)
}

// Whether a line touches the circle rather than crossing or missing it,
// honouring the line's extent: a segment that stops short of the touch point
// does not touch anything, and drawing it as a tangent would be a lie the
// reader can see.
export function isTangentLine(l: GeometryLine, c: GeometryCircle): boolean {
  const gap = Math.abs(distanceToLine(c.center, l) - c.radius)
  if (gap > toleranceFor(c)) return false
  return withinExtent(footOnLine(c.center, l), l)
}

function footOnLine(p: Vec2, l: GeometryLine): Vec2 {
  const ab = sub(l.b, l.a)
  const t = (sub(p, l.a).x * ab.x + sub(p, l.a).y * ab.y) / (ab.x * ab.x + ab.y * ab.y)
  return add(l.a, scale(ab, t))
}

// A gap, written for a human. Small gaps print in exponent form rather than
// as "0" — "it misses by 0" is the one thing a near-miss message must never
// say.
function amount(value: number): string {
  if (value === 0) return '0'
  if (value < 1e-3) return value.toExponential(2)
  const fixed = value.toFixed(4).replace(/\.?0+$/, '')
  return fixed === '' ? '0' : fixed
}

function label(name: string | undefined, at: Vec2): string {
  return name ? `"${name}"` : `(${amount(at.x)}, ${amount(at.y)})`
}

function circleLabel(names: CircleNames): string {
  return names.circle ? `circle "${names.circle}"` : 'the circle'
}

// The one near-miss message, so a chord, an arc, a tangent and a radius all
// fail the same way rather than in four dialects.
function assertOnCircle(c: GeometryCircle, p: Vec2, name: string | undefined, role: string, names: CircleNames): void {
  if (isPointOnCircle(c, p)) return
  throw new Error(
    `${label(name, p)} is ${amount(distanceFromCircle(c, p))} from ${circleLabel(names)} (radius ${amount(c.radius)}) — ` +
      `${role} must lie on the circle`
  )
}

function assertDistinct(p: Vec2, q: Vec2, names: CircleNames, what: string): void {
  if (distance(p, q) > GEOM_EPS) return
  throw new Error(`${label(names.from, p)} and ${label(names.to, q)} are the same point, so they do not define ${what}`)
}

// ---------------------------------------------------------------------------
// The constructions
// ---------------------------------------------------------------------------

// The segment between two points of the circle.
export function chord(c: GeometryCircle, from: Vec2, to: Vec2, names: CircleNames = {}): GeometryLine {
  assertOnCircle(c, from, names.from, "a chord's endpoints", names)
  assertOnCircle(c, to, names.to, "a chord's endpoints", names)
  assertDistinct(from, to, names, 'a chord')
  return segment(from, to)
}

// The angle of a point of the circle, about its centre.
function angleOf(c: GeometryCircle, p: Vec2): number {
  return Math.atan2(p.y - c.center.y, p.x - c.center.x)
}

const TURN = 2 * Math.PI

// An arc from `from` to `to`, going the way `direction` says.
export function arcBetween(c: GeometryCircle, from: Vec2, to: Vec2, direction: ArcDirection, names: CircleNames = {}): Arc {
  assertOnCircle(c, from, names.from, "an arc's endpoints", names)
  assertOnCircle(c, to, names.to, "an arc's endpoints", names)
  assertDistinct(from, to, names, 'an arc')

  const start = angleOf(c, from)
  // The counter-clockwise sweep, in (0, 2π): the other direction is this one
  // minus a full turn, so there is exactly one number to get right.
  let ccw = angleOf(c, to) - start
  while (ccw <= 0) ccw += TURN
  while (ccw > TURN) ccw -= TURN
  const cw = ccw - TURN

  // Angular tolerance: an arc's endpoints are already known to sit on the
  // circle to within GEOM_EPS of a length, and at this radius that is
  // GEOM_EPS / radius of a radian. Using the looser of the two keeps a tiny
  // circle from deciding a near-semicircle is exactly one.
  const angleTolerance = Math.max(GEOM_EPS, GEOM_EPS / c.radius)

  switch (direction) {
    case 'ccw':
      return { center: c.center, radius: c.radius, start, sweep: ccw }
    case 'cw':
      return { center: c.center, radius: c.radius, start, sweep: cw }
    case 'minor':
    case 'major': {
      if (Math.abs(ccw - Math.PI) <= angleTolerance) {
        throw new Error(
          `${label(names.from, from)} and ${label(names.to, to)} are opposite ends of a diameter of ${circleLabel(names)}, ` +
            `so both arcs between them are semicircles and "${direction}" names neither — write "ccw" or "cw" to say which one you mean`
        )
      }
      const shorter = ccw < Math.PI ? ccw : cw
      const longer = ccw < Math.PI ? cw : ccw
      return { center: c.center, radius: c.radius, start, sweep: direction === 'minor' ? shorter : longer }
    }
  }
}

export function arcPointAt(arc: Arc, t: number): Vec2 {
  const angle = arc.start + arc.sweep * t
  return { x: arc.center.x + arc.radius * Math.cos(angle), y: arc.center.y + arc.radius * Math.sin(angle) }
}

// The two ends, in the order the arc runs: first the point it starts at, then
// the one it finishes at, whichever way round it went.
export function arcEndpoints(arc: Arc): [Vec2, Vec2] {
  return [arcPointAt(arc, 0), arcPointAt(arc, 1)]
}

// The midpoint of the arc itself — where a sector's or a segment's fill is
// thickest, and where an arc's own label belongs.
export function arcMidpoint(arc: Arc): Vec2 {
  return arcPointAt(arc, 0.5)
}

// The tangent at a point *of* the circle: the line through it perpendicular
// to the radius drawn there.
export function tangentAt(c: GeometryCircle, p: Vec2, names: CircleNames = {}): GeometryLine {
  assertOnCircle(c, p, names.point ?? names.from, 'the point a tangent touches at', names)
  const radial = normalize(sub(p, c.center))
  // A fixed quarter turn counter-clockwise, not an arbitrary perpendicular:
  // the two defining points of the line are part of the emitted output.
  return infiniteLine(p, add(p, { x: -radial.y, y: radial.x }))
}

// The two points of the circle at which a tangent from an external point
// touches, ordered by the shared rule (objects.ts's comparePoints) — the same
// one `intersect` uses, and for the same reason: two solutions that come back
// in construction order are two solutions whose names swap when the
// arithmetic is rearranged.
export function tangentPointsFrom(c: GeometryCircle, p: Vec2, names: CircleNames = {}): Vec2[] {
  const d = distance(p, c.center)
  const tolerance = toleranceFor(c)
  const name = names.point ?? names.from

  if (d < c.radius - tolerance) {
    throw new Error(
      `${label(name, p)} is ${amount(c.radius - d)} inside ${circleLabel(names)} (radius ${amount(c.radius)}) — ` +
        'tangents are drawn from a point outside the circle'
    )
  }
  if (d <= c.radius + tolerance) {
    throw new Error(
      `${label(name, p)} lies on ${circleLabel(names)}, so there is one tangent there rather than two — ` +
        'write "tangent at <point> on <circle>" for the tangent at a point of the circle'
    )
  }

  // The touch points sit on the circle of diameter [centre, p]: the foot is
  // r²/d along the centre line and the half-chord is r·sqrt(d² - r²)/d off it.
  const u = scale(sub(p, c.center), 1 / d)
  const foot = add(c.center, scale(u, (c.radius * c.radius) / d))
  const half = (c.radius * Math.sqrt(d * d - c.radius * c.radius)) / d
  const perpendicular = { x: -u.y, y: u.x }
  // Sorted, not emitted in construction order: which of the two the
  // perpendicular happens to reach first is a fact about the arithmetic, and
  // binding "T, U = tangent from P to O" to it would make the two names swap
  // when the figure moves.
  return orderPoints([add(foot, scale(perpendicular, half)), add(foot, scale(perpendicular, -half))])
}

// The two tangents themselves, drawn as the segments from the external point
// to its touch points. A segment rather than an infinite line because that is
// the figure a problem shows — and because its length is then the tangent
// length, which is the quantity the problem is usually about.
export function tangentsFrom(c: GeometryCircle, p: Vec2, names: CircleNames = {}): GeometryLine[] {
  return tangentPointsFrom(c, p, names).map((touch) => segment(p, touch))
}

// A line cutting the circle twice — the other half of power-of-a-point.
//
// Written as two points rather than as the spec's "secant through P", which
// names infinitely many lines: one point does not determine a secant, and a
// construction that picks one of them silently is the same mistake G1 refuses
// for arcs.
export function secantThrough(c: GeometryCircle, from: Vec2, to: Vec2, names: CircleNames = {}): GeometryLine {
  assertDistinct(from, to, names, 'a secant')
  const line = infiniteLine(from, to)
  const gap = distanceToLine(c.center, line) - c.radius
  if (gap > toleranceFor(c)) {
    throw new Error(
      `the line through ${label(names.from, from)} and ${label(names.to, to)} misses ${circleLabel(names)} by ${amount(gap)} — ` +
        'a secant cuts the circle at two points'
    )
  }
  if (isTangentLine(line, c)) {
    throw new Error(
      `the line through ${label(names.from, from)} and ${label(names.to, to)} touches ${circleLabel(names)} at one point — ` +
        'that is a tangent, not a secant'
    )
  }
  return line
}

// A radius, drawn rather than left implicit.
export function radiusTo(c: GeometryCircle, p: Vec2, names: CircleNames = {}): GeometryLine {
  assertOnCircle(c, p, names.point ?? names.to, 'the far end of a radius', names)
  return segment(c.center, p)
}

// A diameter: a chord through the centre, so its endpoints have to be
// opposite each other and not merely both on the circle.
export function diameter(c: GeometryCircle, from: Vec2, to: Vec2, names: CircleNames = {}): GeometryLine {
  assertOnCircle(c, from, names.from, "a diameter's endpoints", names)
  assertOnCircle(c, to, names.to, "a diameter's endpoints", names)
  assertDistinct(from, to, names, 'a diameter')
  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  const offset = distance(middle, c.center)
  if (offset > toleranceFor(c)) {
    throw new Error(
      `${label(names.from, from)} and ${label(names.to, to)} are not opposite each other on ${circleLabel(names)} — ` +
        `the segment between them passes ${amount(offset)} from the centre, so it is a chord and not a diameter`
    )
  }
  return segment(from, to)
}

// Re-exported so a caller ordering its own multi-solution results reaches for
// the shared rule rather than writing a second one.
export { orderPoints }
