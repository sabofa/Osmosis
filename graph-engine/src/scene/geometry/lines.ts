import type { Vec2 } from '../types'
import { add, cross, distance, GEOM_EPS, type GeometryLine, lineDirection, lineNormal, makeLine, normalize, sub } from './objects'

// The four constructions that produce *lines*.
//
// These are the ones the spec calls structurally impossible in v1: "the line
// through P parallel to A-B" had nowhere to live, because v1 had drawn
// segments but no line value. They are also what makes the ordinary
// similar-triangle, transversal and angle-bisector setups authorable at all.
//
// The first three return infinite lines. A construction line is a locus, not
// a drawn stroke — it is true everywhere along itself — so anything derived
// from it (an intersection, a foot) must see the whole line. Rendering clips
// it to the view; the object does not carry the clip.

// The line through P with the same direction as the base line. If P already
// lies on the base line the result is that same line, which is the correct
// answer rather than a degenerate case.
export function parallelThrough(p: Vec2, base: GeometryLine): GeometryLine {
  return makeLine(p, add(p, lineDirection(base)), 'infinite')
}

export function perpendicularThrough(p: Vec2, base: GeometryLine): GeometryLine {
  return makeLine(p, add(p, lineNormal(base)), 'infinite')
}

export function perpendicularBisector(a: Vec2, b: Vec2): GeometryLine {
  if (distance(a, b) <= GEOM_EPS) {
    throw new Error(`A perpendicular bisector needs two distinct points, but both are the same point (${a.x}, ${a.y})`)
  }
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const along = sub(b, a)
  return makeLine(mid, add(mid, { x: -along.y, y: along.x }), 'infinite')
}

// The bisector of the angle A-B-C, with B the vertex.
//
// A **ray from the vertex**, not an infinite line: an angle bisector is a ray
// by definition, and the backward half of the corresponding full line bisects
// the *vertical* angle instead — a different angle, pointing out of the figure
// the author drew. Making it a ray means an intersection with the opposite
// side of a triangle finds the cevian, and cannot accidentally find a point
// behind the vertex.
//
// The direction is the sum of the two arms' unit vectors. That is the interior
// bisector by construction: adding two unit vectors lands on the diagonal of
// the rhombus they span, which is the equal-angle direction.
export function angleBisector(a: Vec2, vertex: Vec2, c: Vec2): GeometryLine {
  if (distance(vertex, a) <= GEOM_EPS || distance(vertex, c) <= GEOM_EPS) {
    throw new Error(
      `An angle needs three distinct points, but a ray from the vertex (${vertex.x}, ${vertex.y}) has zero length`
    )
  }
  const toA = normalize(sub(a, vertex))
  const toC = normalize(sub(c, vertex))

  // D6: collinear means either a straight angle (the two arms oppose, and the
  // unit vectors cancel, so there is no direction to return) or a zero angle
  // (the arms coincide, so there is no angle to bisect). Both are rejected
  // rather than approximated — approximating the first would pick one of two
  // perpendiculars arbitrarily, which is exactly the kind of run-to-run
  // instability this engine is closed form to avoid.
  if (Math.abs(cross(toA, toC)) <= GEOM_EPS) {
    throw new Error(
      `(${a.x}, ${a.y}), (${vertex.x}, ${vertex.y}) and (${c.x}, ${c.y}) are collinear, ` +
        `so there is no angle at (${vertex.x}, ${vertex.y}) to bisect`
    )
  }

  return makeLine(vertex, add(vertex, normalize(add(toA, toC))), 'ray')
}
