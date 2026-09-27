import { describe, expect, it } from 'vitest'
import { evalExpr } from '../parser/evalExpr'
import { parseSpec } from '../parser/parseSpec'
import { parseStatement } from '../parser/parseStatement'
import { LIGHT_PALETTE } from '../render/palette'
import { resolveMode } from '../scene/mode'
import { GEOM_EPS } from '../scene/geometry/types'
import { distance3, midpoint3 } from './construct3d'
import { netSolidWord } from './nets'
import type { Vec3 } from './project3d'
import { renderFigure } from './render'
import { facesHolding, shortestPath } from './shortestPath'
import { buildSolidFigure } from './solidScope'

// The path between two named points over the solid S of a spec.
function pathIn(spec: string, from: string, to: string, name = 'S') {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  const scope = buildSolidFigure(parsed.statements, (e) => evalExpr(e, {}, parsed.config.angle, {}))
  expect(scope.errors).toEqual([])
  const body = scope.solids.get(name)!
  const ends: [Vec3, Vec3] = [scope.points.get(from)!, scope.points.get(to)!]
  return { body, find: () => shortestPath(body, name, netSolidWord(body), ends, [from, to], scope.vertexNames.get(body) ?? []) }
}

function render(spec: string) {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
}

// A unit cube by points, A at the origin and G at (1, 1, 1).
const CUBE = `A = (0, 0, 0)
B = (1, 0, 0)
C = (1, 1, 0)
D = (0, 1, 0)
S = solid prism A-B-C-D height 1 vertices EFGH`

// Dudeney's room: 30 long (Y), 12 wide (X), 12 high (Z), placed by its
// corners so the two end walls are y = 0 and y = 30. The spider is on the
// y = 0 wall's centre line (x = 6), 1 below the ceiling; the fly on the
// y = 30 wall's centre line, 1 above the floor.
const ROOM = `A = (0, 0, 0)
B = (12, 0, 0)
C = (12, 30, 0)
D = (0, 30, 0)
S = solid prism A-B-C-D height 12 vertices EFGH
P = (6, 0, 11)
Q = (6, 30, 1)`

describe('shortest paths over polyhedra (N3)', () => {
  it('goes corner to corner over a unit cube in √5, across two faces through the middle of an edge — not the space diagonal √3', () => {
    const { body, find } = pathIn(CUBE, 'A', 'G')
    const path = find()
    // Unfold two adjacent faces into a 2-by-1 rectangle: A and G are its
    // opposite corners, √(2² + 1²) = √5.
    expect(path.length).toBeCloseTo(Math.sqrt(5), 12)
    expect(Math.abs(path.length - Math.sqrt(3))).toBeGreaterThan(0.5)
    expect(path.faces).toHaveLength(2)
    expect(path.onSolid).toHaveLength(3)
    // The crossing is the midpoint of the edge the two faces share.
    const solid = body.polyhedron!
    const edges = solid.faces.flatMap((face) => face.map((v, i) => [solid.vertices[v], solid.vertices[face[(i + 1) % face.length]]] as const))
    expect(edges.some(([a, b]) => distance3(midpoint3(a, b), path.onSolid[1]) < 1e-12)).toBe(true)
    // Both drawn segments lie on faces of the cube: each one's ends and
    // middle lie on one common face.
    for (let i = 0; i < 2; i++) {
      const [a, b] = [path.onSolid[i], path.onSolid[i + 1]]
      const common = [a, b, midpoint3(a, b)].map((p) => new Set(facesHolding(solid, p, GEOM_EPS))).reduce((x, y) => new Set([...x].filter((f) => y.has(f))))
      expect(common.size).toBeGreaterThan(0)
    }
  })

  it("finds Dudeney's spider-and-fly path of 40 across five faces, beating the naive 42", () => {
    const { find } = pathIn(ROOM, 'P', 'Q')
    const path = find()
    // Unfolded across end wall, ceiling, side wall, floor and end wall, the
    // path is the hypotenuse of legs 1 + 30 + 1 = 32 and 6 + 12 + 6 = 24:
    // √(1024 + 576) = 40. Straight over the ceiling and down is
    // 1 + 30 + 11 = 42.
    expect(path.length).toBeCloseTo(40, 10)
    expect(path.faces).toHaveLength(5)
    expect(path.length).toBeLessThan(42 - 1)
  })

  it('joins two points on one face by the straight segment', () => {
    // On the floor, (1, 1, 0) to (4, 5, 0): √(9 + 16) = 5.
    const { find } = pathIn(`${ROOM}\nM = (1, 1, 0)\nN = (4, 5, 0)`, 'M', 'N')
    const path = find()
    expect(path.length).toBeCloseTo(5, 12)
    expect(path.faces).toHaveLength(1)
  })

  // Built so that an INVALID unfolding is shorter. A square frustum on
  // points: base 6 by 6 at z = 0, top 2 by 2 at z = 1, centred. E = (2, 2, 1)
  // is a top corner and Q = (3, 1, 0.5) lies on the front side face (the
  // plane y = 2z through A, B, F, E). Both are on that face, so the path is
  // the straight segment, √(1² + 1² + 0.5²) = 1.5 exactly. Unfolding the
  // chain top -> right -> back -> left -> front instead turns the front face
  // round the top by the four top corners' angle deficits and puts Q' only
  // 1.12 from E' — a straight line through where the top face is, crossing
  // no edge it must, in order, within its extent. Only the in-order crossing
  // check stands between that chain and the answer.
  it('refuses an unfolding whose straight line misses the edges it must cross, even when it is shorter', () => {
    const spec = `A = (0, 0, 0)
B = (6, 0, 0)
C = (6, 6, 0)
D = (0, 6, 0)
E = (2, 2, 1)
F = (4, 2, 1)
G = (4, 4, 1)
H = (2, 4, 1)
Q = (3, 1, 0.5)
S = solid hull A-B-C-D-E-F-G-H`
    const { find } = pathIn(spec, 'E', 'Q')
    const path = find()
    expect(path.length).toBeCloseTo(1.5, 12)
    expect(path.faces).toHaveLength(1)
  })

  it('refuses a point off the surface, naming it', () => {
    const { find } = pathIn(`${CUBE}\nM = (0.5, 0.5, 0.5)`, 'A', 'M')
    expect(() => find()).toThrow('M is not on the surface of "S" — a shortest path runs over the surface of the prism, so both its ends must lie on it')
  })

  it('refuses a solid of more than 12 faces: a regular 12-gon prism has 14', () => {
    const { find } = pathIn('S = solid prism regular 12 side 1, height 2 vertices ABCDEFGHIJKLMNOPQRSTUVWX', 'A', 'X')
    expect(() => find()).toThrow('"S" has 14 faces — shortest paths are found over solids of at most 12 faces')
  })

  it('unfolds the cube path onto a strip of 2 faces and 1 fold, the path one straight segment √5 long', () => {
    const { find } = pathIn(CUBE, 'A', 'G')
    const { net, from, to } = find().flat
    expect(net.faces).toHaveLength(2)
    expect(net.lines.filter((l) => l.fold)).toHaveLength(1)
    expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeCloseTo(Math.sqrt(5), 12)
    // Turned so the path runs left to right.
    expect(to.y - from.y).toBeCloseTo(0, 12)
    expect(to.x).toBeGreaterThan(from.x)
  })
})

// ---------------------------------------------------------------------------
// shortest: in a figure
// ---------------------------------------------------------------------------

function lines(svg: string, statement: number, object?: string) {
  return [...svg.matchAll(/<line x1="([^"]*)" y1="([^"]*)" x2="([^"]*)" y2="([^"]*)"([^>]*)\/>/g)]
    .filter((m) => m[5].includes(`data-statement="${statement}"`) && (object === undefined || m[5].includes(`data-object="${object}"`)))
    .map((m) => ({ x1: Number(m[1]), y1: Number(m[2]), x2: Number(m[3]), y2: Number(m[4]), attrs: m[5] }))
}

function layer(svg: string, name: string): string {
  if (svg.includes(`<g data-layer="${name}"/>`)) return ''
  const open = `<g data-layer="${name}">`
  const start = svg.indexOf(open) + open.length
  return svg.slice(start, svg.indexOf('</g>', start))
}

describe('shortest: in a figure', () => {
  it('draws the path on the cube piece by piece: the piece on a hidden face dashed, the one on a visible face solid', () => {
    // Under the standard camera (from +X, +Y, above) the face x = 0 is
    // hidden and y = 1 is seen; the path crosses from one to the other.
    const { svg, errors } = render(`${CUBE}\nshortest: A to G over S`)
    expect(errors).toEqual([])
    const pieces = lines(svg, 5, 'path-AG')
    expect(pieces).toHaveLength(2)
    expect(lines(layer(svg, 'auxiliary'), 5, 'path-AG').filter((l) => l.attrs.includes('stroke-dasharray'))).toHaveLength(1)
    expect(lines(layer(svg, 'primary'), 5, 'path-AG').filter((l) => !l.attrs.includes('stroke-dasharray'))).toHaveLength(1)
  })

  it('lifts the strip with "unfold", after an earlier lift, the path straight across it', () => {
    const { svg, errors } = render(`${CUBE}\nsection: S by plane z = 0.5 vertices PQRT\nshortest: A to G over S unfold`)
    expect(errors).toEqual([])
    const section = lines(svg, 5)
    const strip = lines(svg, 6).filter((l) => /data-object="(fold|cut)-/.test(l.attrs))
    expect(strip.filter((l) => l.attrs.includes('data-object="fold-'))).toHaveLength(1)
    expect(strip.filter((l) => l.attrs.includes('data-object="cut-'))).toHaveLength(6)
    const sectionRight = Math.max(...section.flatMap((l) => [l.x1, l.x2]))
    expect(Math.min(...strip.flatMap((l) => [l.x1, l.x2]))).toBeGreaterThan(sectionRight)
    // On the solid (two pieces) and once, straight, on the strip.
    expect(lines(svg, 6, 'path-AG')).toHaveLength(3)
  })

  it('prints the length on the path, and checks an asserted one', () => {
    const labelled = render(`${ROOM}\nshortest: P to Q over S\nlabel: shortest P to Q over S`)
    expect(labelled.errors).toEqual([])
    expect(labelled.svg).toContain('>40<')
    expect(render(`${ROOM}\nlabel: shortest P to Q over S = 40`).errors).toEqual([])
    expect(render(`${ROOM}\nlabel: shortest P to Q over S = 42`).errors.map((e) => e.message).join()).toMatch(/shortest P to Q over S/)
  })

  it('states the length in the givens table', () => {
    const { svg, errors } = render(`${ROOM}\ngiven: shortest P to Q over S = 40`)
    expect(errors).toEqual([])
    expect(svg).toContain('shortest PQ over S')
  })

  it('reports a refusal as an error and draws the rest', () => {
    const { svg, errors } = render(`${CUBE}\nM = (0.5, 0.5, 0.5)\nshortest: A to M over S`)
    expect(errors.map((e) => e.message)).toEqual(['M is not on the surface of "S" — a shortest path runs over the surface of the prism, so both its ends must lie on it'])
    expect(svg.startsWith('<svg ')).toBe(true)
  })

  it('infers a solid figure', () => {
    const parsed = parseSpec('A = (0, 0, 0)\nshortest: A to B over S')
    expect(resolveMode(parsed.statements, parsed.config)).toBe('figure')
  })
})

describe('the shortest: grammar (N5)', () => {
  it('reads the statement, with and without unfold', () => {
    expect(parseStatement('shortest: P to Q over S')).toEqual({ kind: 'shortestPath', from: 'P', to: 'Q', solid: 'S', unfold: false, color: null, statementName: null })
    expect(parseStatement('shortest: P to Q over S unfold')).toMatchObject({ kind: 'shortestPath', unfold: true })
    expect(() => parseStatement('shortest: P over S')).toThrow('Expected "shortest: P to Q over S" — two point names and a solid — got "P over S"')
  })

  it('reads the measure in a label and a given', () => {
    expect(parseStatement('label: shortest P to Q over S = 40')).toMatchObject({
      kind: 'measureLabel',
      subject: { kind: 'shortestPath', from: 'P', to: 'Q', solid: 'S' },
      content: { kind: 'stated', value: 40 },
    })
    expect(parseStatement('find: shortest P to Q over S')).toMatchObject({ kind: 'given', section: 'find', entry: { subject: { kind: 'shortestPath' } } })
  })

  it('still reads "shortest = 3", "shortest(x) = x^2" and "shortest + x = y" as at base', () => {
    // The base commit d2b91e8's own output, verbatim.
    expect(parseStatement('shortest = 3')).toEqual({ kind: 'constantDef', name: 'shortest', value: { kind: 'num', value: 3 }, color: null, statementName: null })
    expect(parseStatement('shortest(x) = x^2')).toEqual({
      kind: 'functionDef',
      name: 'shortest',
      param: 'x',
      body: { kind: 'binary', op: '^', left: { kind: 'var', name: 'x' }, right: { kind: 'num', value: 2 } },
      color: null,
      statementName: null,
    })
    expect(parseStatement('shortest + x = y')).toEqual({
      kind: 'implicit',
      left: { kind: 'binary', op: '+', left: { kind: 'var', name: 'shortest' }, right: { kind: 'var', name: 'x' } },
      right: { kind: 'var', name: 'y' },
      color: null,
      statementName: null,
    })
  })
})

// ---------------------------------------------------------------------------
// Round solids (N4)
// ---------------------------------------------------------------------------

// AIME: a cone of radius 600 and height 200√7, so its slant is
// √(360000 + 280000) = 800. P is on the generator V-R, 125 from V; Q on the
// exactly opposite generator V-T, 375√2 from V. Unrolled, the sector is
// 2π · 600/800 = 3π/2 and half a turn round the cone is 3π/4 < π apart.
const AIME = `V = (0, 0, 200*sqrt(7))
O = (0, 0, 0)
R = (0, 600, 0)
T = (0, -600, 0)
K = solid cone apex V base O radius 600
P = divide V-R at 125:675
Q = divide V-T at 375*sqrt(2):800-375*sqrt(2)`

// A cone of radius 4 and height 3 (slant 5), upright: its apex is at
// Z = 1.5, and the point rho from the apex on the generator at local angle
// theta is (X, Y, Z) = (4 rho/5 sin theta, 4 rho/5 cos theta, 1.5 - 3 rho/5)
// (local x is author Y, local z author X). Sector 2π · 4/5 = 8π/5.
const WIDE = 'K = solid cone radius 4, height 3'

describe('shortest paths over round solids (N4)', () => {
  it('flies 625 over the AIME cone: √(125² + (375√2)² + 2 · 125 · 375√2 · √2/2)', () => {
    // cos(3π/4) = -√2/2, so the law of cosines gives
    // 15625 + 281250 + 93750 = 390625 = 625².
    const path = pathIn(AIME, 'P', 'Q', 'K').find()
    expect(path.length).toBeCloseTo(625, 9)
    // Drawn on the unrolling only: no geodesic on the solid.
    expect(path.onSolid).toEqual([])
  })

  it('unrolls points half a turn apart to the largest separation, πr/l = 4π/5 — still less than π', () => {
    // P: theta 0, rho 2 -> (0, 1.6, 0.3); Q: theta π, rho 5 (the rim) ->
    // (0, -4, -1.5). alpha = π · 4/5; cos(4π/5) = -(1 + √5)/4, so the length
    // is √(4 + 25 + 20(1 + √5)/4) = √(34 + 5√5).
    const path = pathIn(`${WIDE}\nP = (0, 1.6, 0.3)\nQ = (0, -4, -1.5)`, 'P', 'Q', 'K').find()
    expect(path.length).toBeCloseTo(Math.sqrt(34 + 5 * Math.sqrt(5)), 12)
  })

  // Correction to the plan, recorded: half a turn apart the two ways round
  // are EQUAL (alpha = 8π/5 - 4π/5), so the test above cannot tell the
  // shorter wrap from the longer. Three-quarters of a turn one way is a
  // quarter the other, and pins it.
  it('takes the separation the shorter way round: a quarter turn, not three quarters', () => {
    // P: theta 3π/4, rho 2 -> (0.8√2, -0.8√2, 0.3); Q: theta -3π/4, rho 5 ->
    // (-2√2, -2√2, -1.5). |d theta| = 3π/2 by the angles, π/2 the short way:
    // alpha = π/2 · 4/5 = 2π/5, cos(2π/5) = (√5 - 1)/4, so the length is
    // √(29 - 5(√5 - 1)) = √(34 - 5√5). The long way, 6π/5, would give
    // √(34 + 5√5).
    const spec = `${WIDE}\nP = (0.8*sqrt(2), -0.8*sqrt(2), 0.3)\nQ = (-2*sqrt(2), -2*sqrt(2), -1.5)`
    const path = pathIn(spec, 'P', 'Q', 'K').find()
    expect(path.length).toBeCloseTo(Math.sqrt(34 - 5 * Math.sqrt(5)), 12)
  })

  it('crosses a cylinder to the opposite generator in hypot(3π, 8)', () => {
    // r = 3, h = 10 (Z from -5 to 5): P at height 1, Q at height 9 on the
    // generator diametrically opposite. Half the rim, 3π, by 8 up.
    const spec = 'C = solid cylinder radius 3, height 10\nP = (0, 3, -4)\nQ = (0, -3, 4)'
    const path = pathIn(spec, 'P', 'Q', 'C').find()
    expect(path.length).toBeCloseTo(Math.hypot(3 * Math.PI, 8), 12)
  })

  it('wraps a cylinder the short way across the seam of the angles: k = -1 wins', () => {
    // P at local angle -170°, Q at +170° (author X = 3 sin theta, Y = 3 cos
    // theta), 4 apart in height. The angles differ by 340°; round the other
    // way it is 20° = π/9, an arc of 3π/9 = π/3: √(π²/9 + 16).
    const spec = 'C = solid cylinder radius 3, height 10\nP = (-3*sin(pi/18), -3*cos(pi/18), -3)\nQ = (3*sin(pi/18), -3*cos(pi/18), 1)'
    const path = pathIn(spec, 'P', 'Q', 'C').find()
    expect(path.length).toBeCloseTo(Math.sqrt((Math.PI * Math.PI) / 9 + 16), 12)
  })

  it('runs over a frustum clear of its top rim, and refuses a path that would cross it', () => {
    // r₁ = 4, r₂ = 1, h = 4: the virtual apex is at Z = -2 + 4 · 4/3 = 10/3,
    // the extended slant 20/3, the top rim 5/3 from the apex, the sector 6π/5.
    // Half a turn apart is alpha = 3π/5, whose half is 54°.
    // Far down, rho = 6 each ((0, ±3.6, -22/15)): the chord passes 6 cos 54°
    // = 3.53 from the apex, outside 5/3, and is 2 · 6 sin 54° = 3(1 + √5).
    const frustum = 'F = solid frustum radius 4, top 1, height 4'
    const clear = pathIn(`${frustum}\nP = (0, 3.6, -22/15)\nQ = (0, -3.6, -22/15)`, 'P', 'Q', 'F').find()
    expect(clear.length).toBeCloseTo(3 * (1 + Math.sqrt(5)), 12)
    // Near the top, rho = 2 each ((0, ±1.2, 26/15)): the chord would pass
    // 2 cos 54° = 1.18 from the apex, inside 5/3 — over the top rim.
    const { find } = pathIn(`${frustum}\nP = (0, 1.2, 26/15)\nQ = (0, -1.2, 26/15)`, 'P', 'Q', 'F')
    expect(() => find()).toThrow('The shortest path from P to Q over "F" would run along the top rim — not drawn')
  })

  it('refuses a point on a flat end, and a sphere', () => {
    const cap = pathIn('C = solid cylinder radius 3, height 10\nP = (0, 3, -4)\nQ = (1, 1, 5)', 'P', 'Q', 'C')
    expect(() => cap.find()).toThrow('Q is on a flat end of "C" — a shortest path over a cylinder is found on the curved side only')
    const ball = pathIn('S = solid sphere radius 3\nP = (0, 0, 3)\nQ = (0, 3, 0)', 'P', 'Q')
    expect(() => ball.find()).toThrow('"S" is a sphere — shortest paths are found over polyhedra of at most 12 faces and the curved sides of cylinders, cones and frusta')
  })

  it('draws the AIME path straight on the lifted unrolling, marks P and Q on the solid, and draws no geodesic in space', () => {
    const { svg, errors } = render(`${AIME}\nshortest: P to Q over K\nlabel: shortest P to Q over K`)
    expect(errors).toEqual([])
    expect(svg).toContain('>625<')
    // One straight segment, on the unrolling, right of the cone.
    const path = lines(svg, 7, 'path-PQ')
    expect(path).toHaveLength(1)
    const cone = [...svg.matchAll(/<path d="M ([^ ]+) [^"]*"[^>]*data-statement="4"/g)].map((m) => Number(m[1]))
    expect(Math.min(path[0].x1, path[0].x2)).toBeGreaterThan(Math.max(...cone))
    // The unrolling's outline: two radii and the arc, all solid (no rims
    // fold here: the path's unrolling is the curved side alone).
    expect(lines(svg, 7).filter((l) => l.attrs.includes('data-object="cut-seam"'))).toHaveLength(2)
    expect(svg).not.toMatch(/data-statement="7"[^>]*stroke-dasharray|stroke-dasharray[^>]*data-statement="7"/)
    // P and Q are dotted on the solid by their own statements.
    expect(layer(svg, 'points')).toMatch(/data-statement="5" data-object="P"/)
    expect(layer(svg, 'points')).toMatch(/data-statement="6" data-object="Q"/)
  })
})
