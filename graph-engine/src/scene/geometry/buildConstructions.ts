import type { GraphConfig } from '../../parser/config'
import { evalExpr, type FunctionTable } from '../../parser/evalExpr'
import type { Construction, Expr, GeometryRef, PlaneForm, Statement, TriangleSlot } from '../../parser/types'
import type { SceneError, SceneObject, Vec2 } from '../types'
import { centroid, circumcenter, circumcircle, incenter, incircle, orthocenter } from './centres'
import { chord, diameter, radiusTo, secantThrough, tangentAt, tangentsFrom } from './circles'
import { dilate, divide, foot, midpoint, reflect, rotate, translate } from './derive'
import { intersect } from './intersect'
import { angleBisector, parallelThrough, perpendicularBisector, perpendicularThrough } from './lines'
import {
  circle,
  type GeometryCircle,
  type GeometryLine,
  type GeometryObject,
  GeometryScope,
  isGeometryName,
  makeLine,
  point,
} from './objects'
import { geometryObjectToScene, polygonObjects } from './sceneObjects'
import { solveTriangle, type TriangleSpec } from './solveTriangle'

// The construction pass: resolves every geometry statement in the spec into
// bound objects and drawable scene output, before the main statement loop
// runs.
//
// **Constructions are definition-before-use, in source order.** This is a
// decision, not an accident. Function and constant definitions are collected
// order-independently because they are values — but constructions form a
// dependency chain, and reading them in source order makes a cycle
// *unrepresentable* rather than something to detect after the fact: a
// construction that refers to a name defined below it fails with "unknown
// geometry name", which names the actual problem, instead of hanging or
// needing a topological sort with its own cycle report.
//
// Plain "A = (x, y)" points and polygon vertices stay order-independent, as
// they already were — they are literals with no dependencies, and that
// behaviour is existing and untouchable.

export interface ConstructionBuild {
  // Scene objects keyed by the index of the statement that produced them, so
  // the main loop can emit them in source order and honour "@hide".
  objectsByStatement: Map<number, SceneObject[]>
  errors: SceneError[]
  // Points the constructions produced, merged into the scene's named-point
  // table so angle:/tick:/right-angle: can reference a constructed point the
  // same way they reference a polygon vertex.
  points: Map<string, Vec2>
  // The *geometry values* each construction statement produced, keyed the
  // same way as objectsByStatement.
  //
  // Additive, and it exists for the SVG figure renderer. `objectsByStatement`
  // above is already renderer-facing — a circle in it has become a 96-point
  // sampled curve, which is the right shape for three.js and the wrong one
  // for SVG, where a circle is a `<circle>`. Handing the renderer-agnostic
  // value alongside the three.js-shaped one lets the second renderer consume
  // the construction layer without either rewriting Phase 1's maths or
  // reverse-engineering a centre and radius out of a polyline.
  geometryByStatement: Map<number, { name: string | null; object: GeometryObject }[]>
  // Every circle the spec bound a name to, so a statement that is *about* a
  // circle rather than derived from one — an arc, a sector, a central angle,
  // "label: arc PQ on O" — can find it. Points already travel this way, in
  // `points` above; a circle could not, which is why the circle vocabulary
  // needed it.
  circles: Map<string, GeometryCircle>
}

const SLOTS: TriangleSlot[] = ['a', 'b', 'c']

function resolveObject(scope: GeometryScope, ref: GeometryRef): GeometryObject {
  if (ref.kind === 'named') return scope.lookup(ref.name)
  if (ref.kind === 'plane') throw planeInThePlane(ref.plane)
  return makeLine(scope.lookupPoint(ref.from), scope.lookupPoint(ref.to), ref.extent)
}

// A plane — in any of its forms (phase 8) — is an object of a solid figure.
// Reaching this pass means the construction is in the plane: the solid-figure
// walk claims every construction that names a point in space. So the message
// says where planes live, and for a plane through points, what its points
// would have to be.
function planeInThePlane(plane: PlaneForm): Error {
  const what = `"plane ${plane.source}" is a plane, and planes exist only in solid figures`
  return new Error(
    plane.kind === 'points'
      ? `${what} — it needs three points in space (e.g. "A = (0, 0, 0)" or a solid's vertices), and these are points in the plane`
      : `${what} — this construction is in the plane; write it among points in space, in a figure ("@mode: figure")`
  )
}

function resolveLine(scope: GeometryScope, ref: GeometryRef, role: string): GeometryLine {
  const object = resolveObject(scope, ref)
  if (object.kind !== 'line') {
    const name = ref.kind === 'named' ? `"${ref.name}"` : 'that operand'
    throw new Error(`The ${role} must be a line, but ${name} is a ${object.kind}`)
  }
  return object
}

function refLabel(ref: GeometryRef): string {
  if (ref.kind === 'named') return ref.name
  if (ref.kind === 'plane') return `plane ${ref.plane.source}`
  return `${ref.from}-${ref.to}`
}

function triangleVertices(scope: GeometryScope, names: readonly string[], centre: string): [Vec2, Vec2, Vec2] {
  // Four names reach here only as "centroid ABCD", which is a tetrahedron's:
  // four points in the plane have a centroid, but not one this grammar means.
  if (names.length !== 3) {
    throw new Error(`A ${centre} of four points (${names.join('')}) is a tetrahedron's, and needs points in space`)
  }
  return [scope.lookupPoint(names[0]), scope.lookupPoint(names[1]), scope.lookupPoint(names[2])]
}

// Evaluates one construction to the geometry value(s) it produces. Returns an
// array because `intersect` can yield two points; everything else yields one.
function evaluate(scope: GeometryScope, body: Construction, evaluateExpr: (e: Expr) => number, angleMode: GraphConfig['angle']): GeometryObject[] {
  switch (body.kind) {
    case 'parallelLine':
      return [parallelThrough(scope.lookupPoint(body.through), resolveLine(scope, body.base, 'base of a parallel line'))]
    case 'perpendicularLine':
      return [perpendicularThrough(scope.lookupPoint(body.through), resolveLine(scope, body.base, 'base of a perpendicular line'))]
    case 'perpendicularBisector':
      return [perpendicularBisector(scope.lookupPoint(body.from), scope.lookupPoint(body.to))]
    case 'angleBisector':
      return [angleBisector(scope.lookupPoint(body.from), scope.lookupPoint(body.vertex), scope.lookupPoint(body.to))]
    case 'midpoint':
      return [point(midpoint(scope.lookupPoint(body.from), scope.lookupPoint(body.to)))]
    case 'foot':
      return [point(foot(scope.lookupPoint(body.from), resolveLine(scope, body.base, 'line a foot drops to')))]
    case 'intersect': {
      const left = resolveObject(scope, body.left)
      const right = resolveObject(scope, body.right)
      return intersect(left, right, refLabel(body.left), refLabel(body.right)).map(point)
    }
    case 'divide':
      return [point(divide(scope.lookupPoint(body.from), scope.lookupPoint(body.to), evaluateExpr(body.ratioFrom), evaluateExpr(body.ratioTo)))]
    case 'reflect':
      return [point(reflect(scope.lookupPoint(body.point), resolveLine(scope, body.over, 'mirror line')))]
    case 'rotate':
      return [point(rotate(scope.lookupPoint(body.point), scope.lookupPoint(body.about), evaluateExpr(body.angle), angleMode))]
    case 'translate':
      return [point(translate(scope.lookupPoint(body.point), { x: evaluateExpr(body.dx), y: evaluateExpr(body.dy) }))]
    case 'dilate':
      return [point(dilate(scope.lookupPoint(body.point), scope.lookupPoint(body.from), evaluateExpr(body.factor)))]
    case 'circleAt':
      return [circle(scope.lookupPoint(body.center), evaluateExpr(body.radius))]
    case 'chord':
      return [
        chord(scope.lookupCircle(body.circle), scope.lookupPoint(body.from), scope.lookupPoint(body.to), {
          circle: body.circle,
          from: body.from,
          to: body.to,
        }),
      ]
    case 'tangentAt':
      return [tangentAt(scope.lookupCircle(body.circle), scope.lookupPoint(body.point), { circle: body.circle, point: body.point })]
    case 'tangentFrom':
      return tangentsFrom(scope.lookupCircle(body.circle), scope.lookupPoint(body.point), { circle: body.circle, point: body.point })
    case 'secant':
      return [
        secantThrough(scope.lookupCircle(body.circle), scope.lookupPoint(body.from), scope.lookupPoint(body.to), {
          circle: body.circle,
          from: body.from,
          to: body.to,
        }),
      ]
    case 'radiusTo':
      return [radiusTo(scope.lookupCircle(body.circle), scope.lookupPoint(body.point), { circle: body.circle, point: body.point })]
    case 'diameter':
      return [
        diameter(scope.lookupCircle(body.circle), scope.lookupPoint(body.from), scope.lookupPoint(body.to), {
          circle: body.circle,
          from: body.from,
          to: body.to,
        }),
      ]
    // Phase 9 (R1): a sphere solid's centre. The solid-figure walk owns every
    // one it can see, so this is reached only where no solid is drawn — the
    // plot renderer — and a circle's centre is already the point it was
    // drawn around.
    case 'centerOf':
      throw new Error(`"center of ${body.solid}" is the centre of a sphere solid, which exists only in a solid figure`)
    // Phase 10 (M6): two lines in the plane meet or are parallel, so the
    // common perpendicular exists only between lines in space.
    case 'commonPerpendicular':
      throw new Error(
        `"common perpendicular of ${body.first.join('-')} and ${body.second.join('-')}" joins two lines in space, and exists only among points in space (a solid figure)`
      )
    case 'triangleCentre': {
      const [a, b, c] = triangleVertices(scope, body.vertices, body.centre)
      switch (body.centre) {
        case 'centroid':
          return [point(centroid(a, b, c))]
        case 'circumcenter':
          return [point(circumcenter(a, b, c))]
        case 'incenter':
          return [point(incenter(a, b, c))]
        case 'orthocenter':
          return [point(orthocenter(a, b, c))]
        case 'incircle': {
          const inscribed = incircle(a, b, c)
          return [circle(inscribed.center, inscribed.radius)]
        }
        case 'circumcircle': {
          const circumscribed = circumcircle(a, b, c)
          return [circle(circumscribed.center, circumscribed.radius)]
        }
      }
    }
  }
}

// D4 — binding a name count that does not match what the construction found
// is an error naming both numbers. Silently dropping a solution, or leaving a
// name unbound, is how a figure becomes subtly wrong while still looking
// plausible.
function assertSolutionCount(names: string[], results: GeometryObject[], body: Construction): void {
  if (names.length === 0 || names.length === results.length) return
  const found = results.length === 0 ? 'no solutions' : results.length === 1 ? '1 solution' : `${results.length} solutions`
  throw new Error(
    `${names.length === 1 ? '1 name' : `${names.length} names`} (${names.join(', ')}) ` +
      `cannot be bound to a ${body.kind} construction that produced ${found}`
  )
}

function buildTriangle(
  scope: GeometryScope,
  statement: Statement & { kind: 'triangle' },
  evaluateExpr: (e: Expr) => number,
  angleMode: GraphConfig['angle']
): { objects: SceneObject[]; points: [string, Vec2][] } {
  const spec: TriangleSpec = { names: statement.names, sides: {}, angles: {} }
  for (const slot of SLOTS) {
    const side = statement.sides[slot]
    if (side) spec.sides[slot] = evaluateExpr(side)
    const angle = statement.angles[slot]
    if (angle) spec.angles[slot] = evaluateExpr(angle)
  }
  const solved = solveTriangle(spec, angleMode)
  const vertices = statement.names.map((label, i) => ({ label, position: solved.vertices[i] }))
  for (const v of vertices) scope.bind(v.label, point(v.position))
  return {
    objects: polygonObjects(vertices, statement.color),
    points: vertices.map((v) => [v.label, v.position] as [string, Vec2]),
  }
}

// `skip` holds the statements another pass owns. The figure renderer passes
// the solid-figure walk's `ownedStatements` (S3): a construction on points in
// space is resolved there, and must never reach this pass, which would report
// "unknown geometry name" for a vertex it was never meant to resolve.
export function buildConstructions(
  statements: Statement[],
  config: GraphConfig,
  functions: FunctionTable,
  seedPoints: Map<string, Vec2>,
  skip: ReadonlySet<number> = new Set()
): ConstructionBuild {
  const scope = new GeometryScope()
  const objectsByStatement = new Map<number, SceneObject[]>()
  const geometryByStatement = new Map<number, { name: string | null; object: GeometryObject }[]>()
  const errors: SceneError[] = []
  const points = new Map<string, Vec2>()
  const evaluateExpr = (expr: Expr) => evalExpr(expr, {}, config.angle, functions)

  // Points already named by a plain point statement or a polygon vertex seed
  // the namespace. Labels that aren't letters-only can't be geometry names
  // (D2) and are simply not bound here — they stay usable as ordinary points.
  for (const [name, position] of seedPoints) {
    if (isGeometryName(name)) scope.bind(name, point(position))
  }

  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index]
    if (skip.has(index)) continue
    try {
      if (statement.kind === 'triangle') {
        const built = buildTriangle(scope, statement, evaluateExpr, config.angle)
        objectsByStatement.set(index, built.objects)
        for (const [label, position] of built.points) points.set(label, position)
        continue
      }
      if (statement.kind !== 'construction') continue

      const results = evaluate(scope, statement.body, evaluateExpr, config.angle)
      assertSolutionCount(statement.names, results, statement.body)

      const objects: SceneObject[] = []
      const values: { name: string | null; object: GeometryObject }[] = []
      results.forEach((result, i) => {
        const name = statement.names[i] ?? null
        if (name) {
          scope.bind(name, result)
          if (result.kind === 'point') points.set(name, result.at)
        }
        objects.push(...geometryObjectToScene(result, result.kind === 'point' ? name : null, statement.color))
        values.push({ name, object: result })
      })
      objectsByStatement.set(index, objects)
      geometryByStatement.set(index, values)
    } catch (err) {
      errors.push({ line: 0, message: err instanceof Error ? err.message : String(err) })
    }
  }

  const circles = new Map<string, GeometryCircle>()
  for (const name of scope.names()) {
    const object = scope.lookup(name)
    if (object.kind === 'circle') circles.set(name, object)
  }

  return { objectsByStatement, errors, points, geometryByStatement, circles }
}
