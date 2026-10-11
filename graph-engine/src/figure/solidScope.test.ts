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

describe('solids on named points (P6)', () => {
  const TRIANGLE_CCW = '@mode: figure\nA = (0, 0, 0)\nB = (4, 0, 0)\nC = (0, 3, 0)'

  it('extrudes a prism on a base wound counter-clockwise from above UP, along (B - A) x (C - A)', () => {
    const scope = walk(`${TRIANGLE_CCW}\nQ = solid prism A-B-C height 5 vertices DEF`)
    expect(scope.errors).toEqual([])
    expectAt(scope, 'D', 0, 0, 5)
    expectAt(scope, 'E', 4, 0, 5)
    expectAt(scope, 'F', 0, 3, 5)
  })

  it('extrudes the same base wound clockwise DOWN — the right-hand rule, not a fixed "up"', () => {
    const scope = walk(`${TRIANGLE_CCW}\nQ = solid prism A-C-B height 5 vertices DFE`)
    expect(scope.errors).toEqual([])
    expectAt(scope, 'D', 0, 0, -5)
    expectAt(scope, 'E', 4, 0, -5)
    expectAt(scope, 'F', 0, 3, -5)
  })

  it('refuses a non-convex base quad, naming the reflex corner', () => {
    const scope = walk('@mode: figure\nA = (0, 0, 0)\nB = (4, 0, 0)\nC = (1, 1, 0)\nD = (0, 4, 0)\nQ = solid prism A-B-C-D height 2')
    expect(scope.errors.map((e) => e.message)).toEqual(['The base A-B-C-D is not convex: it turns back at C'])
  })

  it('refuses a base corner off the plane of the base, naming it', () => {
    // A, B and C fix the plane (the first corners, as the prism's normal
    // (B - A) x (C - A) does), so D is the corner off it.
    const scope = walk('@mode: figure\nA = (0, 0, 0)\nB = (4, 0, 0)\nC = (4, 4, 1)\nD = (0, 4, 0)\nE = (2, 2, 5)\nP = solid pyramid A-B-C-D apex E')
    expect(scope.errors.map((e) => e.message)).toEqual(['D is not in the plane A-B-C of the base A-B-C-D — a base must be flat'])
  })

  it('refuses a height of 0 and a negative height with their own words', () => {
    expect(walk(`${TRIANGLE_CCW}\nQ = solid prism A-B-C height 0`).errors.map((e) => e.message)).toEqual([
      'A prism of height 0 on A-B-C is flat — it has no volume',
    ])
    expect(walk(`${TRIANGLE_CCW}\nQ = solid prism A-B-C height -2`).errors[0].message).toMatch(/reverse the base \(C-B-A\)/)
  })

  it('refuses a top with the wrong number of names, and keeps the prism', () => {
    const scope = walk(`${TRIANGLE_CCW}\nQ = solid prism A-B-C height 5 vertices DEFG`)
    expect(scope.errors.map((e) => e.message)).toEqual([expect.stringMatching(/has a top of 3 vertices, but 4 names were given/)])
    expect(scope.solids.has('Q')).toBe(true)
  })

  it('refuses a coplanar apex, naming it, and a flat tetrahedron, naming its fourth point', () => {
    const square = '@mode: figure\nA = (0, 0, 0)\nB = (2, 0, 0)\nC = (2, 2, 0)\nD = (0, 2, 0)'
    expect(walk(`${square}\nE = (1, 1, 0)\nP = solid pyramid A-B-C-D apex E`).errors.map((e) => e.message)).toEqual([
      'E lies in the plane of the base A-B-C-D, so the pyramid has no height',
    ])
    expect(walk(`${square}\nT = solid tetrahedron A-B-C-D`).errors.map((e) => e.message)).toEqual([
      'D lies in the plane A-B-C, so the tetrahedron A-B-C-D is flat — it has no volume',
    ])
  })

  it('refuses a round solid on two points that coincide, naming both', () => {
    const scope = walk('@mode: figure\nA = (1, 2, 3)\nB = (1, 2, 3)\nC = solid cylinder from A to B radius 3')
    expect(scope.errors.map((e) => e.message)).toEqual([expect.stringMatching(/cylinder from A to B has no axis: A and B are the same point/)])
    const cone = walk('@mode: figure\nV = (0, 0, 0)\nO = (0, 0, 0)\nK = solid cone apex V base O radius 3')
    expect(cone.errors.map((e) => e.message)).toEqual([expect.stringMatching(/has no axis: V and O are the same point/)])
  })

  it('refuses vertices on a point-built solid other than a prism top', () => {
    const tetra = walk('@mode: figure\nA = (0, 0, 0)\nB = (1, 0, 0)\nD = (0, 1, 0)\nE = (0, 0, 1)\nT = solid tetrahedron A-B-D-E vertices PQRS')
    expect(tetra.errors.map((e) => e.message)).toEqual([expect.stringMatching(/"T" is built on the named points A-B-D-E, which already name its vertices/)])
    const sphere = walk('@mode: figure\nM = (0, 0, 0)\nO = solid sphere center M radius 2 vertices PQRS')
    expect(sphere.errors.map((e) => e.message)).toEqual([expect.stringMatching(/"O" is placed by the named point M and has no vertices to name/)])
  })

  it('places a sphere on its centre, a cylinder between its rim centres, a cone on its apex and base', () => {
    const scope = walk(
      '@mode: figure\nM = (1, 2, 3)\nA = (0, 0, 0)\nB = (6, 0, 0)\nV = (0, 0, 8)\nO = (0, 0, 0)\n' +
        'S = solid sphere center M radius 5\nC = solid cylinder from A to B radius 3\nK = solid cone apex V base O radius 3'
    )
    expect(scope.errors).toEqual([])
    const sphere = scope.solids.get('S')!
    expect(worldToAuthor(sphere.placement.origin)).toEqual({ x: 1, y: 2, z: 3 })
    const cylinder = scope.solids.get('C')!
    expect(cylinder.spec).toEqual({ kind: 'cylinder', radius: 3, height: 6 })
    expect(worldToAuthor(cylinder.placement.origin)).toEqual({ x: 3, y: 0, z: 0 })
    // Its axis is author X.
    expect(worldToAuthor(cylinder.placement.frame.axis)).toEqual({ x: 1, y: 0, z: 0 })
    const cone = scope.solids.get('K')!
    expect(cone.spec).toEqual({ kind: 'cone', radius: 3, height: 8 })
    // Apex up: the axis runs from the base centre to the apex.
    expect(worldToAuthor(cone.placement.frame.axis)).toEqual({ x: 0, y: 0, z: 1 })
  })
})

describe('a frustum on points refuses in its own form (fix wave 1)', () => {
  const ENDS = '@mode: figure\nO = (0, 0, 0)\nP = (0, 0, 4)'

  it('points equal rims at the cylinder between the same two centres', () => {
    expect(walk(`${ENDS}\nF = solid frustum from O radius 3 to P radius 3`).errors.map((e) => e.message)).toEqual([
      'A frustum whose top equals its radius is a cylinder — write "cylinder from O to P radius 3"',
    ])
  })

  it('points a top of 0 at the cone with its apex there', () => {
    expect(walk(`${ENDS}\nF = solid frustum from O radius 3 to P radius 0`).errors.map((e) => e.message)).toEqual([
      'A frustum with top 0 is a cone — write "cone apex P base O radius 3"',
    ])
  })
})

describe('solids on points far from the origin (fix wave 1)', () => {
  it('builds a unit pyramid and a unit tetrahedron at (3e4, 3e4, 3e4)', () => {
    const scope = walk(
      '@mode: figure\nA = (30000, 30000, 30000)\nB = (30001, 30000, 30000)\nC = (30001, 30001, 30000)\nD = (30000, 30001, 30000)\n' +
        'E = (30000.5, 30000.5, 30001)\nP = solid pyramid A-B-C-D apex E\nT = solid tetrahedron A-B-D-E'
    )
    expect(scope.errors).toEqual([])
    expect(scope.solids.get('P')!.polyhedron!.faces).toHaveLength(5)
  })

  it('judges a thin tetrahedron far away by its own size: D 1e-5 above a unit base is not flat', () => {
    // Measured against the distance from the origin (5e4), 1e-5 would be
    // under GEOM_EPS * 5e4 = 5e-5 and refused; against the solid's own
    // spread it is ten thousand times the tolerance.
    const scope = walk(
      '@mode: figure\nA = (30000, 30000, 30000)\nB = (30001, 30000, 30000)\nC = (30000, 30001, 30000)\n' +
        'D = (30000.3, 30000.3, 30000.00001)\nT = solid tetrahedron A-B-C-D'
    )
    expect(scope.errors).toEqual([])
    expect(scope.solids.get('T')!.polyhedron!.faces).toHaveLength(4)
  })
})

describe('fix round 2 — refusals in the form the author wrote', () => {
  // n corners of a regular polygon of circumradius 5 in the plane z = 0,
  // counter-clockwise from above, named Pa, Pb, ...
  function ring(n: number): { names: string[]; lines: string } {
    const names = Array.from({ length: n }, (_, i) => `P${String.fromCharCode(97 + i)}`)
    const lines = names
      // Fixed-point: the DSL does not read "3e-16" (handoff, open item 4).
      .map((name, i) => `${name} = (${(5 * Math.cos((2 * Math.PI * i) / n)).toFixed(12)}, ${(5 * Math.sin((2 * Math.PI * i) / n)).toFixed(12)}, 0)`)
      .join('\n')
    return { names, lines }
  }

  it('refuses a prism on a 13-corner base as a prism, not as "a hull of 26 points"', () => {
    const { names, lines } = ring(13)
    expect(walk(`@mode: figure\n${lines}\nQ = solid prism ${names.join('-')} height 2`).errors.map((e) => e.message)).toEqual([
      'A prism on a 13-corner base has 26 vertices — at most 24',
    ])
  })

  it('refuses a pyramid on a 24-corner base as a pyramid', () => {
    const { names, lines } = ring(24)
    expect(walk(`@mode: figure\n${lines}\nV = (0, 0, 6)\nQ = solid pyramid ${names.join('-')} apex V`).errors.map((e) => e.message)).toEqual([
      'A pyramid on a 24-corner base has 25 vertices — at most 24',
    ])
  })

  it('points a frustum from a rim of radius 0 at the cone with its apex there', () => {
    const ends = '@mode: figure\nO = (0, 0, 0)\nP = (0, 0, 4)'
    expect(walk(`${ends}\nF = solid frustum from O radius 0 to P radius 3`).errors.map((e) => e.message)).toEqual([
      'A frustum with radius 0 at O is a cone — write "cone apex O base P radius 3"',
    ])
  })
})

// ---------------------------------------------------------------------------
// Phase 8, Task 1 — planes as objects
// ---------------------------------------------------------------------------

describe('planes as objects (phase 8, Q2)', () => {
  function walkAny(spec: string) {
    const parsed = parseSpec(spec)
    expect(parsed.errors).toEqual([])
    return buildSolidFigure(parsed.statements, value)
  }

  function plane(scope: ReturnType<typeof walk>, name: string) {
    const p = scope.planes.get(name)
    if (!p) throw new Error(`no plane ${name}: ${scope.errors.map((e) => e.message).join('; ')}`)
    return { point: worldToAuthor(p.point), normal: worldToAuthor(p.normal) }
  }

  function expectParallel(n: Vec3, to: Vec3): void {
    const len = Math.hypot(to.x, to.y, to.z)
    const along = (n.x * to.x + n.y * to.y + n.z * to.z) / len
    expect(Math.abs(along)).toBeCloseTo(1, 12)
  }

  it('binds a plane through O perpendicular to A-G: it contains O, and its normal is along (1, 1, 1)', () => {
    const scope = walk(`${CUBE}\nO = midpoint A-G\np = plane through O perpendicular to A-G`)
    expect(scope.errors).toEqual([])
    const p = plane(scope, 'p')
    expectParallel(p.normal, { x: 1, y: 1, z: 1 })
    // O = (1/2, 1/2, 1/2) lies on it.
    const o = { x: 0.5 - p.point.x, y: 0.5 - p.point.y, z: 0.5 - p.point.z }
    expect(o.x * p.normal.x + o.y * p.normal.y + o.z * p.normal.z).toBeCloseTo(0, 12)
  })

  it('binds a plane through P parallel to A-B-C: parallel, and through P', () => {
    const scope = walk(`${CUBE}\nP = (3, -2, 5)\np = plane through P parallel to A-B-C`)
    expect(scope.errors).toEqual([])
    const p = plane(scope, 'p')
    // A-B-C is the floor z = 0, so the parallel plane is z = 5.
    expectParallel(p.normal, { x: 0, y: 0, z: 1 })
    expect((5 - p.point.z) * p.normal.z).toBeCloseTo(0, 12)
    // ...and to a named plane, the same.
    const named = walk(`${CUBE}\nP = (3, -2, 5)\nq = plane A-B-C\np = plane through P parallel to q`)
    expect(named.errors).toEqual([])
    expectParallel(plane(named, 'p').normal, { x: 0, y: 0, z: 1 })
  })

  it('reads an equation plane in the author frame', () => {
    const scope = walk(`${CUBE}\np = plane 2x + y - z = 3`)
    const p = plane(scope, 'p')
    expectParallel(p.normal, { x: 2, y: 1, z: -1 })
    expect(2 * p.point.x + p.point.y - p.point.z).toBeCloseTo(3, 12)
  })

  it('drops the same foot to a named plane as to the plane it names', () => {
    const spec = [
      '@mode: figure',
      'M = (1, 0, 0)',
      'N = (0, 2, 0)',
      'P = (0, 0, 3)',
      'A = (3, 3, 3)',
      'p = plane M-N-P',
      'F = foot A to plane p',
      'G = foot A to plane M-N-P',
    ].join('\n')
    const scope = walk(spec)
    expect(scope.errors).toEqual([])
    const f = authorPoint(scope, 'F')
    const g = authorPoint(scope, 'G')
    expectAt(scope, 'F', g.x, g.y, g.z)
    // And it IS the foot: 6x + 3y + 2z = 6 is the plane M-N-P, so F lies on it.
    expect(6 * f.x + 3 * f.y + 2 * f.z).toBeCloseTo(6, 12)
  })

  it('refuses to rebind a plane, and a plane name used as a point, naming it a plane', () => {
    const rebound = walkAny(`${CUBE}\np = plane A-B-C\np = plane A-B-G`)
    expect(rebound.errors.map((e) => e.message)).toEqual(['"p" is already bound to a plane — pick a different name rather than redefining it'])
    const asPoint = walkAny(`${CUBE}\np = plane A-B-C\nM = midpoint p-G`)
    expect(asPoint.errors.map((e) => e.message)).toEqual([expect.stringMatching(/^"p" is a plane, not a point/)])
    // A point's name used as a plane operand is refused the other way round.
    const asPlane = walkAny(`${CUBE}\nF = foot A to plane G`)
    expect(asPlane.errors.map((e) => e.message)).toEqual([expect.stringMatching(/^"G" is a point in space, not a plane/)])
    // And a plane may not take a point's name.
    const clash = walkAny(`${CUBE}\nG = plane A-B-C`)
    expect(clash.errors.map((e) => e.message)).toEqual([expect.stringMatching(/^"G" is already bound to a point in space/)])
  })

  it('refuses collinear points and a line of zero length, quoting the plane as written', () => {
    const collinear = walkAny(`${CUBE}\nM = midpoint A-G\np = plane A-M-G`)
    expect(collinear.errors.map((e) => e.message)).toEqual([expect.stringMatching(/A, M and G are collinear/)])
    const zero = walkAny(`${CUBE}\nK = (1, 0, 0)\np = plane through A perpendicular to B-K`)
    expect(zero.errors.map((e) => e.message)).toEqual([
      'plane through A perpendicular to B-K: B and K are the same point, so B-K has no direction to be perpendicular to',
    ])
  })

  it('canonicalises the plane a cut is made by: A-B-C at author z = 1 is the axis plane z = 1', () => {
    const scope = walk(
      '@mode: figure\nS = solid prism 8 by 5 by 6\nA = (0, 0, 1)\nB = (1, 0, 1)\nC = (0, 1, 1)\ncut: S by plane A-B-C\ncut: S by plane x + z = 1'
    )
    expect(scope.errors).toEqual([])
    // Directives are not statements: the cut is statement 4.
    expect(scope.sectionPlanes.get(4)).toEqual({ plane: { kind: 'axis', axis: 'y', at: 1, source: 'A-B-C' } })
    expect(scope.sectionPlanes.get(5)).toMatchObject({ plane: { kind: 'general', source: 'x + z = 1' } })
  })
})

describe('what phase 8 does not draw (Q7)', () => {
  it('refuses the line two planes meet in, saying what intersect takes', () => {
    const parsed = parseSpec(`${CUBE}\nX = intersect plane A-B-C, plane A-B-E`)
    const scope = buildSolidFigure(parsed.statements, value)
    expect(scope.errors.map((e) => e.message)).toEqual([expect.stringMatching(/two planes meet in a line, and the line of two planes is not drawn yet/)])
  })
})
