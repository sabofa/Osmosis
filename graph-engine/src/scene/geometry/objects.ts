import type { Vec2 } from '../types'
import { GEOM_EPS, type GeometryCircle, type GeometryLine, type GeometryObject, type GeometryPoint, type LineExtent } from './types'

export * from './types'

// ---------------------------------------------------------------------------
// Vec2 arithmetic
//
// Local rather than imported: scene/types.ts's Vec2 is a bare data shape with
// no operations, and the geometry layer wants these on every other line.
// ---------------------------------------------------------------------------

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scale(v: Vec2, k: number): Vec2 {
  return { x: v.x * k, y: v.y * k }
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y
}

// The 2D scalar cross product (the z component of the 3D cross product).
// Zero exactly when the two vectors are parallel, which is the whole
// parallel/collinear/degenerate story in this layer.
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y)
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function normalize(v: Vec2): Vec2 {
  const len = length(v)
  if (len === 0) throw new Error('Cannot normalize a zero-length vector')
  return { x: v.x / len, y: v.y / len }
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export function point(at: Vec2): GeometryPoint {
  return { kind: 'point', at }
}

// Named makeLine, not line: "line" is wanted as a local variable name all over
// this layer, and a constructor that shadows that badly is a nuisance.
export function makeLine(a: Vec2, b: Vec2, extent: LineExtent): GeometryLine {
  if (distance(a, b) <= GEOM_EPS) {
    throw new Error(`A line needs two distinct points, but both are the same point (${a.x}, ${a.y})`)
  }
  return { kind: 'line', a, b, extent }
}

export function segment(a: Vec2, b: Vec2): GeometryLine {
  return makeLine(a, b, 'segment')
}

export function ray(origin: Vec2, through: Vec2): GeometryLine {
  return makeLine(origin, through, 'ray')
}

export function infiniteLine(a: Vec2, b: Vec2): GeometryLine {
  return makeLine(a, b, 'infinite')
}

export function circle(center: Vec2, radius: number): GeometryCircle {
  if (!(radius > 0)) throw new Error(`A circle needs a positive radius, got ${radius}`)
  return { kind: 'circle', center, radius }
}

// ---------------------------------------------------------------------------
// Line primitives
// ---------------------------------------------------------------------------

// Unit vector from a toward b.
export function lineDirection(l: GeometryLine): Vec2 {
  return normalize(sub(l.b, l.a))
}

// Unit vector perpendicular to the line, the direction rotated a quarter turn
// counter-clockwise. Which of the two normals this is matters for nothing in
// this phase, but it is fixed rather than arbitrary so it stays deterministic.
export function lineNormal(l: GeometryLine): Vec2 {
  const d = lineDirection(l)
  return { x: -d.y, y: d.x }
}

// True when the two lines have the same direction up to sign. Antiparallel
// counts: "parallel" here is about the underlying lines, not the arrow.
//
// Compared on *normalized* directions so the threshold means the same thing
// for a 1-unit segment and a 1000-unit one — the whole point of the
// near-parallel test is that a line that misses by a thousandth of a radian
// is not parallel no matter how long it is.
export function areParallel(m: GeometryLine, n: GeometryLine): boolean {
  return Math.abs(cross(lineDirection(m), lineDirection(n))) <= GEOM_EPS
}

// Where p falls along the line, in units of |b - a|: 0 at a, 1 at b. The
// parameter a hit has to satisfy for the line's extent to admit it.
export function parameterAlong(p: Vec2, l: GeometryLine): number {
  const ab = sub(l.b, l.a)
  return dot(sub(p, l.a), ab) / dot(ab, ab)
}

// Whether a point already known to lie on the underlying *line* also lies
// within this object's extent. Separated out because every intersection in
// this layer solves against the infinite line first and then filters — an
// intersection lying past a segment's end or behind a ray's origin is not a
// solution, and skipping that filter is a real source of wrong figures.
export function withinExtent(p: Vec2, l: GeometryLine): boolean {
  if (l.extent === 'infinite') return true
  const abLen = distance(l.a, l.b)
  // Tolerance expressed in the parameter's own units, so an endpoint hit
  // counts as inside regardless of how long the segment is.
  const tol = GEOM_EPS / abLen
  const t = parameterAlong(p, l)
  if (t < -tol) return false
  return l.extent === 'ray' || t <= 1 + tol
}

// Whether p lies on the line, honouring extent. Collinearity is measured as
// the perpendicular distance from the line, not as a raw cross product, so
// the tolerance is a distance in world units rather than something that grows
// with the length of the defining segment.
export function isPointOnLine(p: Vec2, l: GeometryLine): boolean {
  const perpendicular = Math.abs(cross(lineDirection(l), sub(p, l.a)))
  if (perpendicular > GEOM_EPS) return false
  return withinExtent(p, l)
}

// The foot of the perpendicular from p to the line — the closest point on the
// *infinite* line. Deliberately not clamped to the extent: a segment's foot
// that lands past its end is a legitimate construction (that is exactly what
// "extend the base to meet the altitude" means), and a silently clamped foot
// would draw a right angle that is not one.
export function footOfPerpendicular(p: Vec2, l: GeometryLine): Vec2 {
  return add(l.a, scale(sub(l.b, l.a), parameterAlong(p, l)))
}

// Signed perpendicular distance from p to the underlying line, positive on
// the side the line's normal points to.
export function signedDistanceToLine(p: Vec2, l: GeometryLine): number {
  return dot(sub(p, l.a), lineNormal(l))
}

export function distanceToLine(p: Vec2, l: GeometryLine): number {
  return Math.abs(signedDistanceToLine(p, l))
}

// ---------------------------------------------------------------------------
// D3 — the shared ordering rule for multi-solution constructions
// ---------------------------------------------------------------------------

// When a construction yields two results they come back sorted by x
// ascending, then y ascending. That is what makes "P, Q = intersect ..."
// reproducible from run to run, and it is the reason this engine is closed
// form rather than a solver.
//
// Ties on x are compared with a tolerance rather than exactly: two solutions
// that are genuinely symmetric about a vertical radical line can differ in
// their last bits, and an exact-equality tie-break would order them by
// rounding noise — precisely the non-determinism D3 exists to prevent.
//
// It lives here, beside the rest of the shared primitives, because *every*
// multi-solution construction has to use the same one: intersect, and the two
// tangents from an external point. A second comparator calibrated slightly
// differently would be a second ordering rule, which is the same bug as
// having none.
export function comparePoints(p: Vec2, q: Vec2): number {
  if (Math.abs(p.x - q.x) > GEOM_EPS) return p.x - q.x
  return p.y - q.y
}

export function orderPoints(points: readonly Vec2[]): Vec2[] {
  return [...points].sort(comparePoints)
}

// ---------------------------------------------------------------------------
// The namespace
// ---------------------------------------------------------------------------

// Geometry names are letters only (A, P, m, AB) — the same rule the existing
// point labels already follow. That keeps them distinct from the
// general-identifier rule ("a = 5", "k(x) = ...") used by named constants and
// functions, so "a" being a constant and "A" being a point can never be the
// same question.
const GEOMETRY_NAME = /^[a-zA-Z]+$/

export function isGeometryName(name: string): boolean {
  return GEOMETRY_NAME.test(name)
}

function describeObject(object: GeometryObject): string {
  switch (object.kind) {
    case 'point':
      return `point (${object.at.x}, ${object.at.y})`
    case 'line':
      return `${object.extent === 'infinite' ? 'line' : object.extent}`
    case 'circle':
      return 'circle'
  }
}

// One namespace for all three kinds: `intersect m, n` resolves both by name
// and dispatches on whatever kinds they turn out to be, which only works if
// a name binds to an object rather than to a kind-specific table.
//
// Rebinding is an error rather than a last-one-wins overwrite. Silent
// rebinding would make a figure depend on statement order in a way nothing
// in the spec text signals — the author would see a name they defined, and
// get someone else's object.
export class GeometryScope {
  private readonly objects = new Map<string, GeometryObject>()

  bind(name: string, object: GeometryObject): void {
    if (!isGeometryName(name)) {
      throw new Error(`Invalid geometry name "${name}" — geometry names are letters only (e.g. "A", "P", "m", "AB")`)
    }
    const existing = this.objects.get(name)
    if (existing) {
      throw new Error(`"${name}" is already bound to a ${describeObject(existing)} — pick a different name rather than redefining it`)
    }
    this.objects.set(name, object)
  }

  has(name: string): boolean {
    return this.objects.has(name)
  }

  names(): string[] {
    return [...this.objects.keys()]
  }

  lookup(name: string): GeometryObject {
    const object = this.objects.get(name)
    if (!object) {
      throw new Error(`Unknown geometry name "${name}" — define it before using it`)
    }
    return object
  }

  lookupPoint(name: string): Vec2 {
    const object = this.lookup(name)
    if (object.kind !== 'point') throw new Error(`"${name}" — expected a point, but it is bound to a ${describeObject(object)}`)
    return object.at
  }

  lookupLine(name: string): GeometryLine {
    const object = this.lookup(name)
    if (object.kind !== 'line') throw new Error(`"${name}" — expected a line, but it is bound to a ${describeObject(object)}`)
    return object
  }

  lookupCircle(name: string): GeometryCircle {
    const object = this.lookup(name)
    if (object.kind !== 'circle') throw new Error(`"${name}" — expected a circle, but it is bound to a ${describeObject(object)}`)
    return object
  }
}
