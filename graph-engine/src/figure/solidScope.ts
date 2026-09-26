import { evalExpr, type Bindings } from '../parser/evalExpr'
import type { Construction, Expr, GeometryRef, PlaneForm, SolidPrimitive, Statement } from '../parser/types'
import { centroid, circumcenter, incenter, orthocenter } from '../scene/geometry/centres'
import { GEOM_EPS } from '../scene/geometry/types'
import type { SceneError, Vec2 } from '../scene/types'
import { authorPlane, authorToWorld } from './authorFrame'
import {
  add3,
  centroid3,
  cross3,
  divide3,
  dot3,
  footToLine3,
  footToPlane,
  length3,
  lineMeetsPlane,
  midpoint3,
  planeThrough,
  pointPlaneDistance,
  scale3,
  sub3,
  type Plane3,
} from './construct3d'
import type { Vec3 } from './project3d'
import type { SectionPlane } from './crossSection'
import { canonicalPlane, planeFromEquation, planeOfSection } from './plane'
import { basePolygonNormal, hullOf, MAX_HULL_POINTS } from './hull'
import { tetrahedronFromEdges } from './tetrahedron'
import { placementAlong } from './silhouette'
import { buildSolid, type PointSolidShape, type SolidBody, type SolidSpec } from './solids'

// Names in space: the solid-figure walk (S3).
//
// Before phase 6 a solid was built inside render.ts's main loop and its
// vertices were letters on a drawing, registered nowhere. Now a construction
// can name a solid's vertex ("M = midpoint A-G" on a named prism), so solids
// and constructions in space have to be resolved in ONE source-order walk,
// definition-before-use, exactly as 2D constructions are — and before the 2D
// construction pass runs, so that pass can be told which statements are not
// its business.
//
// Everything this walk stores is in the INTERNAL y-up frame. The author's
// z-up coordinates are converted once, where a 3-coordinate point is read
// (see authorFrame.ts); nothing after that knows the author frame exists.
//
// ---------------------------------------------------------------------------
// S2 — dimension is a property of a name
// ---------------------------------------------------------------------------
//
// One namespace serves the whole figure, because a figure can hold a solid
// AND a lifted section's 2D points. Every bound name is a point in the plane
// or a point in space:
//
//  - a space point is bound by a 3-coordinate point, by a solid's
//    `vertices`, or by a construction whose operands are space points;
//  - a plane point is bound by everything else (a 2-coordinate point, a
//    polygon vertex, a solved triangle, a 2D construction, a lifted section's
//    vertices).
//
// A construction mixing the two fails, naming one of each. A construction
// that only exists in the plane (rotate, reflect, a tangent...) given a space
// point fails, saying it is planar. And a name bound once stays bound: the
// "a bound name is an error, not a rebinding" rule holds ACROSS the two kinds.

export interface SolidFigureScope {
  solids: Map<string, SolidBody>
  // Space points in the INTERNAL frame, keyed by name.
  points: Map<string, Vec3>
  // Which statements this walk owns, so buildConstructions and render.ts skip them.
  ownedStatements: Set<number>
  // Per owned statement: the solid built, or the space point(s) bound.
  //
  // `drawn` is false for a solid's own vertices, which keep phase 5's
  // label-only look, and true for a plain or constructed space point, which
  // gets a dot and a label. An unnamed 3-coordinate point ("(1, 2, 3)") is
  // drawn with the empty name: a dot, and no label to lay out.
  byStatement: Map<number, { solid?: SolidBody; points: { name: string; at: Vec3; drawn: boolean }[] }>
  // Named planes (phase 8, Q2), in the INTERNAL frame, keyed by name. A plane
  // binds a name in the one namespace and draws nothing.
  planes: Map<string, Plane3>
  // The plane each cut: / section: statement is made by, resolved in source
  // order (so "plane p" must follow "p = plane ...") and canonicalised (Q1).
  // A plane that cannot be resolved keeps its message here, and the renderer
  // reports it where it reports the rest of the statement's errors.
  sectionPlanes: Map<number, { plane: SectionPlane } | { error: string }>
  errors: SceneError[]
}

export function isSpaceName(scope: SolidFigureScope, name: string): boolean {
  return scope.points.has(name)
}

// ---------------------------------------------------------------------------
// Solids
// ---------------------------------------------------------------------------

// The author's primitive, with its dimensions evaluated.
//
// Every dimension must be a positive number. A zero or negative one is not a
// degenerate drawing to be attempted — it is a solid that does not exist, and
// the convex hidden-edge rule would classify its faces at random.
export function solidSpecOf(primitive: DimensionPrimitive, value: (e: Expr) => number): SolidSpec {
  const positive = (e: Expr, what: string) => positiveValue(value, e, what)
  switch (primitive.kind) {
    case 'prism':
      return {
        kind: 'prism',
        width: positive(primitive.width, 'width'),
        height: positive(primitive.height, 'height'),
        depth: positive(primitive.depth, 'depth'),
      }
    case 'pyramid':
      return { kind: 'pyramid', base: positive(primitive.base, 'base'), height: positive(primitive.height, 'height') }
    case 'tetrahedron':
      return { kind: 'tetrahedron', edge: positive(primitive.edge, 'edge') }
    case 'cylinder':
      return { kind: 'cylinder', radius: positive(primitive.radius, 'radius'), height: positive(primitive.height, 'height') }
    case 'cone':
      return { kind: 'cone', radius: positive(primitive.radius, 'radius'), height: positive(primitive.height, 'height') }
    case 'sphere':
      return { kind: 'sphere', radius: positive(primitive.radius, 'radius') }
    case 'frustum':
      return frustumSpec(positive(primitive.radius, 'radius'), value(primitive.top), positive(primitive.height, 'height'))
    case 'cube':
      return { kind: 'cube', edge: positive(primitive.edge, 'edge') }
    case 'octahedron':
      return { kind: 'octahedron', edge: positive(primitive.edge, 'edge') }
    case 'regularPrism':
    case 'regularPyramid':
      return {
        kind: primitive.kind,
        sides: sideCount(value(primitive.sides)),
        side: positive(primitive.side, 'side'),
        height: positive(primitive.height, 'height'),
      }
    case 'rectanglePyramid':
      return {
        kind: 'rectanglePyramid',
        width: positive(primitive.width, 'width'),
        depth: positive(primitive.depth, 'depth'),
        height: positive(primitive.height, 'height'),
      }
    case 'regularFrustum': {
      const sides = sideCount(value(primitive.sides))
      const side = positive(primitive.side, 'side')
      const height = positive(primitive.height, 'height')
      const top = value(primitive.top)
      // P2's refusals, for the pyramidal frustum: equal ends are a prism, a
      // point for a top is a pyramid.
      if (!Number.isFinite(top) || top < 0) throw new Error(`A frustum's top must be a positive number, got ${top}`)
      if (top <= GEOM_EPS * Math.max(1, side)) {
        throw new Error(`A frustum with top 0 is a pyramid — write "pyramid regular ${sides} side ${side}, height ${height}"`)
      }
      if (Math.abs(top - side) <= GEOM_EPS * Math.max(1, side)) {
        throw new Error(`A frustum whose top equals its side is a prism — write "prism regular ${sides} side ${side}, height ${height}"`)
      }
      return { kind: 'regularFrustum', sides, side, top, height }
    }
  }
}

// A regular base's number of sides: a whole number, 3 to 24. More is a
// cylinder drawn badly — use "cylinder" — and a figure cannot letter it.
export const MAX_REGULAR_SIDES = 24

function sideCount(n: number): number {
  if (!Number.isInteger(n) || n < 3 || n > MAX_REGULAR_SIDES) {
    throw new Error(`A regular base needs a whole number of sides from 3 to ${MAX_REGULAR_SIDES}, got ${n}`)
  }
  return n
}

function positiveValue(value: (e: Expr) => number, e: Expr, what: string): number {
  const n = value(e)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`A solid's ${what} must be a positive number, got ${n}`)
  return n
}

// A primitive placed by named points (P6), built by the walk, which can look
// its points up. Every other primitive is placed by H1's convention.
type PointPrimitive = Extract<
  SolidPrimitive,
  { kind: 'hull' | 'tetrahedronOn' | 'pyramidOn' | 'prismOn' | 'sphereOn' | 'cylinderOn' | 'coneOn' | 'frustumOn' }
>
type DimensionPrimitive = Exclude<SolidPrimitive, PointPrimitive | { kind: 'tetrahedronEdges' }>

const POINT_PRIMITIVES: ReadonlySet<SolidPrimitive['kind']> = new Set([
  'hull',
  'tetrahedronOn',
  'pyramidOn',
  'prismOn',
  'sphereOn',
  'cylinderOn',
  'coneOn',
  'frustumOn',
])

function isPointPrimitive(primitive: SolidPrimitive): primitive is PointPrimitive {
  return POINT_PRIMITIVES.has(primitive.kind)
}

// The named points a point-built solid stands on, in the order written.
function pointsOf(primitive: PointPrimitive): string[] {
  switch (primitive.kind) {
    case 'hull':
    case 'tetrahedronOn':
      return primitive.points
    case 'pyramidOn':
      return [...primitive.base, primitive.apex]
    case 'prismOn':
      return primitive.base
    case 'sphereOn':
      return [primitive.center]
    case 'cylinderOn':
    case 'frustumOn':
      return [primitive.from, primitive.to]
    case 'coneOn':
      return [primitive.apex, primitive.base]
  }
}

// P2's refusals. A frustum whose rims are equal is a cylinder and one whose
// top is a point is a cone: each is refused with a pointer to the primitive
// that draws it, rather than drawn as a degenerate frustum (whose virtual
// apex would sit at infinity, or on the top rim).
//
// `instead` writes the replacement in the form the author used: the
// dimension forms by default, and the by-points forms for "frustum from O
// radius r to P radius s", which pass their own.
interface FrustumPointers {
  cone: string
  cylinder: string
}

function frustumSpec(radius: number, top: number, height: number, instead?: FrustumPointers): SolidSpec {
  const pointers = instead ?? { cone: `cone radius ${radius}, height ${height}`, cylinder: `cylinder radius ${radius}, height ${height}` }
  if (!Number.isFinite(top) || top < 0) throw new Error(`A frustum's top must be a positive number, got ${top}`)
  if (top <= GEOM_EPS * Math.max(1, radius)) throw new Error(`A frustum with top 0 is a cone — write "${pointers.cone}"`)
  if (Math.abs(top - radius) <= GEOM_EPS * Math.max(1, radius)) {
    throw new Error(`A frustum whose top equals its radius is a cylinder — write "${pointers.cylinder}"`)
  }
  return { kind: 'frustum', radius, top, height }
}

// ---------------------------------------------------------------------------
// Reading a construction
// ---------------------------------------------------------------------------

function refNames(ref: GeometryRef): string[] {
  switch (ref.kind) {
    case 'named':
      return [ref.name]
    case 'through':
      return [ref.from, ref.to]
    case 'plane':
      return planeFormNames(ref.plane)
  }
}

// Every name a plane form reads, in the order written.
function planeFormNames(form: PlaneForm): string[] {
  switch (form.kind) {
    case 'points':
      return [...form.points]
    case 'perpendicular':
      return [form.through, ...form.line]
    case 'parallel':
      return [form.through, ...planeFormNames(form.to)]
    case 'named':
      return [form.name]
    case 'equation':
    case 'axis':
      return []
  }
}

// A plane form as the author wrote it, after "plane". The three-point form is
// written back from its names, exactly as phase 6's messages wrote it.
function planeText(form: PlaneForm): string {
  return form.kind === 'points' ? form.points.join('-') : form.source
}

// Every name a construction reads, in the order it is written — which is the
// order a mixing error names them in.
function operandNames(body: Construction): string[] {
  switch (body.kind) {
    case 'parallelLine':
    case 'perpendicularLine':
      return [body.through, ...refNames(body.base)]
    case 'perpendicularBisector':
    case 'midpoint':
    case 'divide':
      return [body.from, body.to]
    case 'angleBisector':
      return [body.from, body.vertex, body.to]
    case 'foot':
      return [body.from, ...refNames(body.base)]
    case 'intersect':
      return [...refNames(body.left), ...refNames(body.right)]
    case 'reflect':
      return [body.point, ...refNames(body.over)]
    case 'rotate':
      return [body.point, body.about]
    case 'translate':
      return [body.point]
    case 'dilate':
      return [body.point, body.from]
    case 'triangleCentre':
      return [...body.vertices]
    case 'circleAt':
      return [body.center]
    case 'chord':
    case 'secant':
    case 'diameter':
      return [body.circle, body.from, body.to]
    case 'tangentAt':
    case 'tangentFrom':
    case 'radiusTo':
      return [body.circle, body.point]
  }
}

function hasPlaneRef(body: Construction): boolean {
  switch (body.kind) {
    case 'foot':
      return body.base.kind === 'plane'
    case 'intersect':
      return body.left.kind === 'plane' || body.right.kind === 'plane'
    case 'parallelLine':
    case 'perpendicularLine':
      return body.base.kind === 'plane'
    case 'reflect':
      return body.over.kind === 'plane'
    default:
      return false
  }
}

function refText(ref: GeometryRef): string {
  switch (ref.kind) {
    case 'named':
      return ref.name
    case 'through':
      return `${ref.extent === 'infinite' ? '' : `${ref.extent} `}${ref.from}-${ref.to}`
    case 'plane':
      return `plane ${planeText(ref.plane)}`
  }
}

// The construction written back out, as close to the author's line as the
// parsed form allows — so an error quotes what they wrote.
function bodyText(body: Construction): string {
  switch (body.kind) {
    case 'parallelLine':
      return `line through ${body.through} parallel to ${refText(body.base)}`
    case 'perpendicularLine':
      return `line through ${body.through} perpendicular to ${refText(body.base)}`
    case 'perpendicularBisector':
      return `perpendicular bisector of ${body.from}-${body.to}`
    case 'angleBisector':
      return `bisector of angle ${body.from}-${body.vertex}-${body.to}`
    case 'midpoint':
      return `midpoint ${body.from}-${body.to}`
    case 'foot':
      return `foot ${body.from} to ${refText(body.base)}`
    case 'intersect':
      return `intersect ${refText(body.left)}, ${refText(body.right)}`
    case 'divide':
      return `divide ${body.from}-${body.to}`
    case 'reflect':
      return `reflect ${body.point} over ${refText(body.over)}`
    case 'rotate':
      return `rotate ${body.point} about ${body.about}`
    case 'translate':
      return `translate ${body.point}`
    case 'dilate':
      return `dilate ${body.point} from ${body.from}`
    case 'triangleCentre':
      return `${body.centre} ${body.vertices.join('')}`
    case 'circleAt':
      return `circle ${body.center}`
    case 'chord':
    case 'secant':
    case 'diameter':
      return `${body.kind} ${body.from}-${body.to} on ${body.circle}`
    case 'tangentAt':
      return `tangent at ${body.point} on ${body.circle}`
    case 'tangentFrom':
      return `tangent from ${body.point} to ${body.circle}`
    case 'radiusTo':
      return `radius ${body.circle} to ${body.point}`
  }
}

function statementText(names: string[], body: Construction): string {
  return names.length > 0 ? `${names.join(', ')} = ${bodyText(body)}` : bodyText(body)
}

// The word an author knows a planar construction by, for the refusal.
const PLANAR_WORD: Partial<Record<Construction['kind'], string>> = {
  parallelLine: 'a parallel line',
  perpendicularLine: 'a perpendicular line',
  perpendicularBisector: 'a perpendicular bisector',
  angleBisector: 'an angle bisector',
  reflect: 'reflect',
  rotate: 'rotate',
  translate: 'translate',
  dilate: 'dilate',
  circleAt: 'a circle',
  chord: 'a chord',
  secant: 'a secant',
  diameter: 'a diameter',
  tangentAt: 'a tangent',
  tangentFrom: 'a tangent',
  radiusTo: 'a radius',
}

function alreadyBound(name: string, what: string): Error {
  return new Error(`"${name}" is already bound to ${what} — pick a different name rather than redefining it`)
}

// What a name bound in the plane is: the 2D namespace holds lines and
// circles as well as points, and a message that called a line "a point"
// would send the author looking for the wrong thing.
type PlaneKind = 'point' | 'line' | 'circle'

const LINE_CONSTRUCTIONS: ReadonlySet<Construction['kind']> = new Set([
  'parallelLine',
  'perpendicularLine',
  'perpendicularBisector',
  'angleBisector',
  'chord',
  'tangentAt',
  'tangentFrom',
  'secant',
  'radiusTo',
  'diameter',
])

function planeKindOf(body: Construction): PlaneKind {
  if (LINE_CONSTRUCTIONS.has(body.kind)) return 'line'
  if (body.kind === 'circleAt') return 'circle'
  if (body.kind === 'triangleCentre' && (body.centre === 'incircle' || body.centre === 'circumcircle')) return 'circle'
  return 'point'
}

// ---------------------------------------------------------------------------
// Triangle centres in space — the 2D formulas, reused
// ---------------------------------------------------------------------------

// A triangle in space, laid into its own plane with an orthonormal frame, so
// scene/geometry/centres.ts answers and the answer is lifted back. The centre
// formulas are NOT written a second time.
//
// The frame is fixed so the result is deterministic: the first axis runs
// along A->B, the second lies in the ABC plane toward C (n x e1, with
// n = AB x AC, is AC's component perpendicular to AB).
function centreInSpace(
  kind: 'centroid' | 'circumcenter' | 'incenter' | 'orthocenter',
  a: Vec3,
  b: Vec3,
  c: Vec3,
  label: string
): Vec3 {
  // Collinear points are refused here, in the author's names, before the 2D
  // layer can refuse them in coordinates of a frame the author never saw.
  const plane = planeThrough(a, b, c, label)
  const ab = sub3(b, a)
  const e1 = scale3(ab, 1 / length3(ab))
  const e2 = cross3(plane.normal, e1)
  const flat = (p: Vec3): Vec2 => {
    const d = sub3(p, a)
    return { x: dot3(d, e1), y: dot3(d, e2) }
  }
  const [fa, fb, fc] = [flat(a), flat(b), flat(c)]
  const centre = { centroid, circumcenter, incenter, orthocenter }[kind](fa, fb, fc)
  return add3(a, add3(scale3(e1, centre.x), scale3(e2, centre.y)))
}

// The refusal of a literal point that a statement EARLIER in the spec
// already bound the name of.
function laterPointRefused(name: string, what: string): Error {
  return new Error(`"${name}" is already bound to ${what} on an earlier line — the later point "${name}" cannot rebind it`)
}

// What an author calls a point-built solid, for a message.
function pointShapeWord(primitive: PointPrimitive): string {
  return primitive.kind === 'hull' ? 'hull' : primitive.kind.slice(0, -'On'.length)
}

// Whether a height is negligible next to the points it was measured among —
// GEOM_EPS is relative (see construct3d.ts's `negligible`) — measured against
// their spread about their own centroid, not their distance from the origin
// (a small solid far from the origin is not flat).
function flatAgainst(height: number, among: Vec3[]): boolean {
  const centre = centroid3(among)
  let size = 1
  for (const p of among) size = Math.max(size, length3(sub3(p, centre)))
  return height <= GEOM_EPS * size
}

// A round solid's axis between two named points, refusing two points that
// coincide: such a solid has no axis, so no direction to stand in.
function axisBetween(from: Vec3, to: Vec3, what: string, first: string, second: string): Vec3 {
  const axis = sub3(to, from)
  if (flatAgainst(length3(axis), [from, to])) throw new Error(`${capitalised(what)} has no axis: ${first} and ${second} are the same point`)
  return axis
}

function capitalised(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1)
}

function nameList(names: readonly string[]): string {
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

// `evaluateAt` reads an expression with variables bound — the equation form of
// a plane (Q2) is the one place the walk needs it.
export function buildSolidFigure(
  statements: Statement[],
  value: (e: Expr) => number,
  evaluateAt: (e: Expr, vars: Bindings) => number = (e, vars) => evalExpr(e, vars)
): SolidFigureScope {
  const solids = new Map<string, SolidBody>()
  const points = new Map<string, Vec3>()
  const planes = new Map<string, Plane3>()
  const sectionPlanes: SolidFigureScope['sectionPlanes'] = new Map()
  const ownedStatements = new Set<number>()
  const byStatement: SolidFigureScope['byStatement'] = new Map()
  const errors: SceneError[] = []
  // Names bound in the plane, and what each is. Tracked only so the walk can
  // tell a mixed construction from an unknown name; the 2D pass owns their
  // values.
  const planeNames = new Map<string, PlaneKind>()
  // What each space name is bound to, for a message that refuses a rebinding.
  const spaceWhat = new Map<string, string>()
  // The literal points, by the statement that wrote them. Literals are bound
  // before the walk (order-independent, as in 2D), so a literal can be bound
  // before an EARLIER statement claims its name; these say where it really
  // sits in the source, so the later line is the one refused.
  const spaceLiteral = new Map<string, number>()
  const planeLiteral = new Map<string, number>()

  const fail = (err: unknown) => errors.push({ line: 0, message: err instanceof Error ? err.message : String(err) })

  const describePlane = (name: string) => `a ${planeNames.get(name) ?? 'point'} in the plane`

  // A binding at `index` wants `name`. It may take it when the name is free,
  // or when the name is held only by a LITERAL written LATER in the spec:
  // source order decides, so the literal is the statement refused. Anything
  // else throws, against this statement.
  const checkClaim = (name: string, index: number): void => {
    if (planes.has(name)) throw alreadyBound(name, 'a plane')
    if (points.has(name)) {
      const at = spaceLiteral.get(name)
      if (at === undefined || at < index) throw alreadyBound(name, spaceWhat.get(name) ?? 'a point in space')
    }
    if (planeNames.has(name)) {
      const at = planeLiteral.get(name)
      if (at === undefined || at < index) throw alreadyBound(name, describePlane(name))
    }
  }

  // Takes a name checkClaim allowed, refusing the later literal that held it.
  const takeName = (name: string, what: string): void => {
    const laterSpace = spaceLiteral.get(name)
    if (laterSpace !== undefined && points.has(name)) {
      points.delete(name)
      spaceLiteral.delete(name)
      // Still owned, so neither the 2D pass nor the renderer takes it up;
      // with no entry, nothing is drawn for it.
      byStatement.delete(laterSpace)
      fail(laterPointRefused(name, what))
    }
    const laterPlane = planeLiteral.get(name)
    if (laterPlane !== undefined && planeNames.has(name)) {
      planeNames.delete(name)
      planeLiteral.delete(name)
      ownedStatements.add(laterPlane)
      fail(laterPointRefused(name, what))
    }
  }

  const bindSpace = (name: string, at: Vec3, what: string): void => {
    takeName(name, what)
    points.set(name, at)
    spaceWhat.set(name, what)
  }

  const lookup = (name: string): Vec3 => {
    const p = points.get(name)
    if (p) return p
    if (planes.has(name)) throw planeAsPoint(name)
    if (planeNames.has(name)) throw new Error(`"${name}" is ${describePlane(name)}, and this construction needs points in space`)
    throw new Error(
      `Unknown point "${name}" — define it before this line (e.g. "${name} = (x, y, z)", or name it among a solid's vertices)`
    )
  }

  const planeOf = (ref: Extract<GeometryRef, { kind: 'plane' }>): Plane3 => resolvePlane(ref.plane)

  // Q2 — every plane form, as a point and a unit normal in the internal
  // frame. The three-point form is phase 6's `planeThrough`, unchanged, so
  // every foot and intersection it already drew keeps its value.
  function resolvePlane(form: PlaneForm): Plane3 {
    switch (form.kind) {
      case 'points':
        return planeThrough(lookup(form.points[0]), lookup(form.points[1]), lookup(form.points[2]), nameList(form.points))
      case 'perpendicular': {
        const through = lookup(form.through)
        const [a, b] = form.line.map(lookup)
        const along = sub3(b, a)
        if (flatAgainst(length3(along), [a, b])) {
          const [first, second] = form.line
          throw new Error(
            `plane ${form.source}: ${first} and ${second} are the same point, so ${first}-${second} has no direction to be perpendicular to`
          )
        }
        return { point: through, normal: scale3(along, 1 / length3(along)) }
      }
      case 'parallel': {
        const through = lookup(form.through)
        return { point: through, normal: resolvePlane(form.to).normal }
      }
      case 'equation':
        return planeFromEquation(form.left, form.right, evaluateAt, form.source)
      case 'axis':
        return planeOfSection(authorPlane(form.axis, value(form.at)))
      case 'named': {
        const plane = planes.get(form.name)
        if (plane) return plane
        if (points.has(form.name)) {
          throw new Error(`"${form.name}" is a point in space, not a plane — write "plane A-B-C" through three points, or name a plane first`)
        }
        if (planeNames.has(form.name)) throw new Error(`"${form.name}" is ${describePlane(form.name)}, not a plane`)
        if (solids.has(form.name)) throw new Error(`"${form.name}" is a solid, not a plane`)
        throw new Error(`Unknown plane "${form.name}" — define it before this line (e.g. "${form.name} = plane A-B-C")`)
      }
    }
  }

  // Q1 — the plane a cut or a section is made by. "plane z = 1" keeps its
  // phase-5 object exactly (no source: its messages print "z = 1" as they
  // always did); every other form is canonicalised, which turns an
  // axis-parallel plane into that same object.
  function sectionPlaneOf(form: PlaneForm): SectionPlane {
    if (form.kind === 'axis') return authorPlane(form.axis, value(form.at))
    return canonicalPlane(resolvePlane(form), planeText(form))
  }

  // Plain points are literals with no dependencies, so — exactly as in 2D —
  // they are order-independent: a construction may name one defined below it.
  // Plane literals first, so a space literal reusing a plane name is caught.
  statements.forEach((statement, index) => {
    if (statement.kind === 'point' && statement.label && statement.z === null) {
      planeNames.set(statement.label, 'point')
      if (!planeLiteral.has(statement.label)) planeLiteral.set(statement.label, index)
    } else if (statement.kind === 'polygon') for (const v of statement.vertices) planeNames.set(v.label, 'point')
  })
  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index]
    if (statement.kind !== 'point' || statement.z === null) continue
    ownedStatements.add(index)
    try {
      const name = statement.label ?? ''
      if (name) checkClaim(name, index)
      // S1 — the one place an author's coordinates enter the solid figure.
      const at = authorToWorld({ x: value(statement.x), y: value(statement.y), z: value(statement.z) })
      if (name) {
        bindSpace(name, at, 'a point in space')
        spaceLiteral.set(name, index)
      }
      byStatement.set(index, { points: [{ name, at, drawn: true }] })
    } catch (err) {
      fail(err)
    }
  }

  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index]
    try {
      switch (statement.kind) {
        case 'solid': {
          ownedStatements.add(index)
          const primitive = statement.primitive
          if (primitive.kind === 'tetrahedronEdges') {
            edgeTetrahedron(index, statement.name, primitive, statement.vertices)
            break
          }
          const body = isPointPrimitive(primitive) ? buildOnPoints(primitive, statement.vertices) : buildSolid(solidSpecOf(primitive, value))
          if (statement.name) solids.set(statement.name, body)
          const entry: { solid: SolidBody; points: { name: string; at: Vec3; drawn: boolean }[] } = { solid: body, points: [] }
          byStatement.set(index, entry)
          if (statement.vertices.length === 0) break
          // The solid stands whatever is wrong with its lettering: an error
          // in the vertex list costs the letters, not the drawing.
          let order = body.labelOrder
          if (isPointPrimitive(primitive)) {
            const title = statement.name ? `"${statement.name}"` : `This ${pointShapeWord(primitive)}`
            const on = pointsOf(primitive)
            // P6 — a solid on named points has its vertices named already,
            // except a prism's new top, which the vertices clause names.
            if (primitive.kind !== 'prismOn') {
              throw new Error(
                body.polyhedron
                  ? `${title} is built on the named points ${on.join('-')}, which already name its vertices — drop "vertices ${statement.vertices.join('')}"`
                  : `${title} is placed by the named point${on.length === 1 ? '' : 's'} ${on.join('-')} and has no vertices to name — drop "vertices ${statement.vertices.join('')}"`
              )
            }
            const n = primitive.base.length
            if (statement.vertices.length !== n) {
              throw new Error(
                `The prism on ${on.join('-')} has a top of ${n} vertices, but ${statement.vertices.length} names were given ("${statement.vertices.join('')}")`
              )
            }
            // The hull keeps the input order: the base, then the top, each
            // top corner over its base corner.
            order = primitive.base.map((_, i) => n + i)
          }
          const polyhedron = body.polyhedron
          if (!polyhedron || statement.vertices.length !== order.length) {
            throw new Error(
              `A ${body.spec.kind} has ${body.labelOrder.length} vertices, but ${statement.vertices.length} names were given ("${statement.vertices.join('')}")`
            )
          }
          // Every letter is checked before any is taken, so a refused list
          // takes nothing — not even the letters that were free.
          for (const name of statement.vertices) checkClaim(name, index)
          // S4 — a solid's named vertices are real points.
          const what = statement.name ? `a vertex of solid "${statement.name}"` : `a vertex of a ${body.spec.kind}`
          statement.vertices.forEach((name, v) => {
            const at = polyhedron.vertices[order[v]]
            bindSpace(name, at, what)
            entry.points.push({ name, at, drawn: false })
          })
          break
        }
        case 'construction':
          walkConstruction(index, statement.names, statement.body)
          break
        case 'triangle':
          // Only a clash with a point in SPACE is this walk's to judge; the 2D
          // pass judges clashes in the plane, exactly as before phase 6.
          for (const name of statement.names) {
            if (!points.has(name)) continue
            const at = spaceLiteral.get(name)
            if (at === undefined || at < index) throw alreadyBound(name, spaceWhat.get(name) ?? 'a point in space')
          }
          for (const name of statement.names) {
            if (points.has(name)) takeName(name, 'a vertex of a solved triangle')
            planeNames.set(name, 'point')
          }
          break
        case 'crossSection':
          try {
            sectionPlanes.set(index, { plane: sectionPlaneOf(statement.plane) })
          } catch (err) {
            sectionPlanes.set(index, { error: err instanceof Error ? err.message : String(err) })
          }
          if (statement.lift) for (const name of statement.vertices) planeNames.set(name, 'point')
          break
        case 'planeDef': {
          // Q2 — a named plane binds and does not draw. Its name is unique
          // across points, lines, circles and planes (S2's rule, extended).
          ownedStatements.add(index)
          checkClaim(statement.name, index)
          const plane = resolvePlane(statement.plane)
          takeName(statement.name, 'a plane')
          planes.set(statement.name, plane)
          break
        }
        default:
          break
      }
    } catch (err) {
      fail(err)
    }
  }

  // A solid on named points (P6): its points must already be points in
  // space, defined on an earlier line or as literals. A polyhedron checks
  // the degeneracy particular to its shape, in words about that shape, and
  // is then built by the one hull builder (P3); a round solid is placed by
  // its points (P1). `top` is a prism's vertices clause, used only to name
  // the new top in a message.
  function buildOnPoints(primitive: PointPrimitive, top: string[]): SolidBody {
    switch (primitive.kind) {
      case 'hull':
        return pointPolyhedron('hull', primitive.points.map(lookup), primitive.points)
      case 'tetrahedronOn': {
        const names = primitive.points
        const [a, b, c, d] = names.map(lookup)
        const base = planeThrough(a, b, c, nameList(names.slice(0, 3)))
        if (flatAgainst(pointPlaneDistance(d, base), [a, b, c, d])) {
          throw new Error(`${names[3]} lies in the plane ${names.slice(0, 3).join('-')}, so the tetrahedron ${names.join('-')} is flat — it has no volume`)
        }
        return pointPolyhedron('tetrahedron', [a, b, c, d], names)
      }
      case 'pyramidOn': {
        const base = primitive.base.map(lookup)
        const normal = basePolygonNormal(base, primitive.base)
        const apex = lookup(primitive.apex)
        if (flatAgainst(Math.abs(dot3(sub3(apex, base[0]), normal)), [...base, apex])) {
          throw new Error(`${primitive.apex} lies in the plane of the base ${primitive.base.join('-')}, so the pyramid has no height`)
        }
        return pointPolyhedron('pyramid', [...base, apex], [...primitive.base, primitive.apex], base.length)
      }
      case 'prismOn': {
        const base = primitive.base.map(lookup)
        const normal = basePolygonNormal(base, primitive.base)
        const height = value(primitive.height)
        const list = primitive.base.join('-')
        if (Number.isFinite(height) && height === 0) throw new Error(`A prism of height 0 on ${list} is flat — it has no volume`)
        if (!Number.isFinite(height) || height < 0) {
          throw new Error(
            `A prism's height must be a positive number, got ${height} — it rises along (B - A) x (C - A); ` +
              `reverse the base (${[...primitive.base].reverse().join('-')}) to extrude the other way`
          )
        }
        // Along the base's RIGHT-HAND normal, so the base reads
        // counter-clockwise seen from the new top.
        const lid = base.map((p) => add3(p, scale3(normal, height)))
        const lidNames = top.length === base.length ? top : primitive.base.map((name) => `${name}'`)
        return pointPolyhedron('prism', [...base, ...lid], [...primitive.base, ...lidNames], base.length)
      }
      case 'sphereOn':
        return placed({ kind: 'sphere', radius: positiveValue(value, primitive.radius, 'radius') }, lookup(primitive.center), { x: 0, y: 1, z: 0 })
      case 'cylinderOn': {
        const from = lookup(primitive.from)
        const to = lookup(primitive.to)
        const axis = axisBetween(from, to, `the cylinder from ${primitive.from} to ${primitive.to}`, primitive.from, primitive.to)
        const radius = positiveValue(value, primitive.radius, 'radius')
        return placed({ kind: 'cylinder', radius, height: length3(axis) }, midpoint3(from, to), axis)
      }
      case 'coneOn': {
        const apex = lookup(primitive.apex)
        const base = lookup(primitive.base)
        const axis = axisBetween(base, apex, `the cone with apex ${primitive.apex} and base ${primitive.base}`, primitive.apex, primitive.base)
        const radius = positiveValue(value, primitive.radius, 'radius')
        return placed({ kind: 'cone', radius, height: length3(axis) }, midpoint3(base, apex), axis)
      }
      case 'frustumOn': {
        const from = lookup(primitive.from)
        const to = lookup(primitive.to)
        const axis = axisBetween(from, to, `the frustum from ${primitive.from} to ${primitive.to}`, primitive.from, primitive.to)
        // A rim of radius 0 at either end is a cone with its apex there, and
        // is refused pointing at the by-points cone (P2's refusals, in the
        // form the author used). The `from` end first; the `to` end below.
        const fromRadius = value(primitive.fromRadius)
        if (Number.isFinite(fromRadius) && fromRadius === 0) {
          const other = value(primitive.toRadius)
          throw new Error(`A frustum with radius 0 at ${primitive.from} is a cone — write "cone apex ${primitive.from} base ${primitive.to} radius ${other}"`)
        }
        const radius = positiveValue(value, primitive.fromRadius, 'radius')
        // The rim at `to` is the frustum's "top"; buildSolid reverses the
        // axis when it is the wider one (P2).
        // P2's refusals, pointing at the by-points forms: a point for the
        // top rim makes the cone with its apex there; equal rims, the
        // cylinder between the same two centres.
        const pointers = {
          cone: `cone apex ${primitive.to} base ${primitive.from} radius ${radius}`,
          cylinder: `cylinder from ${primitive.from} to ${primitive.to} radius ${radius}`,
        }
        return placed(frustumSpec(radius, value(primitive.toRadius), length3(axis), pointers), midpoint3(from, to), axis)
      }
    }
  }

  // P4 — the tetrahedron from its six edges. Its four letters are NEW space
  // points, bound here like a solid's named vertices (lettered, not dotted),
  // and every one is checked before any is taken.
  function edgeTetrahedron(
    index: number,
    name: string | null,
    primitive: Extract<SolidPrimitive, { kind: 'tetrahedronEdges' }>,
    vertices: string[]
  ): void {
    const [a, b, c, d] = primitive.vertices
    // The parser has checked each unordered pair appears exactly once.
    const length = (from: string, to: string): number => {
      const edge = primitive.edges.find((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from))
      if (!edge) throw new Error(`The edge ${from}${to} is missing`)
      return positiveValue(value, edge.length, `edge ${from}${to}`)
    }
    const at = tetrahedronFromEdges(
      { AB: length(a, b), AC: length(a, c), AD: length(a, d), BC: length(b, c), BD: length(b, d), CD: length(c, d) },
      primitive.vertices
    )
    const body = pointPolyhedron('tetrahedron', at, primitive.vertices)
    if (name) solids.set(name, body)
    const entry: { solid: SolidBody; points: { name: string; at: Vec3; drawn: boolean }[] } = { solid: body, points: [] }
    byStatement.set(index, entry)
    if (vertices.length > 0) {
      throw new Error(
        `${name ? `"${name}"` : 'This tetrahedron'} names its vertices ${primitive.vertices.join('')} already — drop "vertices ${vertices.join('')}"`
      )
    }
    for (const letter of primitive.vertices) checkClaim(letter, index)
    const what = name ? `a vertex of solid "${name}"` : 'a vertex of a tetrahedron'
    primitive.vertices.forEach((letter, i) => {
      bindSpace(letter, at[i], what)
      entry.points.push({ name: letter, at: at[i], drawn: false })
    })
  }

  // The hull's point cap, checked here first so a solid on points is refused
  // in the words of the form the author wrote, not as "a hull of N points".
  function pointPolyhedron(shape: PointSolidShape, at: Vec3[], names: string[], baseCorners = 0): SolidBody {
    if (shape !== 'hull' && at.length > MAX_HULL_POINTS) {
      throw new Error(`A ${shape} on a ${baseCorners}-corner base has ${at.length} vertices — at most ${MAX_HULL_POINTS}`)
    }
    return buildSolid({ kind: 'hull', shape, polyhedron: hullOf(at, names) })
  }

  function placed(spec: SolidSpec, origin: Vec3, axis: Vec3): SolidBody {
    return { ...buildSolid(spec, placementAlong(origin, axis)), byPoints: true }
  }

  function walkConstruction(index: number, names: string[], body: Construction): void {
    const operands = operandNames(body)
    const space = operands.filter((name) => points.has(name))
    // A named plane is not a point or a line: it may be bound only once, and
    // read only as a plane operand, "plane p".
    const rebound = names.find((name) => planes.has(name))
    if (rebound !== undefined) {
      ownedStatements.add(index)
      throw alreadyBound(rebound, 'a plane')
    }
    const misused = operands.find((name) => planes.has(name) && !namesPlane(body, name))
    if (misused !== undefined) {
      ownedStatements.add(index)
      throw planeAsPoint(misused)
    }

    if (space.length === 0 && !hasPlaneRef(body)) {
      // A construction in the plane: the 2D pass's, unless it would rebind a
      // space point, which is refused here because the 2D pass cannot see it.
      // A later space LITERAL of the same name is the one refused (source
      // order decides); any other clash refuses this construction.
      for (const name of names) {
        if (!points.has(name)) continue
        const at = spaceLiteral.get(name)
        if (at === undefined || at < index) {
          ownedStatements.add(index)
          throw alreadyBound(name, spaceWhat.get(name) ?? 'a point in space')
        }
      }
      const kind = planeKindOf(body)
      for (const name of names) {
        if (points.has(name)) takeName(name, `a ${kind} in the plane`)
        planeNames.set(name, kind)
      }
      return
    }

    ownedStatements.add(index)
    const plane = operands.find((name) => planeNames.has(name))
    if (plane && space.length > 0) {
      throw new Error(`${statementText(names, body)} mixes a point in space (${space[0]}) with ${describePlane(plane)} (${plane})`)
    }
    const planar = PLANAR_WORD[body.kind]
    if (planar && space.length > 0) {
      throw new Error(
        `${statementText(names, body)} is a planar construction — ${planar} works only with points in the plane, and ${space[0]} is a point in space`
      )
    }

    const results = evaluate(names, body)
    if (names.length !== results.length) {
      throw new Error(
        `${names.length === 1 ? '1 name' : `${names.length} names`} (${names.join(', ')}) cannot be bound to a ${body.kind} ` +
          `construction that produced ${results.length === 1 ? '1 solution' : `${results.length} solutions`}`
      )
    }
    for (const name of names) checkClaim(name, index)
    const bound = names.map((name, i) => ({ name, at: results[i], drawn: true }))
    for (const p of bound) bindSpace(p.name, p.at, 'a point in space')
    byStatement.set(index, { points: bound })
  }

  // The constructions that have a meaning in space, each closed form.
  function evaluate(names: string[], body: Construction): Vec3[] {
    switch (body.kind) {
      case 'midpoint':
        return [midpoint3(lookup(body.from), lookup(body.to))]
      case 'divide':
        return [divide3(lookup(body.from), lookup(body.to), value(body.ratioFrom), value(body.ratioTo))]
      case 'foot': {
        const from = lookup(body.from)
        if (body.base.kind === 'plane') return [footToPlane(from, planeOf(body.base))]
        if (body.base.kind === 'through') {
          return [footToLine3(from, lookup(body.base.from), lookup(body.base.to), `line ${body.base.from}-${body.base.to}`)]
        }
        throw new Error(
          `${statementText(names, body)}: in a solid figure a foot drops to "line A-B" or "plane A-B-C", and "${body.base.name}" names neither`
        )
      }
      case 'intersect': {
        const [line, plane] =
          body.left.kind === 'plane' ? [body.right, body.left] : body.right.kind === 'plane' ? [body.left, body.right] : [null, null]
        if (!line || !plane || line.kind !== 'through' || plane.kind !== 'plane') {
          throw new Error(
            `${statementText(names, body)}: in a solid figure, intersect takes a line and a plane (e.g. "intersect line A-G, plane B-D-E")`
          )
        }
        return [lineMeetsPlane(lookup(line.from), lookup(line.to), planeOf(plane), `line ${line.from}-${line.to}`, `plane ${planeText(plane.plane)}`)]
      }
      case 'triangleCentre': {
        const vertices = body.vertices.map(lookup)
        if (body.centre === 'incircle' || body.centre === 'circumcircle') {
          throw new Error(
            `${statementText(names, body)}: circles in space are not drawn yet — "${body.centre === 'incircle' ? 'incenter' : 'circumcenter'} ${body.vertices.join('')}" gives the centre`
          )
        }
        if (vertices.length === 4) return [centroid3(vertices)]
        const [a, b, c] = vertices
        return [centreInSpace(body.centre, a, b, c, nameList(body.vertices))]
      }
      default:
        // Unreachable for a planar construction (refused above); what is
        // left is a line construction on a plane operand.
        throw new Error(`${statementText(names, body)} has no meaning in a solid figure`)
    }
  }

  return { solids, points, ownedStatements, byStatement, planes, sectionPlanes, errors }
}

function planeAsPoint(name: string): Error {
  return new Error(`"${name}" is a plane, not a point — a plane is an operand ("plane ${name}") of foot and intersect`)
}

// Whether a construction reads `name` as a named PLANE — "plane p", or
// "plane through P parallel to p" — which is where a plane's name belongs.
function namesPlane(body: Construction, name: string): boolean {
  const refs: GeometryRef[] =
    body.kind === 'foot' || body.kind === 'parallelLine' || body.kind === 'perpendicularLine'
      ? [body.base]
      : body.kind === 'intersect'
        ? [body.left, body.right]
        : body.kind === 'reflect'
          ? [body.over]
          : []
  return refs.some((ref) => ref.kind === 'plane' && namedIn(ref.plane, name))
}

function namedIn(form: PlaneForm, name: string): boolean {
  if (form.kind === 'named') return form.name === name
  if (form.kind === 'parallel') return namedIn(form.to, name)
  return false
}
