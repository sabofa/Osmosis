import { describe, expect, it } from 'vitest'
import { evalExpr } from '../parser/evalExpr'
import { parseSpec } from '../parser/parseSpec'
import type { Expr } from '../parser/types'
import { LIGHT_PALETTE } from '../render/palette'
import { worldToAuthor } from './authorFrame'
import { cameraFor, DEFAULT_CAMERA, type Vec3 } from './project3d'
import { renderFigure } from './render'
import { buildSolidFigure } from './solidScope'
import { buildScene } from '../scene/buildScene'
import { drawnDimensionSegment } from './solids'

// Phase 9 — inscribed and circumscribed spheres, and spheres by tangency.
// Every expected value here is computed by hand in the AUTHOR's z-up frame;
// the walk stores internal y-up points, so each is converted back before it
// is compared.

const value = (e: Expr) => evalExpr(e, {}, 'radians', {})

function walk(spec: string) {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  return buildSolidFigure(parsed.statements, value)
}

function rendered(spec: string) {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
}

function errorsOf(spec: string): string[] {
  return rendered(spec).errors.map((e) => e.message)
}

// A sphere solid's centre (author frame) and radius.
function sphereOf(scope: ReturnType<typeof walk>, name: string): { center: Vec3; radius: number } {
  const body = scope.solids.get(name)
  if (!body) throw new Error(`no solid ${name}; errors: ${scope.errors.map((e) => e.message).join(' | ')}`)
  if (body.spec.kind !== 'sphere') throw new Error(`${name} is a ${body.spec.kind}, not a sphere`)
  return { center: worldToAuthor(body.placement.origin), radius: body.spec.radius }
}

function expectNear(p: Vec3, q: Vec3, digits = 12): void {
  expect(p.x).toBeCloseTo(q.x, digits)
  expect(p.y).toBeCloseTo(q.y, digits)
  expect(p.z).toBeCloseTo(q.z, digits)
}

function authorPoint(scope: ReturnType<typeof walk>, name: string): Vec3 {
  const p = scope.points.get(name)
  if (!p) throw new Error(`no space point ${name}; errors: ${scope.errors.map((e) => e.message).join(' | ')}`)
  return worldToAuthor(p)
}

// ---------------------------------------------------------------------------
// Task 1 — R2, "center of", and R5
// ---------------------------------------------------------------------------

describe("a sphere's radius is always a named dimension (R2)", () => {
  const SPEC = '@mode: figure\nM = (1, 2, 3)\nS = solid sphere center M radius 5'

  it('labels and checks the radius of a sphere placed by its centre', () => {
    expect(errorsOf(`${SPEC}\nlabel: S radius = 5`)).toEqual([])
    // It is checked, not just printed: a wrong radius is refused.
    expect(errorsOf(`${SPEC}\nlabel: S radius = 6`)).toEqual([expect.stringMatching(/"S radius = 6" disagrees with the figure — the geometry gives 5/)])
    expect(rendered(`${SPEC}\nlabel: S radius`).svg).toMatch(/data-object="S radius"[^>]*>5</)
  })

  it('draws its reference from the centre M, at true length 5, and still under @view: side', () => {
    const scope = walk(SPEC)
    const body = scope.solids.get('S')!
    for (const camera of [DEFAULT_CAMERA, cameraFor('side')]) {
      const [from, to] = drawnDimensionSegment(body, 'radius', camera)!
      expectNear(worldToAuthor(from), { x: 1, y: 2, z: 3 })
      expect(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)).toBeCloseTo(5, 12)
      // Not seen end-on: the drawn line has length.
      const [a, b] = [camera.project(from), camera.project(to)]
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(1)
    }
    const svg = rendered(`${SPEC}\nlabel: S radius`).svg
    expect(svg).toMatch(/<line [^>]*data-object="S radius"/)
  })

  it('keeps refusing named dimensions of every other solid on points', () => {
    const spec = '@mode: figure\nA = (0, 0, 0)\nB = (0, 0, 4)\nC = solid cylinder from A to B radius 3\nlabel: C radius'
    expect(errorsOf(spec)).toEqual([expect.stringMatching(/"C" is built on named points, so it has no "radius" to label/)])
  })
})

describe('the centre of a sphere as a point (R1, "center of")', () => {
  it('is the centre a sphere was placed on', () => {
    const scope = walk('@mode: figure\nM = (1, 2, 3)\nS = solid sphere center M radius 5\nP = center of S')
    expectNear(authorPoint(scope, 'P'), { x: 1, y: 2, z: 3 })
  })

  it('is the origin for a sphere placed by its dimensions', () => {
    const scope = walk('@mode: figure\nS = solid sphere radius 4\nP = center of S')
    expectNear(authorPoint(scope, 'P'), { x: 0, y: 0, z: 0 })
  })

  it('is drawn as a point, dot and letter', () => {
    const svg = rendered('@mode: figure\nM = (1, 2, 3)\nS = solid sphere center M radius 5\nP = center of S').svg
    expect(svg).toMatch(/<circle [^>]*data-statement="2" data-object="P"/)
  })

  it('is refused by the plot renderer, where there is no solid', () => {
    const parsed = parseSpec('@mode: graph\nM = center of S')
    const scene = buildScene(parsed.statements, { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }, parsed.config)
    expect(scene.errors.map((e) => e.message)).toEqual([expect.stringMatching(/"center of S" is the centre of a sphere solid, which exists only in a solid figure/)])
  })

  it('refuses anything but a sphere, and names it', () => {
    expect(errorsOf('@mode: figure\nC = solid cylinder radius 3, height 8\nP = center of C')).toEqual([
      expect.stringMatching(/"C" is a cylinder — only a sphere has a named centre/),
    ])
    expect(errorsOf('@mode: figure\nM = (0, 0, 0)\nP = center of M')).toEqual([expect.stringMatching(/"M" is a point in space, not a solid/)])
    expect(errorsOf('@mode: figure\nS = solid sphere radius 4\nP = center of Q')).toEqual([expect.stringMatching(/Unknown solid "Q"/)])
    // A circle in the plane has a centre, but "center of" is a sphere's.
    expect(errorsOf('@mode: figure\nS = solid sphere radius 4\nO = (0, 0)\nk = circle O, 3\nP = center of k')).toEqual([
      expect.stringMatching(/"k" is a circle in the plane — only a sphere has a named centre/),
    ])
  })
})

describe('a sphere tangent to a plane (R5)', () => {
  it('takes its radius from the distance to a horizontal plane: (0, 0, 7) to z = 2 is 5', () => {
    const scope = walk('@mode: figure\nP = (0, 0, 7)\nS = solid sphere center P tangent to plane z = 2')
    const s = sphereOf(scope, 'S')
    expectNear(s.center, { x: 0, y: 0, z: 7 })
    expect(s.radius).toBeCloseTo(5, 12)
  })

  it('...and from a tilted plane: (3, 3, 3) to x + y + z = 3 is 6 / sqrt 3 = 2 sqrt 3', () => {
    const scope = walk('@mode: figure\nP = (3, 3, 3)\nS = solid sphere center P tangent to plane x + y + z = 3')
    expect(sphereOf(scope, 'S').radius).toBeCloseTo(2 * Math.sqrt(3), 12)
    // The same plane through three of its points, and by name.
    const byPoints = walk(
      '@mode: figure\nA = (3, 0, 0)\nB = (0, 3, 0)\nC = (0, 0, 3)\nP = (3, 3, 3)\nS = solid sphere center P tangent to plane A-B-C'
    )
    expect(sphereOf(byPoints, 'S').radius).toBeCloseTo(2 * Math.sqrt(3), 12)
    const named = walk('@mode: figure\np = plane x + y + z = 3\nP = (3, 3, 3)\nS = solid sphere center P tangent to plane p')
    expect(sphereOf(named, 'S').radius).toBeCloseTo(2 * Math.sqrt(3), 12)
  })

  it('refuses a centre on the plane', () => {
    const spec = '@mode: figure\nP = (1, 1, 2)\nS = solid sphere center P tangent to plane z = 2'
    expect(errorsOf(spec)).toEqual([expect.stringMatching(/P lies on the plane z = 2, so a sphere centred there cannot be tangent to it/)])
    expect(walk(spec).solids.has('S')).toBe(false)
  })
})

describe('a sphere tangent to another sphere (R5)', () => {
  const T2 = '@mode: figure\nO = (0, 0, 0)\nT = solid sphere center O radius 2'
  const T10 = '@mode: figure\nO = (0, 0, 0)\nT = solid sphere center O radius 10'

  it('externally: T of radius 2 at the origin and P = (6, 8, 0) give 10 - 2 = 8', () => {
    const s = sphereOf(walk(`${T2}\nP = (6, 8, 0)\nS = solid sphere center P externally tangent to T`), 'S')
    expectNear(s.center, { x: 6, y: 8, z: 0 })
    expect(s.radius).toBeCloseTo(8, 12)
    // The same T placed by its dimension, at the origin.
    expect(sphereOf(walk('@mode: figure\nT = solid sphere radius 2\nP = (6, 8, 0)\nS = solid sphere center P externally tangent to T'), 'S').radius).toBeCloseTo(8, 12)
  })

  it('internally: T of radius 10 at the origin and P = (3, 4, 0) give 10 - 5 = 5', () => {
    const s = sphereOf(walk(`${T10}\nP = (3, 4, 0)\nS = solid sphere center P internally tangent to T`), 'S')
    expectNear(s.center, { x: 3, y: 4, z: 0 })
    expect(s.radius).toBeCloseTo(5, 12)
  })

  it('refuses external tangency from inside T and internal tangency from outside it', () => {
    expect(errorsOf(`${T2}\nP = (1, 0, 0)\nS = solid sphere center P externally tangent to T`)).toEqual([
      expect.stringMatching(/P is inside "T", so no sphere centred there is externally tangent to it/),
    ])
    expect(errorsOf(`${T2}\nP = (6, 8, 0)\nS = solid sphere center P internally tangent to T`)).toEqual([
      expect.stringMatching(/P is outside "T", so no sphere centred there is internally tangent to it/),
    ])
    // On T's surface the radius would be 0, either way.
    for (const side of ['externally', 'internally']) {
      expect(errorsOf(`${T2}\nP = (0, 2, 0)\nS = solid sphere center P ${side} tangent to T`)).toEqual([expect.stringMatching(/P lies on "T"/)])
    }
    // At T's centre, "internally tangent" would be T itself.
    expect(errorsOf(`${T2}\nS = solid sphere center O internally tangent to T`)).toEqual([expect.stringMatching(/O is the centre of "T"/)])
  })

  it('refuses tangency to a solid that is not a sphere, and to an unknown one', () => {
    expect(errorsOf('@mode: figure\nC = solid cube edge 2\nP = (5, 0, 0)\nS = solid sphere center P externally tangent to C')).toEqual([
      expect.stringMatching(/"C" is a cube — a sphere is tangent to a plane or to another sphere/),
    ])
    expect(errorsOf('@mode: figure\nP = (5, 0, 0)\nS = solid sphere center P externally tangent to T')).toEqual([expect.stringMatching(/Unknown solid "T"/)])
  })
})
