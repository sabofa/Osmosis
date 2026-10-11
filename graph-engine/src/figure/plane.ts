import type { Bindings } from '../parser/evalExpr'
import type { Expr } from '../parser/types'
import { GEOM_EPS } from '../scene/geometry/types'
import { authorToWorld } from './authorFrame'
import { cross3, dot3, length3, scale3, sub3, type Plane3 } from './construct3d'
import type { PlaneAxis, SectionPlane } from './crossSection'
import { DEFAULT_CAMERA, type Vec3 } from './project3d'

// Q1 — one internal plane, canonicalised (phase 8).
//
// An author writes a plane six ways (parser/types.ts's PlaneForm): through
// three points, through a point perpendicular to a line, through a point
// parallel to another plane, by an equation, as "z = 1", or by name. The
// solid-figure walk turns each into a `Plane3` — a point and a unit normal,
// in the internal frame — and this module turns THAT into the one value a
// section is cut by, a `SectionPlane`.
//
// **Canonicalisation.** A plane whose normal is parallel to an internal axis
// becomes the phase-5 AXIS form, `{ axis, at }`, with the sign normalised so
// `at` is the coordinate. So "plane A-B-C" through three points at author
// z = 1 is exactly "plane z = 1" — the same object, the same code path and
// the same bytes. Every other plane is GENERAL.
//
// **The frame of a general plane** decides how its section lifts (the true
// shape). It is fixed against the DEFAULT camera, never the active view (V2),
// so switching `@view:` never turns a lifted section:
//  - the normal faces the default camera (`direction . normal > 0`); a plane
//    seen exactly edge-on turns toward author +Z, then author +X;
//  - `v` is author Z projected onto the plane and normalised — "up" in the
//    plane is as near vertical as the plane allows — or author Y when the
//    plane is horizontal (which canonicalisation has already made an axis
//    plane, so this is a fallback no author form reaches);
//  - `u = v x normal`, so (u, v, normal) is right-handed and a lifted section
//    is seen from the viewer's side, not mirrored.
//
// **The point** of a general plane is the foot of the internal origin, so the
// same plane written two ways is the same value, not two values that differ
// by where the author happened to anchor it.

// Author Z, Y and X in the internal frame (authorFrame.ts's S1 map).
const AUTHOR_Z: Vec3 = { x: 0, y: 1, z: 0 }
const AUTHOR_Y: Vec3 = { x: 1, y: 0, z: 0 }
const AUTHOR_X: Vec3 = { x: 0, y: 0, z: 1 }

const AXES: readonly PlaneAxis[] = ['x', 'y', 'z']

function unit(v: Vec3): Vec3 {
  return scale3(v, 1 / length3(v))
}

export function canonicalPlane(plane: Plane3, source: string): SectionPlane {
  const n = unit(plane.normal)
  for (const axis of AXES) {
    const others = AXES.filter((a) => a !== axis)
    // Parallel to the axis within GEOM_EPS: the normal's sideways part (the
    // sine of its angle from the axis) is negligible.
    if (Math.hypot(n[others[0]], n[others[1]]) <= GEOM_EPS) {
      // n . x = n . point on the plane; along the axis, x_axis = (n . point) / n_axis.
      return { kind: 'axis', axis, at: dot3(n, plane.point) / n[axis], source }
    }
  }
  return generalPlane(n, plane.point, source)
}

function generalPlane(n: Vec3, through: Vec3, source: string): SectionPlane {
  const normal = scale3(n, towardCamera(n))
  const point = scale3(normal, dot3(normal, through))
  const up = sub3(AUTHOR_Z, scale3(normal, dot3(AUTHOR_Z, normal)))
  const v = length3(up) > GEOM_EPS ? unit(up) : unit(sub3(AUTHOR_Y, scale3(normal, dot3(AUTHOR_Y, normal))))
  const u = cross3(v, normal)
  return { kind: 'general', point, normal, u, v, source }
}

// +1 to keep the normal, -1 to turn it: toward the default camera, and when
// the plane is seen exactly edge-on, toward author +Z, then author +X.
function towardCamera(n: Vec3): number {
  for (const toward of [DEFAULT_CAMERA.direction, AUTHOR_Z, AUTHOR_X]) {
    const along = dot3(n, toward)
    if (Math.abs(along) > GEOM_EPS) return along > 0 ? 1 : -1
  }
  return 1
}

// The plane a section is cut by, as a point and a unit normal — for the
// constructions (foot, intersect) that take a plane operand.
export function planeOfSection(plane: SectionPlane): Plane3 {
  if (plane.kind === 'general') return { point: plane.point, normal: plane.normal }
  const normal: Vec3 = { x: 0, y: 0, z: 0 }
  normal[plane.axis] = 1
  return { point: scale3(normal, plane.at), normal }
}

// Signed distance from the plane: `normal . p - normal . point`, the axis
// form's "coordinate - at" as its special case (Q3).
export function signedDistance(plane: SectionPlane, p: Vec3): number {
  if (plane.kind === 'axis') return p[plane.axis] - plane.at
  return dot3(plane.normal, sub3(p, plane.point))
}

// ---------------------------------------------------------------------------
// The equation form
// ---------------------------------------------------------------------------

// "plane 2x + y - z = 3", read EXACTLY for any genuinely linear input, and
// refused for anything else — so this is reading, not solving.
//
// **Linearity is read off the expression TREE, never probed** (fix round 1,
// controller ruling). No finite set of probe points is sound once functions
// appear: abs(x) agrees with x at every probe with x >= 0, and so does
// sqrt(x^2). `isAffine` is exact instead. Once both sides are affine,
// f(x, y, z) = left - right IS c0 + a x + b y + c z, and evaluating it at the
// origin and the three unit points reads those four numbers.
//
// The equation is in the AUTHOR frame; the plane comes back internal.
export function planeFromEquation(
  left: Expr,
  right: Expr,
  evaluate: (e: Expr, vars: Bindings) => number,
  source: string
): Plane3 {
  if (!isAffine(left) || !isAffine(right)) throw new Error(`plane ${source} is not a plane — it must be linear in x, y, z`)
  const f = (x: number, y: number, z: number): number => {
    const value = evaluate(left, { x, y, z }) - evaluate(right, { x, y, z })
    if (!Number.isFinite(value)) throw new Error(`plane ${source} does not evaluate to a number at (${x}, ${y}, ${z})`)
    return value
  }
  const c0 = f(0, 0, 0)
  const a = f(1, 0, 0) - c0
  const b = f(0, 1, 0) - c0
  const c = f(0, 0, 1) - c0
  const normal: Vec3 = { x: a, y: b, z: c }
  const size = length3(normal)
  if (size <= GEOM_EPS * Math.max(1, Math.abs(c0))) {
    throw new Error(`plane ${source} is not a plane — x, y and z all have coefficient 0, so it fixes no direction`)
  }
  // a x + b y + c z = -c0: the foot of the origin is n (-c0) / |n|^2.
  const point = scale3(normal, -c0 / (size * size))
  return { point: authorToWorld(point), normal: authorToWorld(scale3(normal, 1 / size)) }
}

const AXIS_VARIABLES: ReadonlySet<string> = new Set(['x', 'y', 'z'])

// Whether an expression depends on x, y or z at all.
function dependsOnAxes(e: Expr): boolean {
  switch (e.kind) {
    case 'num':
      return false
    case 'var':
      return AXIS_VARIABLES.has(e.name)
    case 'unary':
      return dependsOnAxes(e.arg)
    case 'binary':
      return dependsOnAxes(e.left) || dependsOnAxes(e.right)
    case 'call':
      return e.args.some(dependsOnAxes)
  }
}

// Whether an expression is AFFINE in x, y, z, by its structure alone:
// numbers and named constants (constant), x, y, z (linear), unary minus, + and
// -, * with at most one side depending on x, y, z, / by something that does
// not, and ^ and function calls only over subexpressions that do not (those
// are constants, and may be evaluated). Anything else is refused — even an
// expression that happens to simplify to a linear one, such as x^1.
export function isAffine(e: Expr): boolean {
  switch (e.kind) {
    case 'num':
    case 'var':
      return true
    case 'unary':
      return isAffine(e.arg)
    case 'binary':
      switch (e.op) {
        case '+':
        case '-':
          return isAffine(e.left) && isAffine(e.right)
        case '*':
          return (!dependsOnAxes(e.left) && isAffine(e.right)) || (!dependsOnAxes(e.right) && isAffine(e.left))
        case '/':
          return isAffine(e.left) && !dependsOnAxes(e.right)
        case '^':
          return !dependsOnAxes(e.left) && !dependsOnAxes(e.right)
      }
      return false
    case 'call':
      return !e.args.some(dependsOnAxes)
  }
}
