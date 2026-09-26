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
import { GEOM_EPS } from '../scene/geometry/types'
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

// ---------------------------------------------------------------------------
// Task 2 — circumspheres (R3, R4)
// ---------------------------------------------------------------------------

describe('the circumsphere of a polyhedron (R3)', () => {
  const circum = (solid: string) => sphereOf(walk(`@mode: figure\nS = solid ${solid}\nO = solid circumsphere of S`), 'O')

  it('of the 8 x 5 x 6 box: its centre, radius sqrt(64 + 25 + 36) / 2 = sqrt 125 / 2', () => {
    const s = circum('prism 8 by 5 by 6')
    expectNear(s.center, { x: 0, y: 0, z: 0 })
    expect(s.radius).toBeCloseTo(Math.sqrt(125) / 2, 12)
  })

  it('of the cube of edge 2: sqrt 3', () => {
    const s = circum('cube edge 2')
    expectNear(s.center, { x: 0, y: 0, z: 0 })
    expect(s.radius).toBeCloseTo(Math.sqrt(3), 12)
  })

  it('of the regular tetrahedron of edge 6: 6 sqrt 6 / 4, a quarter of the height above the base', () => {
    // Height 6 sqrt(2/3) = 2 sqrt 6, the base at -sqrt 6: the centre sits at
    // -sqrt 6 + sqrt 6 / 2 = -sqrt 6 / 2.
    const s = circum('tetrahedron edge 6')
    expectNear(s.center, { x: 0, y: 0, z: -Math.sqrt(6) / 2 })
    expect(s.radius).toBeCloseTo((3 * Math.sqrt(6)) / 2, 12)
  })

  it('of the regular octahedron of edge 6: 6 / sqrt 2 = 3 sqrt 2', () => {
    const s = circum('octahedron edge 6')
    expectNear(s.center, { x: 0, y: 0, z: 0 })
    expect(s.radius).toBeCloseTo(3 * Math.sqrt(2), 12)
  })

  it('of the square pyramid with every edge 4: 2 sqrt 2, centred on the base, whose half-diagonal is also the height', () => {
    // Half-diagonal of the base: 2 sqrt 2. Height: sqrt(4^2 - (2 sqrt 2)^2) =
    // sqrt 8 = 2 sqrt 2. So the base centre is 2 sqrt 2 from all five.
    const byPoints = sphereOf(
      walk(
        '@mode: figure\nA = (0, 0, 0)\nB = (4, 0, 0)\nC = (4, 4, 0)\nD = (0, 4, 0)\nE = (2, 2, 2*sqrt(2))\nP = solid pyramid A-B-C-D apex E\nO = solid circumsphere of P'
      ),
      'O'
    )
    expectNear(byPoints.center, { x: 2, y: 2, z: 0 })
    expect(byPoints.radius).toBeCloseTo(2 * Math.sqrt(2), 12)
    // By dimensions it is centred on the origin, base at -sqrt 2.
    const byDimensions = circum('pyramid square base 4, height 2*sqrt(2)')
    expectNear(byDimensions.center, { x: 0, y: 0, z: -Math.sqrt(2) })
    expect(byDimensions.radius).toBeCloseTo(2 * Math.sqrt(2), 12)
  })

  it('of four points: (0,0,0), (2,0,0), (0,2,0), (0,0,2) have centre (1, 1, 1) and radius sqrt 3', () => {
    const s = sphereOf(walk('@mode: figure\nA = (0, 0, 0)\nB = (2, 0, 0)\nC = (0, 2, 0)\nD = (0, 0, 2)\nO = solid circumsphere A-B-C-D'), 'O')
    expectNear(s.center, { x: 1, y: 1, z: 1 })
    expect(s.radius).toBeCloseTo(Math.sqrt(3), 12)
  })

  it('labels its radius and names its centre', () => {
    const spec = '@mode: figure\nS = solid cube edge 2\nO = solid circumsphere of S\nlabel: O radius = sqrt(3)\nM = center of O'
    expect(errorsOf(spec)).toEqual([])
    expectNear(authorPoint(walk(spec), 'M'), { x: 0, y: 0, z: 0 })
  })
})

describe('a polyhedron with no circumsphere is refused (R3)', () => {
  // The unit cube with G pushed out along the space diagonal: still a
  // corner, so still a hull, but off the sphere through A, B, C and E.
  const DENTED = [
    '@mode: figure',
    'A = (0, 0, 0)',
    'B = (1, 0, 0)',
    'C = (1, 1, 0)',
    'D = (0, 1, 0)',
    'E = (0, 0, 1)',
    'F = (1, 0, 1)',
    'G = (1.2, 1.2, 1.2)',
    'H = (0, 1, 1)',
    'S = solid hull A-B-C-D-E-F-G-H',
    'O = solid circumsphere of S',
  ].join('\n')

  it('names the first vertex off the sphere through the first four that fix it', () => {
    expect(errorsOf(DENTED)).toEqual([
      '"S" has no circumscribed sphere — no sphere passes through all 8 of its vertices: the sphere through A, B, C and E misses G',
    ])
    expect(walk(DENTED).solids.has('O')).toBe(false)
  })

  it('names the vertex of a non-cyclic base, and lets a cyclic one through', () => {
    // A rectangle is cyclic, so a pyramid on one has a circumsphere.
    const rectangle =
      '@mode: figure\nA = (0, 0, 0)\nB = (4, 0, 0)\nC = (4, 2, 0)\nD = (0, 2, 0)\nE = (1, 1, 3)\nS = solid pyramid A-B-C-D apex E\nO = solid circumsphere of S'
    expect(errorsOf(rectangle)).toEqual([])
    // A kite is not: D is off the circle through A, B and C, so the sphere
    // through A, B, C and the apex E misses it.
    const kite =
      '@mode: figure\nA = (0, 0, 0)\nB = (2, -1, 0)\nC = (4, 0, 0)\nD = (2, 3, 0)\nE = (2, 0, 3)\nS = solid pyramid A-B-C-D apex E\nO = solid circumsphere of S'
    expect(errorsOf(kite)).toEqual([expect.stringMatching(/the sphere through A, B, C and E misses D$/)])
  })

  it("names a prism's new top by the primed letters it is known by", () => {
    // Every polyhedron by dimensions is cyclic, so an unnamed vertex is never
    // the one refused; a prism on points with no "vertices" clause names its
    // top A', B', ... in messages, as phase 7 does.
    const spec = '@mode: figure\nA = (0, 0, 0)\nB = (2, -1, 0)\nC = (4, 0, 0)\nD = (2, 3, 0)\nS = solid prism A-B-C-D height 2\nO = solid circumsphere of S'
    expect(errorsOf(spec)).toEqual([expect.stringMatching(/the sphere through A, B, C and A' misses D$/)])
  })

  it('refuses four coplanar points', () => {
    expect(errorsOf('@mode: figure\nA = (0, 0, 0)\nB = (2, 0, 0)\nC = (0, 2, 0)\nD = (2, 2, 0)\nO = solid circumsphere A-B-C-D')).toEqual([
      'A, B, C and D lie in one plane, so no sphere passes through all four — a circumsphere needs four points not in one plane',
    ])
  })

  it('refuses a sphere, and anything that is not a solid', () => {
    expect(errorsOf('@mode: figure\nS = solid sphere radius 2\nO = solid circumsphere of S')).toEqual(['"S" is already a sphere — it is its own circumscribed sphere'])
    expect(errorsOf('@mode: figure\nM = (0, 0, 0)\nO = solid circumsphere of M')).toEqual([expect.stringMatching(/"M" is a point in space, not a solid/)])
    expect(errorsOf('@mode: figure\nS = solid cube edge 2\nO = solid circumsphere of T')).toEqual([expect.stringMatching(/Unknown solid "T"/)])
  })
})

describe('the circumsphere of a round solid (R4)', () => {
  const circum = (solid: string) => sphereOf(walk(`@mode: figure\nS = solid ${solid}\nO = solid circumsphere of S`), 'O')

  it('of the cylinder r = 3, h = 6: at its middle, sqrt(9 + 9) = 3 sqrt 2', () => {
    const s = circum('cylinder radius 3, height 6')
    expectNear(s.center, { x: 0, y: 0, z: 0 })
    expect(s.radius).toBeCloseTo(3 * Math.sqrt(2), 12)
  })

  it('of the cone R = 3, H = 4: 7/8 above the base, radius 25/8', () => {
    // x = (16 - 9) / 8 = 7/8; H - x = 25/8; and sqrt(3^2 + (7/8)^2) =
    // sqrt(625/64) = 25/8 to the rim. The base is at z = -2.
    const s = circum('cone radius 3, height 4')
    expectNear(s.center, { x: 0, y: 0, z: -2 + 7 / 8 })
    expect(s.radius).toBeCloseTo(25 / 8, 12)
  })

  it('of the frustum r1 = 4, r2 = 1, h = 4: 1/8 above the base, radius sqrt 1025 / 8', () => {
    // y = (16 + 1 - 16) / 8 = 1/8; sqrt((1/8)^2 + 16) = sqrt(1025) / 8, and
    // to the top rim sqrt((31/8)^2 + 1) = sqrt(1025) / 8 too.
    const s = circum('frustum radius 4, top 1, height 4')
    expectNear(s.center, { x: 0, y: 0, z: -2 + 1 / 8 })
    expect(s.radius).toBeCloseTo(Math.sqrt(1025) / 8, 12)
    // Wider at the top: the same solid turned over, so the centre is 1/8
    // below the (now upper) wide rim: 16 + (2 - z)^2 = 1 + (z + 2)^2 gives
    // 20 - 4z = 5 + 4z, z = 15/8.
    const turned = circum('frustum radius 1, top 4, height 4')
    expectNear(turned.center, { x: 0, y: 0, z: 15 / 8 })
    expect(turned.radius).toBeCloseTo(Math.sqrt(1025) / 8, 12)
  })

  it('of a tilted cylinder from A to B: centred at the midpoint of AB', () => {
    // |AB| = |(2, 4, 4)| = 6, so R = sqrt(3^2 + 3^2) = 3 sqrt 2.
    const s = sphereOf(walk('@mode: figure\nA = (0, 0, 0)\nB = (2, 4, 4)\nC = solid cylinder from A to B radius 3\nO = solid circumsphere of C'), 'O')
    expectNear(s.center, { x: 1, y: 2, z: 2 })
    expect(s.radius).toBeCloseTo(3 * Math.sqrt(2), 12)
  })

  it('of a tilted cone: 7/8 along its axis from the base centre', () => {
    // Axis O -> V along (2, 1, 2)/3, height 4: V = O + 4 u.
    const spec = '@mode: figure\nO = (1, 1, 1)\nV = (11/3, 7/3, 11/3)\nK = solid cone apex V base O radius 3\nS = solid circumsphere of K'
    const s = sphereOf(walk(spec), 'S')
    expectNear(s.center, { x: 1 + (7 / 8) * (2 / 3), y: 1 + (7 / 8) * (1 / 3), z: 1 + (7 / 8) * (2 / 3) })
    expect(s.radius).toBeCloseTo(25 / 8, 12)
  })
})

// ---------------------------------------------------------------------------
// Task 3 — inspheres (R3, R4)
// ---------------------------------------------------------------------------

// AIME 2024 I, problem 14: AB = CD = sqrt 41, AC = BD = sqrt 80,
// AD = BC = sqrt 89. V = 160/3 and every face has area 6 sqrt 21, so
// r = 3V / (4 * 6 sqrt 21) = 160 / (24 sqrt 21) = 20 / (3 sqrt 21) =
// 20 sqrt 21 / 63.
const AIME = 'T = solid tetrahedron ABCD with AB = sqrt(41), CD = sqrt(41), AC = sqrt(80), BD = sqrt(80), AD = sqrt(89), BC = sqrt(89)'
const AIME_R = (20 * Math.sqrt(21)) / 63

// The face-area-weighted mean of a tetrahedron's vertices, each weighted by
// the area of the face OPPOSITE it — the spec's formula for the incentre,
// computed here independently of the code under test.
function weightedIncentre(a: Vec3, b: Vec3, c: Vec3, d: Vec3): Vec3 {
  const area = (p: Vec3, q: Vec3, s: Vec3) => {
    const u = { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z }
    const v = { x: s.x - p.x, y: s.y - p.y, z: s.z - p.z }
    return Math.hypot(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x) / 2
  }
  const weights = [area(b, c, d), area(a, c, d), area(a, b, d), area(a, b, c)]
  const total = weights.reduce((s, w) => s + w, 0)
  const points = [a, b, c, d]
  const mean = (axis: 'x' | 'y' | 'z') => points.reduce((s, p, i) => s + weights[i] * p[axis], 0) / total
  return { x: mean('x'), y: mean('y'), z: mean('z') }
}

// Whether P is strictly inside the tetrahedron ABCD: on the same side of
// each face's plane as the fourth vertex.
function insideTetrahedron(p: Vec3, [a, b, c, d]: Vec3[]): boolean {
  const side = (q: Vec3, r: Vec3, s: Vec3, t: Vec3) => {
    const u = { x: r.x - q.x, y: r.y - q.y, z: r.z - q.z }
    const v = { x: s.x - q.x, y: s.y - q.y, z: s.z - q.z }
    const n = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x }
    return n.x * (t.x - q.x) + n.y * (t.y - q.y) + n.z * (t.z - q.z)
  }
  return [
    [a, b, c, d],
    [a, b, d, c],
    [a, c, d, b],
    [b, c, d, a],
  ].every(([q, r, s, t]) => side(q, r, s, t) * side(q, r, s, p) > 0)
}

describe('the insphere of a tetrahedron (R3)', () => {
  it('of the AIME 2024 I tetrahedron: 20 sqrt 21 / 63, centred inside it', () => {
    const scope = walk(`@mode: figure\n${AIME}\nI = solid insphere of T\nP = center of I`)
    const s = sphereOf(scope, 'I')
    expect(s.radius).toBeCloseTo(AIME_R, 12)
    const vertices = ['A', 'B', 'C', 'D'].map((name) => authorPoint(scope, name))
    expect(insideTetrahedron(authorPoint(scope, 'P'), vertices)).toBe(true)
  })

  it('prints its radius, formatted, and checks it', () => {
    const svg = rendered(`@mode: figure\n${AIME}\nI = solid insphere of T\nlabel: I radius`).svg
    expect(svg).toMatch(/data-object="I radius"[^>]*>1\.455</)
    expect(errorsOf(`@mode: figure\n${AIME}\nI = solid insphere of T\nlabel: I radius = 20*sqrt(21)/63`)).toEqual([])
    expect(errorsOf(`@mode: figure\n${AIME}\nI = solid insphere of T\nlabel: I radius = 1.5`)).toHaveLength(1)
  })

  it('is the face-area-weighted mean of the vertices, on the AIME tetrahedron and on a scalene one', () => {
    for (const spec of [
      `@mode: figure\n${AIME}`,
      '@mode: figure\nA = (0, 0, 0)\nB = (4, 0, 0)\nC = (0, 3, 0)\nD = (0, 0, 2)\nT = solid tetrahedron A-B-C-D',
    ]) {
      const scope = walk(`${spec}\nI = solid insphere of T`)
      const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((name) => authorPoint(scope, name))
      const centre = sphereOf(scope, 'I').center
      const expected = weightedIncentre(a, b, c, d)
      expect(Math.hypot(centre.x - expected.x, centre.y - expected.y, centre.z - expected.z)).toBeLessThan(GEOM_EPS)
    }
  })

  it('of the corner tetrahedron (0,0,0), (4,0,0), (0,3,0), (0,0,2): r = 3V / S = 12 / (13 + sqrt 61) at (r, r, r)', () => {
    // V = 4 * 3 * 2 / 6 = 4. Faces: 6, 4, 3 on the coordinate planes, and
    // BCD with (-4, 3, 0) x (-4, 0, 2) = (6, 8, 12), area sqrt(244)/2 =
    // sqrt 61. It touches the three coordinate planes, so c = (r, r, r).
    const s = sphereOf(walk('@mode: figure\nA = (0, 0, 0)\nB = (4, 0, 0)\nC = (0, 3, 0)\nD = (0, 0, 2)\nT = solid tetrahedron A-B-C-D\nI = solid insphere of T'), 'I')
    const r = 12 / (13 + Math.sqrt(61))
    expect(s.radius).toBeCloseTo(r, 12)
    expectNear(s.center, { x: r, y: r, z: r })
  })
})

describe('the insphere of the regular solids (R3)', () => {
  const inscribed = (solid: string) => sphereOf(walk(`@mode: figure\nS = solid ${solid}\nI = solid insphere of S`), 'I')

  it('of the regular tetrahedron of edge 6: 6 / (2 sqrt 6) = sqrt 6 / 2, a quarter of the height up', () => {
    const s = inscribed('tetrahedron edge 6')
    expect(s.radius).toBeCloseTo(Math.sqrt(6) / 2, 12)
    expectNear(s.center, { x: 0, y: 0, z: -Math.sqrt(6) + Math.sqrt(6) / 2 })
  })

  it('of the cube of edge 2: 1', () => {
    const s = inscribed('cube edge 2')
    expect(s.radius).toBeCloseTo(1, 12)
    expectNear(s.center, { x: 0, y: 0, z: 0 })
  })

  it('of the octahedron of edge 6: 6 / sqrt 6 = sqrt 6', () => {
    const s = inscribed('octahedron edge 6')
    expect(s.radius).toBeCloseTo(Math.sqrt(6), 12)
    expectNear(s.center, { x: 0, y: 0, z: 0 })
  })

  it('of the square pyramid with every edge 4: 3V / S = sqrt 2 (sqrt 3 - 1), r above the base', () => {
    // Height 2 sqrt 2, so V = 16 * 2 sqrt 2 / 3 = 32 sqrt 2 / 3. Surface:
    // the base 16 and four equilateral triangles of side 4, 4 sqrt 3 each:
    // 16 + 16 sqrt 3. r = 32 sqrt 2 / (16 + 16 sqrt 3) = 2 sqrt 2 / (1 +
    // sqrt 3) = sqrt 2 (sqrt 3 - 1).
    const r = Math.sqrt(2) * (Math.sqrt(3) - 1)
    const s = sphereOf(
      walk('@mode: figure\nA = (0, 0, 0)\nB = (4, 0, 0)\nC = (4, 4, 0)\nD = (0, 4, 0)\nE = (2, 2, 2*sqrt(2))\nP = solid pyramid A-B-C-D apex E\nI = solid insphere of P'),
      'I'
    )
    expect(s.radius).toBeCloseTo(r, 12)
    expectNear(s.center, { x: 2, y: 2, z: r })
  })
})

describe('a polyhedron with no insphere is refused (R3)', () => {
  it('refuses the 8 x 5 x 6 box, naming a face', () => {
    const spec = '@mode: figure\nS = solid prism 8 by 5 by 6\nI = solid insphere of S'
    // Worked by hand. The box's faces are +z, -z, +x, -x, +y, -y (internal),
    // at 3, 3, 4, 4, 2.5, 2.5 from its centre. Rows (n, 1): -x is +x's row
    // minus 2 e_x, already in the span of the first three, so the four that
    // fix (c, r) are +z, -z, +x, +y: r = 3, c_z = 0, c_x = 4 - 3 = 1,
    // c_y = 2.5 - 3 = -0.5. The first face that fails is -x, 4 + 1 = 5 away:
    // internal x = -4, author Y = -4, centred at (0, -4, 0); lettered DAEH.
    expect(errorsOf(spec)).toEqual([
      '"S" has no inscribed sphere — no point inside it is equidistant from all 6 of its faces: the face centred at (0, -4, 0) is 5 from the only candidate centre, not 3',
    ])
    expect(walk(spec).solids.has('I')).toBe(false)
    // Lettered, the face is named by its letters.
    expect(errorsOf('@mode: figure\nS = solid prism 8 by 5 by 6 vertices ABCDEFGH\nI = solid insphere of S')).toEqual([
      '"S" has no inscribed sphere — no point inside it is equidistant from all 6 of its faces: the face DAEH is 5 from the only candidate centre, not 3',
    ])
  })

  it('refuses a hull with no insphere: a 2 x 1 x 1 box on points', () => {
    const spec = [
      '@mode: figure',
      'A = (0, 0, 0)',
      'B = (2, 0, 0)',
      'C = (2, 1, 0)',
      'D = (0, 1, 0)',
      'E = (0, 0, 1)',
      'F = (2, 0, 1)',
      'G = (2, 1, 1)',
      'H = (0, 1, 1)',
      'S = solid hull A-B-C-D-E-F-G-H',
      'I = solid insphere of S',
    ].join('\n')
    // Worked by hand. The hull's faces, in its order: ABFE (y = 0), ADCB
    // (z = 0), AEHD (x = 0), BCGF (x = 2), CDHG (y = 1), EFGH (z = 1). The
    // first four fix r = 1 at (1, 1, 1) — which is ON the face y = 1.
    expect(errorsOf(spec)).toEqual([
      '"S" has no inscribed sphere — no point inside it is equidistant from all 6 of its faces: the only candidate centre lies on or outside the face CDHG',
    ])
  })

  it('refuses a sphere, and anything that is not a solid', () => {
    expect(errorsOf('@mode: figure\nS = solid sphere radius 2\nI = solid insphere of S')).toEqual(['"S" is already a sphere — it is its own inscribed sphere'])
    expect(errorsOf('@mode: figure\nM = (0, 0, 0)\nI = solid insphere of M')).toEqual([expect.stringMatching(/"M" is a point in space, not a solid/)])
  })
})

describe('the insphere of a round solid (R4)', () => {
  const inscribed = (solid: string) => sphereOf(walk(`@mode: figure\nS = solid ${solid}\nI = solid insphere of S`), 'I')

  it('of the cone R = 3, H = 4: rho = 12 / (3 + 5) = 1.5, 1.5 above the base', () => {
    const s = inscribed('cone radius 3, height 4')
    expect(s.radius).toBeCloseTo(1.5, 12)
    expectNear(s.center, { x: 0, y: 0, z: -2 + 1.5 })
  })

  it('of the cylinder r = 3, h = 6: 3 at its middle; with h = 8 refused', () => {
    const s = inscribed('cylinder radius 3, height 6')
    expect(s.radius).toBeCloseTo(3, 12)
    expectNear(s.center, { x: 0, y: 0, z: 0 })
    expect(errorsOf('@mode: figure\nS = solid cylinder radius 3, height 8\nI = solid insphere of S')).toEqual([
      '"S" has no inscribed sphere — a sphere touches both ends and the side of S only when its height is twice its radius (height 8, radius 3)',
    ])
  })

  it('of the frustum r1 = 4, r2 = 1, h = 4: radius 2 at mid-height; with h = 5 refused', () => {
    // h = 2 sqrt(4 * 1) = 4, so the insphere exists, radius h/2 = 2.
    const s = inscribed('frustum radius 4, top 1, height 4')
    expect(s.radius).toBeCloseTo(2, 12)
    expectNear(s.center, { x: 0, y: 0, z: 0 })
    expect(errorsOf('@mode: figure\nS = solid frustum radius 4, top 1, height 5\nI = solid insphere of S')).toEqual([
      '"S" has no inscribed sphere — a sphere touches both rims and the side of S only when its height is 2 sqrt(r1 r2) = 4 (height 5)',
    ])
  })

  it('of a tilted cone: 1.5 along its axis from the base centre', () => {
    const spec = '@mode: figure\nO = (1, 1, 1)\nV = (11/3, 7/3, 11/3)\nK = solid cone apex V base O radius 3\nI = solid insphere of K'
    const s = sphereOf(walk(spec), 'I')
    expect(s.radius).toBeCloseTo(1.5, 12)
    expectNear(s.center, { x: 1 + 1.5 * (2 / 3), y: 1 + 1.5 * (1 / 3), z: 1 + 1.5 * (2 / 3) })
  })
})

describe('an insphere is glass (the spec, "Composites")', () => {
  // Every element a statement drew, in document order.
  const drawnBy = (svg: string, statement: number) => [...svg.matchAll(new RegExp(`<(?:line|path)[^>]*data-statement="${statement}"[^>]*/>`, 'g'))].map((m) => m[0])

  it("leaves the tetrahedron's own edges byte for byte as drawn alone", () => {
    const alone = rendered(`@mode: figure\n${AIME}`).svg
    const withSphere = rendered(`@mode: figure\n${AIME}\nI = solid insphere of T`).svg
    expect(drawnBy(alone, 0).length).toBe(6)
    expect(drawnBy(withSphere, 0)).toEqual(drawnBy(alone, 0))
    // ...and the sphere inside it is drawn in full, its outline not dashed.
    const sphere = drawnBy(withSphere, 1)
    expect(sphere.length).toBeGreaterThan(0)
    for (const element of sphere) expect(element).not.toContain('stroke-dasharray')
  })

  it('dashes a segment from a vertex to the centre, which the tetrahedron hides', () => {
    const svg = rendered(`@mode: figure\n${AIME}\nI = solid insphere of T\nP = center of I\nsegment: A-P`).svg
    const segment = [...svg.matchAll(/<line [^>]*data-object="AP"[^>]*\/>/g)].map((m) => m[0])
    expect(segment.length).toBeGreaterThan(0)
    for (const element of segment) expect(element).toContain('stroke-dasharray')
  })
})

// ---------------------------------------------------------------------------
// Fix round 1
// ---------------------------------------------------------------------------

describe('fix round 1: near-degenerate spheres are refused, not approximated', () => {
  it('refuses a non-cyclic slab whose base corner D is nudged just off the base plane', () => {
    // The base A, B, C, D is not cyclic (the circle through A, B, C has
    // centre (0.5, 0.5) and radius^2 0.5; D is 0.41 from it, squared), so no
    // circumsphere exists. D sits 1.5e-9 above the plane of A, B, C — just
    // past the coplanarity threshold — so the sphere through A, B, C, D is
    // about 3e7 across; E, 0.01 above A, is 0.01 off it. A tolerance scaled
    // by the fitted radius (3e7 * 1e-9 = 0.03) accepted that.
    const spec = [
      '@mode: figure',
      'A = (0, 0, 0)',
      'B = (1, 0, 0)',
      'C = (0, 1, 0)',
      'D = (1, 0.9, 0.0000000015)',
      'E = (0, 0, 0.01)',
      'F = (1, 0, 0.01)',
      'G = (0, 1, 0.01)',
      'H = (1, 0.9, 0.01)',
      'S = solid hull A-B-C-D-E-F-G-H',
      'O = solid circumsphere of S',
    ].join('\n')
    expect(errorsOf(spec)).toEqual([
      '"S" has no circumscribed sphere — no sphere passes through all 8 of its vertices: the sphere through A, B, C and D misses E',
    ])
  })

  it('checks the sphere through four points against all four, refusing four so nearly coplanar that it cannot be fixed', () => {
    // D is 3e-8 off the plane of A, B, C at a scale of 10: past the
    // coplanarity threshold, but the sphere through them is so large that
    // rounding moves D off it by more than the tolerance.
    expect(errorsOf('@mode: figure\nA = (0, 0, 0)\nB = (10, 0, 0)\nC = (0, 10, 0)\nD = (10, 9, 0.00000003)\nO = solid circumsphere A-B-C-D')).toEqual([
      'A, B, C and D lie so nearly in one plane that no sphere through all four can be fixed — the sphere through A, B, C and D misses D by more than rounding allows',
    ])
  })
})

describe('fix round 1: refusals print numbers that stay distinct at any scale', () => {
  it('prints a small cylinder and a small frustum to significant figures', () => {
    expect(errorsOf('@mode: figure\nS = solid cylinder radius 0.0003, height 0.0007\nI = solid insphere of S')).toEqual([
      '"S" has no inscribed sphere — a sphere touches both ends and the side of S only when its height is twice its radius (height 0.0007, radius 0.0003)',
    ])
    expect(errorsOf('@mode: figure\nS = solid frustum radius 0.004, top 0.001, height 0.0041\nI = solid insphere of S')).toEqual([
      '"S" has no inscribed sphere — a sphere touches both rims and the side of S only when its height is 2 sqrt(r1 r2) = 0.004 (height 0.0041)',
    ])
  })
})

describe('fix round 1: "centre of" is "center of"', () => {
  it('binds the same point', () => {
    const scope = walk('@mode: figure\nM = (1, 2, 3)\nS = solid sphere center M radius 5\nP = centre of S')
    expectNear(authorPoint(scope, 'P'), { x: 1, y: 2, z: 3 })
  })
})
