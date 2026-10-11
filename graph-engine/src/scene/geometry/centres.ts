import type { Vec2 } from '../types'
import { add, circle, cross, distance, dot, footOfPerpendicular, GEOM_EPS, type GeometryCircle, scale, segment, sub } from './objects'

// Triangle centres, and — the part that makes them usable — the incircle and
// circumcircle as actual circles rather than bare centre points. The spec is
// explicit about this: "A center point without its circle is not usable."
//
// Vertices are taken positionally as (a, b, c), matching how a triangle is
// named in the DSL ("triangle ABC"). Side names follow the textbook
// convention: side `a` is the one opposite vertex `a`, i.e. b-c.

// Twice the signed area, positive when a-b-c winds counter-clockwise. Zero
// exactly when the three points are collinear, which is the single degeneracy
// every construction here has to rule out.
function twiceSignedArea(a: Vec2, b: Vec2, c: Vec2): number {
  return cross(sub(b, a), sub(c, a))
}

// D6: a degenerate triangle fails rather than being approximated. Three
// collinear points have no circumcentre at all (the perpendicular bisectors
// are parallel) and an incircle of radius zero, so answering with *something*
// would be answering a question that was not asked.
//
// The collinearity threshold is scaled by the triangle's own size: twice the
// area has units of length squared, so a fixed absolute threshold would call
// a large well-formed triangle degenerate or a tiny genuine one fine,
// depending only on the coordinate scale the author happened to use.
function assertTriangle(a: Vec2, b: Vec2, c: Vec2): number {
  const area2 = twiceSignedArea(a, b, c)
  const spread = Math.max(distance(a, b), distance(b, c), distance(c, a))
  if (Math.abs(area2) <= GEOM_EPS * Math.max(1, spread * spread)) {
    throw new Error(
      `(${a.x}, ${a.y}), (${b.x}, ${b.y}) and (${c.x}, ${c.y}) are collinear, so they do not form a triangle`
    )
  }
  return area2
}

// The unsigned area, which is what r = Area/s and R = abc/(4*Area) want.
export function triangleArea(a: Vec2, b: Vec2, c: Vec2): number {
  return Math.abs(assertTriangle(a, b, c)) / 2
}

export function centroid(a: Vec2, b: Vec2, c: Vec2): Vec2 {
  assertTriangle(a, b, c)
  return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 }
}

// Solved directly from the two perpendicular-bisector equations
//   2(B-A).P = |B|^2 - |A|^2 ,  2(C-A).P = |C|^2 - |A|^2
// rather than by building two bisector lines and intersecting them. Same
// answer, but it keeps the degenerate case as one explicit check up front
// instead of a parallel-lines failure surfacing from two layers down.
export function circumcenter(a: Vec2, b: Vec2, c: Vec2): Vec2 {
  const d = 2 * assertTriangle(a, b, c)
  const aa = a.x * a.x + a.y * a.y
  const bb = b.x * b.x + b.y * b.y
  const cc = c.x * c.x + c.y * c.y
  return {
    x: (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d,
    y: (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d,
  }
}

export function circumcircle(a: Vec2, b: Vec2, c: Vec2): GeometryCircle {
  const center = circumcenter(a, b, c)
  // R = abc/(4*Area) is the identity the spec names. Taking the distance to a
  // vertex would be cheaper, but computing it this way and *testing* that all
  // three vertices land on it is what catches an error in the centre.
  const radius = (distance(b, c) * distance(c, a) * distance(a, b)) / (4 * triangleArea(a, b, c))
  return circle(center, radius)
}

// The incentre is the side-length-weighted average of the vertices: each
// vertex weighted by the length of the side opposite it.
export function incenter(a: Vec2, b: Vec2, c: Vec2): Vec2 {
  assertTriangle(a, b, c)
  const sideA = distance(b, c)
  const sideB = distance(c, a)
  const sideC = distance(a, b)
  const perimeter = sideA + sideB + sideC
  return scale(add(add(scale(a, sideA), scale(b, sideB)), scale(c, sideC)), 1 / perimeter)
}

export function incircle(a: Vec2, b: Vec2, c: Vec2): GeometryCircle {
  const center = incenter(a, b, c)
  const s = (distance(b, c) + distance(c, a) + distance(a, b)) / 2
  return circle(center, triangleArea(a, b, c) / s)
}

// Where the incircle touches each side: the foot of the perpendicular from
// the incentre to that side. Returned in side order — the point on b-c
// (opposite a), then on c-a, then on a-b — so a caller can pair each with the
// side it belongs to without guessing.
export function incircleTangentPoints(a: Vec2, b: Vec2, c: Vec2): [Vec2, Vec2, Vec2] {
  const center = incenter(a, b, c)
  return [
    footOfPerpendicular(center, segment(b, c)),
    footOfPerpendicular(center, segment(c, a)),
    footOfPerpendicular(center, segment(a, b)),
  ]
}

// Solved as the meeting point of two altitudes:
//   (P - A).(C - B) = 0   and   (P - B).(A - C) = 0
//
// Deliberately NOT as H = 3G - 2O. That identity is true and would be one
// line, but then the Euler-line test would be checking the formula this
// function is built from rather than checking anything — it would pass for
// any centroid and circumcentre, however wrong. Computing H independently is
// what turns "G, O and H are collinear at 2:1" into the cross-check on all
// three that the plan asks it to be.
export function orthocenter(a: Vec2, b: Vec2, c: Vec2): Vec2 {
  assertTriangle(a, b, c)
  const alongBC = sub(c, b)
  const alongCA = sub(a, c)
  const k1 = dot(alongBC, a)
  const k2 = dot(alongCA, b)
  const det = cross(alongBC, alongCA)
  return {
    x: (k1 * alongCA.y - k2 * alongBC.y) / det,
    y: (alongBC.x * k2 - alongCA.x * k1) / det,
  }
}
