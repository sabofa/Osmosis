import { describe, expect, it } from 'vitest'
import { evalExpr } from '../parser/evalExpr'
import { parseSpec } from '../parser/parseSpec'
import type { Expr } from '../parser/types'
import { LIGHT_PALETTE } from '../render/palette'
import { worldToAuthor } from './authorFrame'
import type { Vec3 } from './project3d'
import { renderFigure } from './render'
import { buildSolidFigure } from './solidScope'

// Phase 10, Task 1 — angles, distances and dihedrals in space (M3, M5), and
// the common perpendicular of two lines (M6). Every expected value below is
// computed by hand from the author-frame coordinates written in the spec,
// never read back from the engine.

const value = (e: Expr) => evalExpr(e, {}, 'radians', {})

function rendered(spec: string) {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
}

function errorsOf(spec: string): string[] {
  return rendered(spec).errors.map((e) => e.message)
}

// The inner markup of one layer.
function layer(svg: string, name: string): string {
  const selfClosing = `<g data-layer="${name}"/>`
  if (svg.includes(selfClosing)) return ''
  const open = `<g data-layer="${name}">`
  const start = svg.indexOf(open)
  if (start < 0) throw new Error(`no layer "${name}" in output`)
  const from = start + open.length
  return svg.slice(from, svg.indexOf('</g>', from))
}

// The unit cube by its eight corners, lettered as the plan writes it.
const CUBE = [
  '@mode: figure',
  'A = (0, 0, 0)',
  'B = (1, 0, 0)',
  'C = (1, 1, 0)',
  'D = (0, 1, 0)',
  'E = (0, 0, 1)',
  'F = (1, 0, 1)',
  'G = (1, 1, 1)',
  'H = (0, 1, 1)',
].join('\n')

const DEGREES = (radians: number) => (radians * 180) / Math.PI

// A stated value exactly as JS prints it: a plain decimal literal, which is
// what the asserting form accepts.
const exactly = (n: number) => String(n)

// Asserts both ways: the true value passes, a wrong one is refused naming
// the subject. So neither half can pass vacuously.
function assertsBothWays(spec: string, row: string, truth: number, wrong: number): void {
  expect(errorsOf(`${spec}\n${row} = ${exactly(truth)}`)).toEqual([])
  const refused = errorsOf(`${spec}\n${row} = ${exactly(wrong)}`)
  expect(refused).toHaveLength(1)
  expect(refused[0]).toContain('disagrees with the figure')
}

describe('measures between lines and planes, in the givens table (M5)', () => {
  const spec = `@angle: degrees\n${CUBE}`

  it('measures the angle between two skew face diagonals: 60 degrees', () => {
    // Directions (1,1,0) and (0,1,1): cos = 1 / (sqrt2 sqrt2) = 1/2.
    assertsBothWays(spec, 'given: angle between A-C and B-G', 60, 45)
  })

  it('takes the ACUTE angle between the two lines, whichever way each is written', () => {
    // C-A runs (-1,-1,0): the rays meet at 120 degrees, the lines at 60.
    assertsBothWays(spec, 'given: angle between C-A and B-G', 60, 120)
  })

  it('measures the angle between a space diagonal and the base: arcsin(1/sqrt3)', () => {
    // AG = (1,1,1), the base's normal is z: sin = 1/sqrt3.
    assertsBothWays(spec, 'given: angle between A-G and plane A-B-C', DEGREES(Math.asin(1 / Math.sqrt(3))), 45)
  })

  it('takes a line–plane angle against any plane form', () => {
    // The plane x + y + z = 1 has normal (1,1,1), along AG: 90 degrees.
    assertsBothWays(spec, 'given: angle between A-G and plane x + y + z = 1', 90, 80)
    // A-B lies along x, parallel to the plane z = 3: 0 degrees.
    expect(errorsOf(`${spec}\np = plane z = 3\ngiven: angle between A-B and plane p = 0`)).toEqual([])
  })

  it('measures the distance between skew lines: sqrt2 / 2', () => {
    assertsBothWays(CUBE, 'given: distance between A-G and B-F', Math.SQRT1_2, 1)
  })

  it('measures 0 between lines that meet, and the gap between parallel ones', () => {
    expect(errorsOf(`${CUBE}\ngiven: distance between A-B and A-D = 0`)).toEqual([])
    // A-B and H-G are parallel, one face diagonal apart: sqrt2.
    assertsBothWays(CUBE, 'given: distance between A-B and H-G', Math.SQRT2, 1)
  })

  it('measures the distance from G to the plane B-D-E, x + y + z = 1: 2/sqrt3', () => {
    assertsBothWays(CUBE, 'given: distance from G to plane B-D-E', 2 / Math.sqrt(3), 1)
  })

  it('measures the distance from G to the line A-B: sqrt2', () => {
    assertsBothWays(CUBE, 'given: distance from G to line A-B', Math.SQRT2, 1)
    // "line" is optional.
    expect(errorsOf(`${CUBE}\ngiven: distance from G to A-B = ${exactly(Math.SQRT2)}`)).toEqual([])
  })

  it('takes every form as a "find:" row too', () => {
    const svg = rendered(`${spec}\nfind: angle between A-C and B-G\nfind: distance from G to plane B-D-E`).svg
    expect(layer(svg, 'labels')).toContain('>FIND</text>')
    expect(layer(svg, 'labels')).toContain('>60°</text>')
    expect(layer(svg, 'labels')).toContain('>1.155</text>')
  })

  it('writes each form in readable notation in the table', () => {
    const rows = [
      'given: angle between A-C and B-G',
      'given: angle between A-G and plane A-B-C',
      'given: distance between A-G and B-F',
      'given: distance from G to plane B-D-E',
      'given: distance from G to line A-B',
    ]
    const labels = layer(rendered(`${spec}\n${rows.join('\n')}`).svg, 'labels')
    for (const text of ['∠(AC, BG)', '∠(AG, ABC)', 'd(AG, BF)', 'd(G, BDE)', 'd(G, AB)']) expect(labels).toContain(`>${text}</text>`)
    // And the values, computed: 60, 35.264, 0.707, 1.155, 1.414.
    for (const text of ['60°', '35.264°', '0.707', '1.155', '1.414']) expect(labels).toContain(`>${text}</text>`)
  })

  it('refuses an inline label on these forms, pointing at the table', () => {
    const parsed = parseSpec(`${CUBE}\nlabel: angle between A-C and B-G`)
    expect(parsed.errors).toHaveLength(1)
    expect(parsed.errors[0].message).toContain('"given: angle between A-C and B-G"')
    const distance = parseSpec(`${CUBE}\nlabel: distance from G to plane B-D-E`)
    expect(distance.errors[0].message).toContain('"given: distance from G to plane B-D-E"')
  })

  it('refuses these forms on points in the plane, legibly', () => {
    const errors = errorsOf('@mode: figure\nA = (0, 0)\nB = (1, 0)\nC = (0, 1)\nD = (1, 1)\ngiven: distance between A-B and C-D')
    expect(errors).toEqual([expect.stringMatching(/"distance between A-B and C-D" is measured in space.*A is a point in the plane/)])
  })
})

describe('dihedral angles (M3)', () => {
  it('measures the cube\'s dihedral along BC between faces BCA and BCG: 90 degrees', () => {
    // A is not in the plane through M square to BC, so this is the case that
    // needs the perpendicular component: (A - M) . BC != 0.
    assertsBothWays(`@angle: degrees\n${CUBE}`, 'given: dihedral A-B-C-G', 90, 80)
  })

  it('names the true value when an assertion fails', () => {
    const refused = errorsOf(`@angle: degrees\n${CUBE}\ngiven: dihedral A-B-C-G = 80`)
    expect(refused).toEqual([expect.stringContaining('"dihedral A-B-C-G = 80" disagrees with the figure — the geometry gives 90')])
  })

  it('measures a dihedral where no end point is square to the edge', () => {
    // Edge A-B along x; C in the xy-plane (+y side), D in the xz-plane (+z
    // side): the half-planes are square, 90 degrees. C - M = (2,1,0) and
    // D - M = (-2,0,1) are not square to the edge; their raw angle is
    // arccos(-4/5), 143.13 degrees.
    const spec = '@mode: figure\n@angle: degrees\nA = (0, 0, 0)\nB = (2, 0, 0)\nC = (3, 1, 0)\nD = (-1, 0, 1)'
    assertsBothWays(spec, 'given: dihedral C-A-B-D', 90, DEGREES(Math.acos(-4 / 5)))
  })

  it("measures a regular tetrahedron's dihedral along any edge: arccos(1/3)", () => {
    const spec = '@mode: figure\nT = solid tetrahedron edge 6 vertices ABCD'
    const truth = Math.acos(1 / 3)
    for (const row of ['given: dihedral C-A-B-D', 'given: dihedral A-B-C-D', 'given: dihedral A-C-D-B', 'given: dihedral B-A-D-C']) {
      assertsBothWays(spec, row, truth, 1.2)
    }
  })

  it("measures an octahedron's dihedral: arccos(-1/3)", () => {
    // Equator ABCD, top E, bottom F: along AB between the upper and lower
    // faces, and along AE between two upper faces.
    const spec = '@mode: figure\nO = solid octahedron edge 6 vertices ABCDEF'
    assertsBothWays(spec, 'given: dihedral E-A-B-F', Math.acos(-1 / 3), 1.9)
    assertsBothWays(spec, 'given: dihedral B-A-E-D', Math.acos(-1 / 3), 1.9)
  })

  it('reads 60 degrees in the AIME 2016 I hexagonal prism of height sqrt(108)', () => {
    // A is 6 from BF (12 cos 60), and the face GBF rises sqrt(108) over it:
    // tan = sqrt(108) / 6 = sqrt3.
    const spec = '@mode: figure\n@angle: degrees\nS = solid prism regular 6 side 12, height sqrt(108) vertices ABCDEFGHIJKL'
    assertsBothWays(spec, 'given: dihedral A-B-F-G', 60, 45)
  })

  it('prints the value in the unit "@angle" selects: pi/2 as 1.571 in radians', () => {
    expect(layer(rendered(`${CUBE}\ngiven: dihedral A-B-C-G`).svg, 'labels')).toContain('>1.571</text>')
    expect(layer(rendered(`@angle: degrees\n${CUBE}\ngiven: dihedral A-B-C-G`).svg, 'labels')).toContain('>90°</text>')
  })

  it('writes the dihedral in the table as its edge between its two ends', () => {
    expect(layer(rendered(`${CUBE}\ngiven: dihedral A-B-C-G`).svg, 'labels')).toContain('>∠A-BC-G</text>')
  })

  it('refuses a dihedral whose edge is one point, or whose end lies on the edge line', () => {
    expect(errorsOf(`${CUBE}\ngiven: dihedral A-B-B-G`)).toEqual([expect.stringMatching(/B and B are the same point/)])
    // K = (2, 0, 0) is on the line A-B, beyond B: no half-plane at the edge.
    const onEdge = errorsOf(`${CUBE}\nK = (2, 0, 0)\ngiven: dihedral K-A-B-G`)
    expect(onEdge).toEqual([expect.stringMatching(/K lies on the line A-B/)])
  })
})

describe('the common perpendicular of two lines (M6)', () => {
  const spec = `${CUBE}\nP, Q = common perpendicular of A-G and B-F`

  it('binds P = (1/2, 1/2, 1/2) on A-G and Q = (1, 0, 1/2) on B-F', () => {
    const parsed = parseSpec(spec)
    expect(parsed.errors).toEqual([])
    const scope = buildSolidFigure(parsed.statements, value)
    expect(scope.errors).toEqual([])
    const author = (name: string): Vec3 => worldToAuthor(scope.points.get(name)!)
    const p = author('P')
    const q = author('Q')
    expect(p.x).toBeCloseTo(0.5, 12)
    expect(p.y).toBeCloseTo(0.5, 12)
    expect(p.z).toBeCloseTo(0.5, 12)
    expect(q.x).toBeCloseTo(1, 12)
    expect(q.y).toBeCloseTo(0, 12)
    expect(q.z).toBeCloseTo(0.5, 12)
  })

  it('draws P and Q as points in space, and labels PQ with sqrt2 / 2', () => {
    const result = rendered(`${spec}\nsegment: P-Q\nlabel: PQ`)
    expect(result.errors).toEqual([])
    expect(layer(result.svg, 'points')).toContain('data-object="P"')
    expect(layer(result.svg, 'points')).toContain('data-object="Q"')
    expect(layer(result.svg, 'labels')).toContain('>0.707</text>')
    expect(errorsOf(`${spec}\nlabel: PQ = ${exactly(Math.SQRT1_2)}`)).toEqual([])
  })

  it('makes PQ square to both lines, so a right-angle mark at P and at Q is true', () => {
    expect(errorsOf(`${spec}\ngiven: angle APQ = ${exactly(Math.PI / 2)}\ngiven: angle BQP = ${exactly(Math.PI / 2)}`)).toEqual([])
  })

  it('refuses parallel lines: the common perpendicular is not unique', () => {
    expect(errorsOf(`${CUBE}\nP, Q = common perpendicular of A-B and D-C`)).toEqual([
      'P, Q = common perpendicular of A-B and D-C: A-B and D-C are parallel, so their common perpendicular is not unique',
    ])
  })

  it('refuses lines that meet, naming where', () => {
    expect(errorsOf(`${CUBE}\nP, Q = common perpendicular of A-B and A-D`)).toEqual([
      'P, Q = common perpendicular of A-B and A-D: A-B and A-D meet at a point, (0, 0, 0), so their common perpendicular has zero length',
    ])
  })

  it('binds exactly two names', () => {
    expect(errorsOf(`${CUBE}\nP = common perpendicular of A-G and B-F`)).toEqual([
      expect.stringMatching(/has two feet, one on each line, so it binds two names/),
    ])
  })
})
