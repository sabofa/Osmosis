import type { Construction, Expr, GeometryRef, SolidPrimitive, Statement } from '../parser/types'
import { centroid, circumcenter, incenter, orthocenter } from '../scene/geometry/centres'
import type { SceneError, Vec2 } from '../scene/types'
import { authorToWorld } from './authorFrame'
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
  scale3,
  sub3,
  type Plane3,
} from './construct3d'
import type { Vec3 } from './project3d'
import { buildSolid, type SolidBody, type SolidSpec } from './solids'

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
export function solidSpecOf(primitive: SolidPrimitive, value: (e: Expr) => number): SolidSpec {
  const positive = (e: Expr, what: string): number => {
    const n = value(e)
    if (!Number.isFinite(n) || n <= 0) throw new Error(`A solid's ${what} must be a positive number, got ${n}`)
    return n
  }
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
  }
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
      return [...ref.points]
  }
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
      return `plane ${ref.points.join('-')}`
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

function alreadyBound(name: string, kind: 'space' | 'plane'): Error {
  return new Error(
    `"${name}" is already bound to a point ${kind === 'space' ? 'in space' : 'in the plane'} — pick a different name rather than redefining it`
  )
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

function nameList(names: readonly string[]): string {
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

export function buildSolidFigure(statements: Statement[], value: (e: Expr) => number): SolidFigureScope {
  const solids = new Map<string, SolidBody>()
  const points = new Map<string, Vec3>()
  const ownedStatements = new Set<number>()
  const byStatement: SolidFigureScope['byStatement'] = new Map()
  const errors: SceneError[] = []
  // Names bound as points in the plane. Tracked only so the walk can tell a
  // mixed construction from an unknown name; the 2D pass owns their values.
  const planeNames = new Set<string>()

  const fail = (err: unknown) => errors.push({ line: 0, message: err instanceof Error ? err.message : String(err) })

  const lookup = (name: string): Vec3 => {
    const p = points.get(name)
    if (p) return p
    if (planeNames.has(name)) throw new Error(`"${name}" is a point in the plane, and this construction needs points in space`)
    throw new Error(
      `Unknown point "${name}" — define it before this line (e.g. "${name} = (x, y, z)", or name it among a solid's vertices)`
    )
  }

  const planeOf = (ref: Extract<GeometryRef, { kind: 'plane' }>): Plane3 =>
    planeThrough(lookup(ref.points[0]), lookup(ref.points[1]), lookup(ref.points[2]), nameList(ref.points))

  // Plain points are literals with no dependencies, so — exactly as in 2D —
  // they are order-independent: a construction may name one defined below it.
  // Plane literals first, so a space literal reusing a plane name is caught.
  for (const statement of statements) {
    if (statement.kind === 'point' && statement.label && statement.z === null) planeNames.add(statement.label)
    else if (statement.kind === 'polygon') for (const v of statement.vertices) planeNames.add(v.label)
  }
  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index]
    if (statement.kind !== 'point' || statement.z === null) continue
    ownedStatements.add(index)
    try {
      const name = statement.label ?? ''
      if (name && points.has(name)) throw alreadyBound(name, 'space')
      if (name && planeNames.has(name)) throw alreadyBound(name, 'plane')
      // S1 — the one place an author's coordinates enter the solid figure.
      const at = authorToWorld({ x: value(statement.x), y: value(statement.y), z: value(statement.z) })
      if (name) points.set(name, at)
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
          const body = buildSolid(solidSpecOf(statement.primitive, value))
          if (statement.name) solids.set(statement.name, body)
          const entry: { solid: SolidBody; points: { name: string; at: Vec3; drawn: boolean }[] } = { solid: body, points: [] }
          byStatement.set(index, entry)
          if (statement.vertices.length === 0) break
          // The solid stands whatever is wrong with its lettering: an error
          // in the vertex list costs the letters, not the drawing.
          const polyhedron = body.polyhedron
          if (!polyhedron || statement.vertices.length !== body.labelOrder.length) {
            throw new Error(
              `A ${body.spec.kind} has ${body.labelOrder.length} vertices, but ${statement.vertices.length} names were given ("${statement.vertices.join('')}")`
            )
          }
          for (const name of statement.vertices) {
            if (points.has(name)) throw alreadyBound(name, 'space')
            if (planeNames.has(name)) throw alreadyBound(name, 'plane')
          }
          // S4 — a solid's named vertices are real points.
          statement.vertices.forEach((name, v) => {
            const at = polyhedron.vertices[body.labelOrder[v]]
            points.set(name, at)
            entry.points.push({ name, at, drawn: false })
          })
          break
        }
        case 'construction':
          walkConstruction(index, statement.names, statement.body)
          break
        case 'triangle':
          for (const name of statement.names) {
            if (points.has(name)) throw alreadyBound(name, 'space')
            planeNames.add(name)
          }
          break
        case 'crossSection':
          if (statement.lift) for (const name of statement.vertices) planeNames.add(name)
          break
        default:
          break
      }
    } catch (err) {
      fail(err)
    }
  }

  function walkConstruction(index: number, names: string[], body: Construction): void {
    const operands = operandNames(body)
    const space = operands.filter((name) => points.has(name))

    if (space.length === 0 && !hasPlaneRef(body)) {
      // A construction in the plane: the 2D pass's, unless it would rebind a
      // space point, which is refused here because the 2D pass cannot see it.
      const clash = names.find((name) => points.has(name))
      if (clash) {
        ownedStatements.add(index)
        throw alreadyBound(clash, 'space')
      }
      for (const name of names) planeNames.add(name)
      return
    }

    ownedStatements.add(index)
    const plane = operands.find((name) => planeNames.has(name))
    if (plane && space.length > 0) {
      throw new Error(`${statementText(names, body)} mixes a point in space (${space[0]}) with a point in the plane (${plane})`)
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
    for (const name of names) {
      if (points.has(name)) throw alreadyBound(name, 'space')
      if (planeNames.has(name)) throw alreadyBound(name, 'plane')
    }
    const bound = names.map((name, i) => ({ name, at: results[i], drawn: true }))
    for (const p of bound) points.set(p.name, p.at)
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
        return [lineMeetsPlane(lookup(line.from), lookup(line.to), planeOf(plane), `line ${line.from}-${line.to}`)]
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

  return { solids, points, ownedStatements, byStatement, errors }
}
