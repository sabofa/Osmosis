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
