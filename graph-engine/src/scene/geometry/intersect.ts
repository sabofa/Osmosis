import type { Vec2 } from '../types'
import {
  add,
  areParallel,
  cross,
  distance,
  GEOM_EPS,
  type GeometryCircle,
  type GeometryLine,
  type GeometryObject,
  lineDirection,
  parameterAlong,
  scale,
  sub,
  withinExtent,
} from './objects'

// Intersections of the three object kinds.
//
// Every case is solved closed form against the *underlying* infinite line or
// full circle first, and only then filtered by the line's extent. A solution
// lying past a segment's far end, or behind a ray's origin, is not a solution
// — skipping that filter is one of the quieter ways a figure comes out wrong,
// because the drawing still looks plausible.
//
// D3: when a construction yields two points they come back sorted by x
// ascending, then y ascending. That is what makes "P, Q = intersect ..."
// reproducible from run to run, which is the whole reason this engine is
// closed form rather than a solver.

// Ties on x are compared with a tolerance rather than exactly: two solutions
// that are genuinely symmetric about a vertical radical line can differ in
// their last bits, and an exact-equality tie-break would order them by
// rounding noise — precisely the non-determinism D3 exists to prevent.
function compareSolutions(p: Vec2, q: Vec2): number {
  if (Math.abs(p.x - q.x) > GEOM_EPS) return p.x - q.x
  return p.y - q.y
}

function ordered(points: Vec2[]): Vec2[] {
  return [...points].sort(compareSolutions)
}

function describeOperand(object: GeometryObject, name?: string): string {
  const kind = object.kind === 'line' ? (object.extent === 'infinite' ? 'line' : object.extent) : object.kind
  return name ? `${kind} "${name}"` : kind
}

// The span of a line, expressed in its own parameter (0 at `a`, 1 at `b`).
function extentSpan(l: GeometryLine): [number, number] {
  switch (l.extent) {
    case 'segment':
      return [0, 1]
    case 'ray':
      return [0, Number.POSITIVE_INFINITY]
    case 'infinite':
      return [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]
  }
}

// The span of `other`, re-expressed in `base`'s parameter. Only called when
// the two are already known to be collinear, so a single scalar map suffices.
function spanInBaseParameter(other: GeometryLine, base: GeometryLine): [number, number] {
  const tA = parameterAlong(other.a, base)
  const tB = parameterAlong(other.b, base)
  switch (other.extent) {
    case 'segment':
      return [Math.min(tA, tB), Math.max(tA, tB)]
    case 'ray':
      return tB > tA ? [tA, Number.POSITIVE_INFINITY] : [Number.NEGATIVE_INFINITY, tA]
    case 'infinite':
      return [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]
  }
}

function pointAtParameter(l: GeometryLine, t: number): Vec2 {
  return add(l.a, scale(sub(l.b, l.a), t))
}

// Two collinear lines: their shared span is empty (no intersection), a single
// touching point (one intersection), or a positive length — which is infinitely
// many intersections and therefore an error rather than an answer. Returning
// one arbitrary point of an overlap would be exactly the kind of quietly-wrong
// figure this layer exists to rule out.
function collinearIntersection(m: GeometryLine, n: GeometryLine, mName?: string, nName?: string): Vec2[] {
  const [mLo, mHi] = extentSpan(m)
  const [nLo, nHi] = spanInBaseParameter(n, m)
  const lo = Math.max(mLo, nLo)
  const hi = Math.min(mHi, nHi)
  const tol = GEOM_EPS / distance(m.a, m.b)

  if (lo > hi + tol) return []
  if (hi - lo <= tol) return [pointAtParameter(m, (lo + hi) / 2)]
  throw new Error(
    `${describeOperand(m, mName)} and ${describeOperand(n, nName)} lie on the same line and overlap, ` +
      `so they meet at infinitely many points — intersect objects that actually cross instead`
  )
}

function lineLine(m: GeometryLine, n: GeometryLine, mName?: string, nName?: string): Vec2[] {
  if (areParallel(m, n)) {
    const sameLine = Math.abs(cross(lineDirection(m), sub(n.a, m.a))) <= GEOM_EPS
    return sameLine ? collinearIntersection(m, n, mName, nName) : []
  }
  const r = sub(m.b, m.a)
  const s = sub(n.b, n.a)
  const qp = sub(n.a, m.a)
  const t = cross(qp, s) / cross(r, s)
  const hit = add(m.a, scale(r, t))
  if (!withinExtent(hit, m) || !withinExtent(hit, n)) return []
  return [hit]
}

function lineCircle(l: GeometryLine, c: GeometryCircle): Vec2[] {
  // Solved through the foot of the perpendicular rather than through a
  // quadratic discriminant: the tangency test then compares two *lengths*, so
  // GEOM_EPS keeps meaning a distance instead of drifting into the fourth
  // power of one.
  const t = parameterAlong(c.center, l)
  const foot = pointAtParameter(l, t)
  const h = distance(c.center, foot)
  const tol = GEOM_EPS * Math.max(1, c.radius)

  if (h > c.radius + tol) return []

  const direction = lineDirection(l)
  const hits: Vec2[] =
    Math.abs(h - c.radius) <= tol
      ? [foot]
      : (() => {
          const half = Math.sqrt(Math.max(0, c.radius * c.radius - h * h))
          return [add(foot, scale(direction, -half)), add(foot, scale(direction, half))]
        })()

  return ordered(hits.filter((p) => withinExtent(p, l)))
}

function circleCircle(m: GeometryCircle, n: GeometryCircle, mName?: string, nName?: string): Vec2[] {
  const d = distance(m.center, n.center)
  const tol = GEOM_EPS * Math.max(1, m.radius, n.radius)

  if (d <= tol) {
    if (Math.abs(m.radius - n.radius) <= tol) {
      throw new Error(
        `${describeOperand(m, mName)} and ${describeOperand(n, nName)} are the same circle, ` +
          `so they meet at infinitely many points — intersect circles that actually cross instead`
      )
    }
    return [] // concentric, different radii: no shared point anywhere
  }

  const gap = Math.abs(m.radius - n.radius)
  if (d > m.radius + n.radius + tol) return [] // too far apart
  if (d < gap - tol) return [] // one circle strictly inside the other

  // Distance from m's centre to the radical line, measured along the centre line.
  const a = (d * d - n.radius * n.radius + m.radius * m.radius) / (2 * d)
  const u = scale(sub(n.center, m.center), 1 / d)
  const mid = add(m.center, scale(u, a))

  const tangent = Math.abs(d - (m.radius + n.radius)) <= tol || Math.abs(d - gap) <= tol
  if (tangent) return [mid]

  const half = Math.sqrt(Math.max(0, m.radius * m.radius - a * a))
  const perpendicular = { x: -u.y, y: u.x }
  return ordered([add(mid, scale(perpendicular, half)), add(mid, scale(perpendicular, -half))])
}

// Dispatches on the pair of kinds. Optional names are threaded through purely
// so a failure can say "circle O and line B-C" rather than "circle and line" —
// the grammar layer knows the names, this layer does the arithmetic.
export function intersect(a: GeometryObject, b: GeometryObject, aName?: string, bName?: string): Vec2[] {
  if (a.kind === 'point' || b.kind === 'point') {
    const which = a.kind === 'point' ? describeOperand(a, aName) : describeOperand(b, bName)
    throw new Error(`Cannot intersect a ${which} — intersection takes two lines, a line and a circle, or two circles`)
  }
  if (a.kind === 'line' && b.kind === 'line') return ordered(lineLine(a, b, aName, bName))
  if (a.kind === 'line' && b.kind === 'circle') return lineCircle(a, b)
  if (a.kind === 'circle' && b.kind === 'line') return lineCircle(b, a)
  return circleCircle(a as GeometryCircle, b as GeometryCircle, aName, bName)
}
