import type { GraphConfig } from '../../parser/config'
import { evalExpr, type FunctionTable } from '../../parser/evalExpr'
import type { Construction, Expr, GeometryRef, Statement, TriangleSlot } from '../../parser/types'
import type { SceneError, SceneObject, Vec2 } from '../types'
import { centroid, circumcenter, circumcircle, incenter, incircle, orthocenter } from './centres'
import { dilate, divide, foot, midpoint, reflect, rotate, translate } from './derive'
import { intersect } from './intersect'
import { angleBisector, parallelThrough, perpendicularBisector, perpendicularThrough } from './lines'
import {
  circle,
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
}

const SLOTS: TriangleSlot[] = ['a', 'b', 'c']

function resolveObject(scope: GeometryScope, ref: GeometryRef): GeometryObject {
  if (ref.kind === 'named') return scope.lookup(ref.name)
  return makeLine(scope.lookupPoint(ref.from), scope.lookupPoint(ref.to), ref.extent)
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
  return ref.kind === 'named' ? ref.name : `${ref.from}-${ref.to}`
}

function triangleVertices(scope: GeometryScope, names: [string, string, string]): [Vec2, Vec2, Vec2] {
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
    case 'triangleCentre': {
      const [a, b, c] = triangleVertices(scope, body.vertices)
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

export function buildConstructions(
  statements: Statement[],
  config: GraphConfig,
  functions: FunctionTable,
  seedPoints: Map<string, Vec2>
): ConstructionBuild {
  const scope = new GeometryScope()
  const objectsByStatement = new Map<number, SceneObject[]>()
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
      results.forEach((result, i) => {
        const name = statement.names[i] ?? null
        if (name) {
          scope.bind(name, result)
          if (result.kind === 'point') points.set(name, result.at)
        }
        objects.push(...geometryObjectToScene(result, result.kind === 'point' ? name : null, statement.color))
      })
      objectsByStatement.set(index, objects)
    } catch (err) {
      errors.push({ line: 0, message: err instanceof Error ? err.message : String(err) })
    }
  }

  return { objectsByStatement, errors, points }
}
