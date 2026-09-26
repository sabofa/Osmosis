import { describe, expect, it } from 'vitest'
import { evalExpr } from '../parser/evalExpr'
import { parseSpec } from '../parser/parseSpec'
import type { Expr } from '../parser/types'
import { worldToAuthor } from './authorFrame'
import type { Vec3 } from './project3d'
import { buildSolidFigure, isSpaceName } from './solidScope'

// The solid-figure walk (S3): solids and constructions in space, resolved in
// one source-order pass. Every expected value here is in the AUTHOR's z-up
// frame, computed by hand; the walk stores internal y-up points, so each is
// converted back before comparing.

const value = (e: Expr) => evalExpr(e, {}, 'radians', {})

function walk(spec: string) {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  return buildSolidFigure(parsed.statements, value)
}

function authorPoint(scope: ReturnType<typeof walk>, name: string): Vec3 {
  const p = scope.points.get(name)
  if (!p) throw new Error(`no space point ${name}`)
  return worldToAuthor(p)
}

function expectAt(scope: ReturnType<typeof walk>, name: string, x: number, y: number, z: number): void {
  const p = authorPoint(scope, name)
  expect(p.x).toBeCloseTo(x, 12)
  expect(p.y).toBeCloseTo(y, 12)
  expect(p.z).toBeCloseTo(z, 12)
}

// The unit cube, placed by points: ABCD the bottom face counter-clockwise
// from the origin, E-H above them.
const CUBE = [
  '@mode: figure',
  'A = (0, 0, 0)',
  'B = (1, 0, 0)',
  'C = (1, 1, 0)',
  'D = (0, 1, 0)',
  'E = (0, 0, 1)',
  'G = (1, 1, 1)',
].join('\n')

const THIRD = 1 / 3

describe('space points', () => {
  it('binds a 3-coordinate point as a space point, in the internal frame', () => {
    const scope = walk('@mode: figure\nA = (1, 2, 3)')
    expect(isSpaceName(scope, 'A')).toBe(true)
    // Author (1, 2, 3) is internal (2, 3, 1).
    expect(scope.points.get('A')).toEqual({ x: 2, y: 3, z: 1 })
    // Directives are not statements: A is statement 0.
    expect(scope.byStatement.get(0)?.points).toEqual([{ name: 'A', at: { x: 2, y: 3, z: 1 }, drawn: true }])
    expect(scope.ownedStatements.has(0)).toBe(true)
  })

  it('leaves a point in the plane alone', () => {
    const scope = walk('@mode: figure\nP = (1, 2)')
    expect(isSpaceName(scope, 'P')).toBe(false)
    expect(scope.ownedStatements.size).toBe(0)
  })
})

describe("a solid's named vertices (S4)", () => {
  it('binds them at the vertices labelOrder names, undrawn', () => {
    const scope = walk('@mode: figure\nS = solid prism 8 by 5 by 6 vertices ABCDEFGH')
    expect(scope.solids.get('S')).toBeDefined()
    // Textbook lettering (phase 6b): A the front-left bottom corner (largest
    // X, smallest Y), ABCD counter-clockwise from above, A under E, G
    // diagonally opposite A. Width 8 along Y, depth 6 along X, height 5 along
    // Z, centred on the origin.
    expectAt(scope, 'A', 3, -4, -2.5)
    expectAt(scope, 'B', 3, 4, -2.5)
    expectAt(scope, 'D', -3, -4, -2.5)
    expectAt(scope, 'E', 3, -4, 2.5)
    expectAt(scope, 'G', -3, 4, 2.5)
    const bound = scope.byStatement.get(0)
    expect(bound?.solid).toBe(scope.solids.get('S'))
    expect(bound?.points.map((p) => p.drawn)).toEqual(Array(8).fill(false))
  })

  it('refuses to rebind a vertex name', () => {
    const scope = walk('@mode: figure\nS = solid prism 8 by 5 by 6 vertices ABCDEFGH\nA = midpoint B-C')
    expect(scope.errors.map((e) => e.message)).toEqual([expect.stringMatching(/"A" is already bound/)])
  })

  it('refuses a second solid that reuses a vertex name, and still builds the solid', () => {
    const scope = walk('@mode: figure\nS = solid tetrahedron edge 5 vertices ABCD\nT = solid tetrahedron edge 3 vertices DEFG')
    expect(scope.errors).toHaveLength(1)
    expect(scope.errors[0].message).toMatch(/"D" is already bound/)
    expect(scope.solids.get('T')).toBeDefined()
  })
})

describe('constructions in space, against hand-computed author coordinates', () => {
  it('finds the midpoint of the space diagonal A-G at (1/2, 1/2, 1/2)', () => {
    expectAt(walk(`${CUBE}\nM = midpoint A-G`), 'M', 0.5, 0.5, 0.5)
  })

  it('divides A-G at 1:2 a third of the way along', () => {
    expectAt(walk(`${CUBE}\nP = divide A-G at 1:2`), 'P', THIRD, THIRD, THIRD)
  })

  it('drops the foot from A to plane B-D-E at the centroid of BDE', () => {
    expectAt(walk(`${CUBE}\nF = foot A to plane B-D-E`), 'F', THIRD, THIRD, THIRD)
  })

  it('drops the foot from D to line A-G onto the diagonal', () => {
    // D = (0,1,0) onto the line along (1,1,1): t = 1/3.
    expectAt(walk(`${CUBE}\nK = foot D to line A-G`), 'K', THIRD, THIRD, THIRD)
  })

  it('meets line A-G with plane B-D-E at (1/3, 1/3, 1/3)', () => {
    expectAt(walk(`${CUBE}\nX = intersect line A-G, plane B-D-E`), 'X', THIRD, THIRD, THIRD)
    // Either order.
    expectAt(walk(`${CUBE}\nX = intersect plane B-D-E, line A-G`), 'X', THIRD, THIRD, THIRD)
  })

  it('puts the circumcenter of the equilateral triangle BDE at its centroid', () => {
    expectAt(walk(`${CUBE}\nO = circumcenter BDE`), 'O', THIRD, THIRD, THIRD)
  })

  it('puts the circumcenter of the right triangle ABG at the middle of its hypotenuse', () => {
    // AB . BG = (1,0,0) . (0,1,1) = 0: the right angle is at B, so the
    // circumcenter is the midpoint of AG and the orthocenter is B itself.
    const scope = walk(`${CUBE}\nO = circumcenter ABG\nH = orthocenter ABG`)
    expectAt(scope, 'O', 0.5, 0.5, 0.5)
    expectAt(scope, 'H', 1, 0, 0)
  })

  it('finds the incenter of a triangle in space', () => {
    // The 3-4-5 right triangle standing in the plane x = 2: legs along Y and
    // Z from its right angle at (2, 1, 1). The inradius is (3 + 4 - 5)/2 = 1,
    // so the incenter sits 1 along each leg from the right angle.
    const scope = walk('@mode: figure\nA = (2, 1, 1)\nB = (2, 4, 1)\nC = (2, 1, 5)\nI = incenter ABC')
    expectAt(scope, 'I', 2, 2, 2)
  })

  it('takes the centroid of three or four space points', () => {
    const scope = walk(`${CUBE}\nT = centroid BDE\nQ = centroid ABDE`)
    expectAt(scope, 'T', THIRD, THIRD, THIRD)
    expectAt(scope, 'Q', 0.25, 0.25, 0.25)
  })

  it("constructs on a solid's own vertices", () => {
    const scope = walk('@mode: figure\nS = solid prism 8 by 5 by 6 vertices ABCDEFGH\nM = midpoint A-G')
    expect(scope.errors).toEqual([])
    expectAt(scope, 'M', 0, 0, 0)
    expect(scope.byStatement.get(1)?.points).toEqual([{ name: 'M', at: { x: 0, y: 0, z: 0 }, drawn: true }])
  })

  it('refuses a plane through collinear points, naming them', () => {
    const scope = walk(`${CUBE}\nF = foot B to plane A-M-G\nM = midpoint A-G`)
    expect(scope.errors.length).toBeGreaterThan(0)
    const collinear = walk(`${CUBE}\nM = midpoint A-G\nF = foot B to plane A-M-G`)
    expect(collinear.errors.map((e) => e.message)).toEqual([expect.stringMatching(/A, M and G are collinear/)])
  })

  it('refuses a line parallel to the plane it is asked to meet', () => {
    const scope = walk(`${CUBE}\nX = intersect line A-B, plane D-C-G`)
    expect(scope.errors.map((e) => e.message)).toEqual([expect.stringMatching(/^Line A-B is parallel to plane D-C-G, /)])
  })
})

describe('the two kinds of name (S2)', () => {
  it('refuses a construction that mixes a space point and a plane point, naming both', () => {
    const scope = walk('@mode: figure\nA = (0, 0, 0)\nP = (1, 2)\nM = midpoint A-P')
    expect(scope.errors.map((e) => e.message)).toEqual(['M = midpoint A-P mixes a point in space (A) with a point in the plane (P)'])
    // Owned by the walk, so the 2D construction pass never sees it.
    expect(scope.ownedStatements.has(2)).toBe(true)
  })

  it('refuses a planar construction given a space point, saying it is planar', () => {
    const scope = walk(`${CUBE}\nR = rotate A about B by 90`)
    expect(scope.errors).toHaveLength(1)
    expect(scope.errors[0].message).toMatch(/rotate/)
    expect(scope.errors[0].message).toMatch(/planar/)
    expect(scope.ownedStatements.has(6)).toBe(true)
  })

  it('refuses to bind a space point over a plane point of the same name', () => {
    const scope = walk('@mode: figure\nA = (1, 2)\nA = (1, 2, 3)')
    expect(scope.errors.map((e) => e.message)).toEqual([expect.stringMatching(/"A" is already bound/)])
  })

  it('refuses to bind a planar construction over a space point', () => {
    const scope = walk('@mode: figure\nA = (0, 0, 0)\nP = (1, 2)\nQ = (3, 4)\nA = midpoint P-Q')
    expect(scope.errors.map((e) => e.message)).toEqual([expect.stringMatching(/"A" is already bound/)])
  })

  it('leaves a planar construction on plane points to the 2D pass', () => {
    const scope = walk('@mode: figure\nP = (1, 2)\nQ = (3, 4)\nM = midpoint P-Q')
    expect(scope.errors).toEqual([])
    expect(scope.ownedStatements.size).toBe(0)
  })
})

describe('source order decides a rebinding, even for hoisted literals', () => {
  it('refuses a LATER literal that reuses a vertex name, and keeps all eight letters', () => {
    // Literal points are bound before the walk (order-independent, as in
    // 2D), so the literal on line 2 used to take "A" first — stripping the
    // solid on line 1 of its letters and blaming it.
    const scope = walk('@mode: figure\nS = solid prism 8 by 5 by 6 vertices ABCDEFGH\nA = (0, 0, 0)')
    expect(scope.errors.map((e) => e.message)).toEqual([
      '"A" is already bound to a vertex of solid "S" on an earlier line — the later point "A" cannot rebind it',
    ])
    expect(scope.byStatement.get(0)?.points.map((p) => p.name)).toEqual('ABCDEFGH'.split(''))
    // Textbook lettering: A front-left bottom, G diagonally opposite it.
    expectAt(scope, 'A', 3, -4, -2.5)
    expectAt(scope, 'G', -3, 4, 2.5)
    // The refused literal draws nothing.
    expect(scope.byStatement.get(1)).toBeUndefined()
  })

  it('still refuses the solid when the literal comes FIRST', () => {
    const scope = walk('@mode: figure\nA = (0, 0, 0)\nS = solid prism 8 by 5 by 6 vertices ABCDEFGH')
    expect(scope.errors.map((e) => e.message)).toEqual([expect.stringMatching(/^"A" is already bound to a point in space/)])
    expectAt(scope, 'A', 0, 0, 0)
  })

  it('refuses a later literal that reuses a constructed name', () => {
    const scope = walk(`${CUBE}\nM = midpoint A-G\nM = (5, 5, 5)`)
    expect(scope.errors.map((e) => e.message)).toEqual([
      '"M" is already bound to a point in space on an earlier line — the later point "M" cannot rebind it',
    ])
    expectAt(scope, 'M', 0.5, 0.5, 0.5)
  })

  it('refuses a later point in the plane that reuses a vertex name', () => {
    const scope = walk('@mode: figure\nT = solid tetrahedron edge 5 vertices ABCD\nA = (1, 2)')
    expect(scope.errors.map((e) => e.message)).toEqual([
      '"A" is already bound to a vertex of solid "T" on an earlier line — the later point "A" cannot rebind it',
    ])
    expect(isSpaceName(scope, 'A')).toBe(true)
    // Owned, so neither the 2D pass nor the renderer takes it up.
    expect(scope.ownedStatements.has(1)).toBe(true)
  })
})

describe('what a plane name is', () => {
  it('names a line in the plane as a line when a construction mixes it with a space point', () => {
    const scope = walk(`${CUBE}\nP = (1, 2)\nQ = (3, 4)\nm = line through P parallel to P-Q\nX = intersect line A-G, m`)
    expect(scope.errors.map((e) => e.message)).toEqual([
      'X = intersect A-G, m mixes a point in space (A) with a line in the plane (m)',
    ])
  })
})

describe('the frustum refusals (P2)', () => {
  it('refuses a top equal to the radius, pointing at the cylinder', () => {
    const scope = walk('@mode: figure\nF = solid frustum radius 6, top 6, height 4')
    expect(scope.errors.map((e) => e.message)).toEqual([expect.stringMatching(/is a cylinder — write "cylinder radius 6, height 4"/)])
    expect(scope.solids.size).toBe(0)
  })

  it('refuses a top of 0, pointing at the cone', () => {
    const scope = walk('@mode: figure\nF = solid frustum radius 6, top 0, height 4')
    expect(scope.errors.map((e) => e.message)).toEqual([expect.stringMatching(/is a cone — write "cone radius 6, height 4"/)])
  })

  it('builds either way up', () => {
    expect(walk('@mode: figure\nF = solid frustum radius 6, top 3, height 4').errors).toEqual([])
    expect(walk('@mode: figure\nF = solid frustum radius 3, top 6, height 4').errors).toEqual([])
  })
})
