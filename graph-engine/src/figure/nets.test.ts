import { describe, expect, it } from 'vitest'
import { evalExpr } from '../parser/evalExpr'
import { parseSpec } from '../parser/parseSpec'
import { LIGHT_PALETTE } from '../render/palette'
import { resolveMode } from '../scene/mode'
import type { Vec2 } from '../scene/types'
import { liftOffset } from './crossSection'
import { hullOf } from './hull'
import { netOf, netOverlaps, netSeam, refuseOverlap, unrolledAngle, unrollingOf, type Net, type NetFace, type NetLine } from './nets'
import { DEFAULT_CAMERA } from './project3d'
import { toWorld } from './silhouette'
import { renderFigure } from './render'
import { buildSolidFigure } from './solidScope'
import { buildSolid } from './solids'

// The solid named `name` in a spec, its letters, and its net.
function built(spec: string, name = 'S') {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  const scope = buildSolidFigure(parsed.statements, (e) => evalExpr(e, {}, parsed.config.angle, {}))
  expect(scope.errors).toEqual([])
  const body = scope.solids.get(name)!
  const names = scope.vertexNames.get(body) ?? []
  return { body, names, net: () => netOf(body, name, names) }
}

const distance = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y)

function lineLength(line: NetLine): number {
  if (line.piece.kind !== 'segment') throw new Error('expected a segment')
  return distance(line.piece.a, line.piece.b)
}

function sides(face: NetFace): number[] {
  return face.corners.map((p, i) => distance(p, face.corners[(i + 1) % face.corners.length]))
}

function letterCounts(net: Net, names: readonly (string | undefined)[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const letter of net.letters) {
    const name = names[letter.vertex] ?? String(letter.vertex)
    counts[name] = (counts[name] ?? 0) + 1
  }
  return counts
}

function bounds(net: Net) {
  const points = net.faces.flatMap((f) => f.corners)
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  }
}

const faceNamed = (net: Net, names: readonly (string | undefined)[], letters: string) =>
  net.faces.find((f) => f.vertices.map((v) => names[v]).sort().join('') === [...letters].sort().join(''))!

describe('nets of polyhedra (N1, N2)', () => {
  it("unfolds a cube into the cross: 6 squares, 5 folds, 14 cut edges, 14 lettered corners", () => {
    const { net, names } = built('S = solid cube edge 2 vertices ABCDEFGH')
    const cross = net()
    expect(cross.faces).toHaveLength(6)
    // Every face a 2-by-2 square at true size: four sides of 2, diagonals 2√2.
    for (const face of cross.faces) {
      for (const side of sides(face)) expect(side).toBeCloseTo(2, 12)
      expect(distance(face.corners[0], face.corners[2])).toBeCloseTo(2 * Math.SQRT2, 12)
    }
    // A tree on 6 faces has 5 edges: the folds. 6 faces x 4 edges = 24 face
    // edges, each fold shared by two of them, so 24 - 2 x 5 = 14 cut edges —
    // the boundary, 14 x 2 = 28 long.
    const folds = cross.lines.filter((l) => l.fold)
    const cuts = cross.lines.filter((l) => !l.fold)
    expect(folds).toHaveLength(5)
    expect(cuts).toHaveLength(14)
    expect(cuts.reduce((sum, l) => sum + lineLength(l), 0)).toBeCloseTo(28, 12)
    // The cross: the strip ABFE BCGF CDHG DAEH (8 wide, 2 high), the base
    // below BCGF and the top above it — 8 by 6 in all, the caps over x 2..4.
    const box = bounds(cross)
    expect(box.maxX - box.minX).toBeCloseTo(8, 12)
    expect(box.maxY - box.minY).toBeCloseTo(6, 12)
    for (const cap of ['ABCD', 'EFGH']) {
      const face = faceNamed(cross, names, cap)
      expect(Math.min(...face.corners.map((p) => p.x))).toBeCloseTo(2, 12)
      expect(Math.max(...face.corners.map((p) => p.x))).toBeCloseTo(4, 12)
    }
    // Letters, derived by hand from the template. The strip's bottom row reads
    // A B C D A and its top row E F G H E (10 positions); the base hangs off
    // BC and adds new copies of A (under B) and D (under C); the top hangs off
    // FG and adds E (over F) and H (over G). So A: 2 + 1, B 1, C 1, D: 1 + 1,
    // E: 2 + 1, F 1, G 1, H: 1 + 1 — 14 in all.
    expect(letterCounts(cross, names)).toEqual({ A: 3, B: 1, C: 1, D: 2, E: 3, F: 1, G: 1, H: 2 })
    expect(cross.letters).toHaveLength(14)
  })

  it('lays a box out at true size: a strip 2(8 + 6) = 28 wide, the caps on lateral face 1', () => {
    const { net, names } = built('S = solid prism 8 by 5 by 6 vertices ABCDEFGH')
    const strip = net()
    // AB runs along the width (8), BC along the depth (6): ABFE, BCGF, CDHG,
    // DAEH are 8, 6, 8 and 6 wide, left to right from x = 0, 5 high.
    const lateral = ['ABFE', 'BCGF', 'CDHG', 'DAEH'].map((f) => faceNamed(strip, names, f))
    const lefts = [0, 8, 14, 22]
    lateral.forEach((face, i) => {
      expect(Math.min(...face.corners.map((p) => p.x))).toBeCloseTo(lefts[i], 12)
      expect(Math.min(...face.corners.map((p) => p.y))).toBeCloseTo(0, 12)
      expect(Math.max(...face.corners.map((p) => p.y))).toBeCloseTo(5, 12)
    })
    expect(Math.max(...lateral[3].corners.map((p) => p.x))).toBeCloseTo(28, 12)
    // ceil(4 / 2) - 1 = 1: both caps hang off BCGF (x 8..14), each the 6-by-8
    // base, true size — 8 below the strip and 8 above it.
    for (const [cap, from, to] of [
      ['ABCD', -8, 0],
      ['EFGH', 5, 13],
    ] as const) {
      const face = faceNamed(strip, names, cap)
      expect(Math.min(...face.corners.map((p) => p.x))).toBeCloseTo(8, 12)
      expect(Math.max(...face.corners.map((p) => p.x))).toBeCloseTo(14, 12)
      expect(Math.min(...face.corners.map((p) => p.y))).toBeCloseTo(from, 12)
      expect(Math.max(...face.corners.map((p) => p.y))).toBeCloseTo(to, 12)
    }
  })

  it('unfolds a square pyramid with every edge 4 into the base and four equilateral triangles', () => {
    // Base side 4, circumradius 2√2; height 2√2 makes each lateral edge
    // √(8 + 8) = 4, so every face is equilateral.
    const { net, names } = built('S = solid pyramid regular 4 side 4, height 2*sqrt(2) vertices ABCDE')
    const star = net()
    expect(star.faces).toHaveLength(5)
    expect(star.lines.filter((l) => l.fold)).toHaveLength(4)
    const base = faceNamed(star, names, 'ABCD')
    for (const side of sides(base)) expect(side).toBeCloseTo(4, 12)
    expect(distance(base.corners[0], base.corners[2])).toBeCloseTo(4 * Math.SQRT2, 12)
    const centre = { x: base.corners.reduce((s, p) => s + p.x, 0) / 4, y: base.corners.reduce((s, p) => s + p.y, 0) / 4 }
    for (const face of star.faces.filter((f) => f !== base)) {
      for (const side of sides(face)) expect(side).toBeCloseTo(4, 12)
      // The apex copy is outward, 2√3 from its base edge and 2 + 2√3 from
      // the base's centre: unfolded, not folded back over the base.
      const apex = face.corners[face.vertices.indexOf(4)]
      expect(distance(apex, centre)).toBeCloseTo(2 + 2 * Math.sqrt(3), 12)
    }
    expect(letterCounts(star, names)).toEqual({ A: 1, B: 1, C: 1, D: 1, E: 4 })
  })

  it("unfolds a regular tetrahedron of edge 6 into its star: one equilateral triangle of side 12", () => {
    const { net, names } = built('S = solid tetrahedron edge 6 vertices ABCD')
    const star = net()
    expect(star.faces).toHaveLength(4)
    expect(star.lines.filter((l) => l.fold)).toHaveLength(3)
    for (const face of star.faces) for (const side of sides(face)) expect(side).toBeCloseTo(6, 12)
    // The three copies of D are the big triangle's corners, 12 apart; the
    // base ABC is its medial triangle.
    const d = star.letters.filter((l) => names[l.vertex] === 'D').map((l) => l.at)
    expect(d).toHaveLength(3)
    for (let i = 0; i < 3; i++) expect(distance(d[i], d[(i + 1) % 3])).toBeCloseTo(12, 12)
  })

  it('unfolds an octahedron of edge 6 into a strip of 8 triangles, 7 folds, no overlap', () => {
    const { net, names } = built('S = solid octahedron edge 6 vertices ABCDEF')
    const strip = net()
    expect(strip.faces).toHaveLength(8)
    // 8 x 3 = 24 face edges, 7 folds shared: 24 - 14 = 10 cut edges.
    expect(strip.lines.filter((l) => l.fold)).toHaveLength(7)
    expect(strip.lines.filter((l) => !l.fold)).toHaveLength(10)
    for (const face of strip.faces) for (const side of sides(face)) expect(side).toBeCloseTo(6, 12)
    expect(netOverlaps(strip.faces, strip.copies)).toBe(false)
    // Round the equator: every equator edge (AB, BC, CD, DA) is crossed once,
    // as a fold. E and F are the apexes.
    const foldNames = strip.lines.filter((l) => l.fold).map((l) => l.object)
    for (const edge of ['A-B', 'B-C', 'C-D', 'D-A']) expect(foldNames).toContain(`fold-${edge}`)
    expect(letterCounts(strip, names)).toEqual({ A: 2, B: 1, C: 1, D: 1, E: 2, F: 3 })
  })

  it('refuses a sphere and a hull, in words', () => {
    expect(() => built('S = solid sphere radius 3').net()).toThrow('"S" is a sphere, and a sphere has no net — nets are drawn for prisms, pyramids, tetrahedra, octahedra, frusta, cylinders and cones')
    const hull = built('A = (0, 0, 0)\nB = (4, 0, 0)\nC = (0, 4, 0)\nD = (0, 0, 4)\nE = (3, 3, 3)\nS = solid hull A-B-C-D-E')
    expect(() => hull.net()).toThrow('"S" is a hull of named points, which has no template net — nets are drawn for prisms')
  })
})

// ---------------------------------------------------------------------------
// The overlap check (N2), and the invariant it guards
// ---------------------------------------------------------------------------

// A flat face with its own corner copies, for the hand-built nets below.
function square(face: number, at: Vec2, copies: number[]): { face: NetFace; keys: [string, number][] } {
  const corners = [at, { x: at.x + 2, y: at.y }, { x: at.x + 2, y: at.y + 2 }, { x: at.x, y: at.y + 2 }]
  const vertices = [0, 1, 2, 3].map((k) => face * 10 + k)
  return { face: { face, vertices, corners }, keys: vertices.map((v, k) => [`${face}:${v}`, copies[k]]) }
}

function flat(...faces: ReturnType<typeof square>[]): Net {
  return { shape: 'star', faces: faces.map((f) => f.face), lines: [], letters: [], copies: new Map(faces.flatMap((f) => f.keys)) }
}

describe('the overlap check (N2)', () => {
  it('refuses a net whose faces overlap, and names the template', () => {
    // Two 2-by-2 squares, the second moved (1, 1): their edges cross at
    // (2, 1) and (1, 2), and each has a corner inside the other.
    const net = flat(square(0, { x: 0, y: 0 }, [0, 1, 2, 3]), square(1, { x: 1, y: 1 }, [4, 5, 6, 7]))
    expect(netOverlaps(net.faces, net.copies)).toBe(true)
    expect(() => refuseOverlap(net, 'pyramid', 'S')).toThrow('"S": this pyramid\'s star net overlaps itself')
  })

  it('refuses two faces laid exactly on each other (the centroid test)', () => {
    const net = flat(square(0, { x: 0, y: 0 }, [0, 1, 2, 3]), square(1, { x: 0, y: 0 }, [4, 5, 6, 7]))
    expect(netOverlaps(net.faces, net.copies)).toBe(true)
  })

  it('lets two faces touch along a fold, or at one shared corner', () => {
    // Side by side, sharing the copies on x = 2: a fold.
    expect(netOverlaps(...(() => { const n = flat(square(0, { x: 0, y: 0 }, [0, 1, 2, 3]), square(1, { x: 2, y: 0 }, [1, 4, 5, 2])); return [n.faces, n.copies] as const })())).toBe(false)
    // Corner to corner at (2, 2), sharing that one copy.
    expect(netOverlaps(...(() => { const n = flat(square(0, { x: 0, y: 0 }, [0, 1, 2, 3]), square(1, { x: 2, y: 2 }, [2, 4, 5, 6])); return [n.faces, n.copies] as const })())).toBe(false)
  })

  // The invariant (correction to the plan): no template net the grammar can
  // reach overlaps. A tetrahedron's star cannot — any two lateral faces share
  // a base vertex whose base angle and two face angles sum below 360°, so the
  // wedges there are disjoint — and an OBTUSE six-edge tetrahedron is the
  // case the plan expected to overlap: BC = 19 against AB = AC = 10 puts a
  // 143.6° angle at A (cos A = (100 + 100 - 361) / 200 = -0.805).
  it('draws an obtuse six-edge tetrahedron’s star, which cannot overlap', () => {
    const { net } = built('S = solid tetrahedron ABCD with AB = 10, AC = 10, BC = 19, AD = 6, BD = 13, CD = 13')
    const star = net()
    expect(star.faces).toHaveLength(4)
    expect(netOverlaps(star.faces, star.copies)).toBe(false)
  })

  it('holds for every regular template and seeded pyramids on points leaning far out', () => {
    for (let n = 3; n <= 12; n++) {
      for (const spec of [`prism regular ${n} side 2, height 5`, `pyramid regular ${n} side 2, height 3`, `frustum regular ${n} side 4, top 1, height 2`, `frustum regular ${n} side 2, top 1.9, height 0.1`]) {
        const { net } = built(`S = solid ${spec}`)
        const drawn = net()
        expect(netOverlaps(drawn.faces, drawn.copies)).toBe(false)
      }
    }
    // Pyramids on points: a convex base of 4 to 8 corners on an ellipse, the
    // apex anywhere within 30 of the axis and as low as 0.05 — the petal
    // unfolding still never overlaps.
    let seed = 20260926
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let trial = 0; trial < 400; trial++) {
      const corners = 4 + Math.floor(random() * 5)
      const angles = Array.from({ length: corners }, () => random() * 2 * Math.PI).sort((a, b) => a - b)
      const [rx, rz] = [1 + random() * 5, 1 + random() * 5]
      const points = angles.map((t) => ({ x: rx * Math.cos(t), y: 0, z: rz * Math.sin(t) }))
      points.push({ x: (random() - 0.5) * 60, y: 0.05 + random() * random() * 10, z: (random() - 0.5) * 60 })
      const body = buildSolid({ kind: 'hull', shape: 'pyramid', polyhedron: hullOf(points, points.map((_, i) => `P${i}`)) })
      const drawn = netOf(body, 'S')
      expect(netOverlaps(drawn.faces, drawn.copies)).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Round solids (task 2)
// ---------------------------------------------------------------------------

function pieces(net: Net, object: string) {
  return net.lines.filter((l) => l.object === object).map((l) => l.piece)
}

describe('nets of round solids (N2)', () => {
  it('unrolls a cylinder r = 3, h = 10 into a 6π-by-10 rectangle, its rims tangent at the middle', () => {
    const { net } = built('S = solid cylinder radius 3, height 10')
    const flatNet = net()
    // 2π r = 6π = 18.850 wide, 10 tall; the two rim edges are the folds.
    const folds = flatNet.lines.filter((l) => l.fold)
    expect(folds.map((l) => l.object).sort()).toEqual(['fold-base', 'fold-top'])
    for (const fold of folds) expect(lineLength(fold)).toBeCloseTo(6 * Math.PI, 12)
    expect(lineLength(folds[0])).toBeCloseTo(18.85, 3)
    const seams = flatNet.lines.filter((l) => l.object === 'cut-seam')
    expect(seams).toHaveLength(2)
    for (const seam of seams) expect(lineLength(seam)).toBeCloseTo(10, 12)
    // Each rim a whole circle of radius 3, tangent at its edge's midpoint:
    // the midpoints are (0, 0) and (0, 10), so the centres are 3 beyond them.
    const [base] = pieces(flatNet, 'cut-base')
    const [top] = pieces(flatNet, 'cut-top')
    for (const [circle, centreY] of [
      [base, -3],
      [top, 13],
    ] as const) {
      if (circle.kind !== 'arc') throw new Error('expected a circle')
      expect(circle.radius).toBe(3)
      expect(circle.center.x).toBeCloseTo(0, 12)
      expect(circle.center.y).toBeCloseTo(centreY, 12)
      expect(circle.to - circle.from).toBeCloseTo(2 * Math.PI, 12)
    }
  })

  it('unrolls a cone R = 3, H = 4 into a sector of radius 5 and angle 6π/5 (216°), the base tangent at the arc’s middle', () => {
    const { net } = built('S = solid cone radius 3, height 4')
    const sector = net()
    // Slant √(9 + 16) = 5; the base rim's length 6π is the arc's, so the
    // angle is 6π / 5 = 2π · 3/5 — 216°, symmetric about the downward vertical.
    const [arc] = pieces(sector, 'fold-base')
    if (arc.kind !== 'arc') throw new Error('expected an arc')
    expect(arc.radius).toBeCloseTo(5, 12)
    expect(arc.to - arc.from).toBeCloseTo((6 * Math.PI) / 5, 12)
    expect(((arc.to - arc.from) * 180) / Math.PI).toBeCloseTo(216, 10)
    expect((arc.from + arc.to) / 2).toBeCloseTo(-Math.PI / 2, 12)
    // Two radii, the seam, from the apex to the arc's ends.
    const radii = pieces(sector, 'cut-seam')
    expect(radii).toHaveLength(2)
    for (const radius of radii) {
      if (radius.kind !== 'segment') throw new Error('expected a segment')
      expect(distance(radius.a, { x: 0, y: 0 })).toBeCloseTo(0, 12)
      expect(distance(radius.b, { x: 0, y: 0 })).toBeCloseTo(5, 12)
    }
    // The base circle, radius 3, tangent at the arc's midpoint (0, -5).
    const [base] = pieces(sector, 'cut-base')
    if (base.kind !== 'arc') throw new Error('expected a circle')
    expect(base.radius).toBe(3)
    expect(base.center.x).toBeCloseTo(0, 12)
    expect(base.center.y).toBeCloseTo(-8, 12)
  })

  it('unrolls a frustum r₁ = 4, r₂ = 1, h = 4 into an annular sector of radii 20/3 and 5/3, angle 6π/5', () => {
    // Slant √(3² + 4²) = 5; the extended cone's slant 5 · 4/3 = 20/3, the top
    // rim 20/3 · 1/4 = 5/3 from its apex; angle 2π · 4 / (20/3) = 6π/5.
    const { net } = built('S = solid frustum radius 4, top 1, height 4')
    const ring = net()
    const [outer] = pieces(ring, 'fold-base')
    const [inner] = pieces(ring, 'fold-top')
    if (outer.kind !== 'arc' || inner.kind !== 'arc') throw new Error('expected arcs')
    expect(outer.radius).toBeCloseTo(20 / 3, 12)
    expect(inner.radius).toBeCloseTo(5 / 3, 12)
    for (const arc of [outer, inner]) expect(arc.to - arc.from).toBeCloseTo((6 * Math.PI) / 5, 12)
    for (const seam of ring.lines.filter((l) => l.object === 'cut-seam')) expect(lineLength(seam)).toBeCloseTo(5, 12)
    // Both rims tangent at their arcs' midpoints: the base (radius 4) below
    // (0, -20/3), the top (radius 1) inside the hole above (0, -5/3).
    const [base] = pieces(ring, 'cut-base')
    const [top] = pieces(ring, 'cut-top')
    if (base.kind !== 'arc' || top.kind !== 'arc') throw new Error('expected circles')
    expect(base.radius).toBe(4)
    expect(base.center.y).toBeCloseTo(-20 / 3 - 4, 12)
    expect(top.radius).toBe(1)
    expect(top.center.y).toBeCloseTo(-5 / 3 + 1, 12)
  })

  // N2: the seam runs directly AWAY from the default camera, so the net's
  // middle is the generator facing the viewer. Found here by brute force over
  // the base rim (a check, not an answer): the rim point nearest the viewer —
  // largest depth along the default camera's direction — must unroll to the
  // net's midline (x = 0 for a cylinder, the downward vertical for a cone).
  it('cuts the seam behind: the net’s middle is the generator nearest the viewer', () => {
    for (const [spec, middle] of [
      ['S = solid cylinder radius 3, height 10', 0],
      ['S = solid cone radius 3, height 4', -Math.PI / 2],
      // Tilted, by points: the local frame is not the world's.
      ['V = (1, 2, 5)\nO = (0, -1, 0)\nS = solid cone apex V base O radius 2', -Math.PI / 2],
    ] as const) {
      const { body } = built(spec)
      const unrolling = unrollingOf(body)!
      let best = 0
      let bestDepth = -Infinity
      for (let k = 0; k < 36000; k++) {
        const theta = (2 * Math.PI * k) / 36000
        const rim = toWorld(body.placement, { x: Math.cos(theta), y: -unrolling.height / 2, z: Math.sin(theta) })
        const depth = rim.x * DEFAULT_CAMERA.direction.x + rim.y * DEFAULT_CAMERA.direction.y + rim.z * DEFAULT_CAMERA.direction.z
        if (depth > bestDepth) [best, bestDepth] = [theta, depth]
      }
      expect(unrolledAngle(unrolling, netSeam(body), best)).toBeCloseTo(middle, 3)
    }
  })
})

// ---------------------------------------------------------------------------
// net: in a figure
// ---------------------------------------------------------------------------

function render(spec: string) {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
}

function layer(svg: string, name: string): string {
  if (svg.includes(`<g data-layer="${name}"/>`)) return ''
  const open = `<g data-layer="${name}">`
  const start = svg.indexOf(open) + open.length
  return svg.slice(start, svg.indexOf('</g>', start))
}

// Every <line> a statement emitted, with its ends and whether it is dashed.
function lines(svg: string, statement: number) {
  return [...svg.matchAll(/<line x1="([^"]*)" y1="([^"]*)" x2="([^"]*)" y2="([^"]*)"([^>]*)\/>/g)]
    .filter((m) => m[5].includes(`data-statement="${statement}"`))
    .map((m) => ({ x1: Number(m[1]), y1: Number(m[2]), x2: Number(m[3]), y2: Number(m[4]), attrs: m[5] }))
}

describe('net: in a figure', () => {
  it('draws the 5 folds dashed beneath and the 14 cut edges solid', () => {
    const { svg, errors } = render('S = solid cube edge 2 vertices ABCDEFGH\nnet: S')
    expect(errors).toEqual([])
    const drawn = lines(svg, 1)
    const folds = drawn.filter((l) => l.attrs.includes('data-object="fold-'))
    const cuts = drawn.filter((l) => l.attrs.includes('data-object="cut-'))
    expect(folds).toHaveLength(5)
    expect(cuts).toHaveLength(14)
    for (const fold of folds) expect(fold.attrs).toContain('stroke-dasharray')
    for (const cut of cuts) expect(cut.attrs).not.toContain('stroke-dasharray')
    expect(lines(layer(svg, 'auxiliary'), 1).filter((l) => l.attrs.includes('stroke-dasharray'))).toHaveLength(5)
    expect(lines(layer(svg, 'primary'), 1)).toHaveLength(14)
  })

  it('letters every copy — A three times — as display labels, not named points', () => {
    const parsed = parseSpec('S = solid cube edge 2 vertices ABCDEFGH\nnet: S\nlabel: AB')
    const { svg, errors } = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
    expect(errors).toEqual([])
    const letters = [...layer(svg, 'labels').matchAll(/<text[^>]*data-statement="1"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1])
    expect(letters.filter((t) => t === 'A')).toHaveLength(3)
    expect(letters).toHaveLength(14)
    // No dots: a copy is not a point.
    expect(layer(svg, 'points')).not.toContain('data-statement="1"')
  })

  it('stacks a net to the right of an earlier lifted section, clear of it', () => {
    const { svg, errors } = render('S = solid prism 8 by 5 by 6 vertices ABCDEFGH\nsection: S by plane z = 1 vertices PQRS\nnet: S')
    expect(errors).toEqual([])
    const section = lines(svg, 1)
    const net = lines(svg, 2)
    expect(section).toHaveLength(4)
    expect(net.length).toBeGreaterThan(0)
    const sectionRight = Math.max(...section.flatMap((l) => [l.x1, l.x2]))
    const netLeft = Math.min(...net.flatMap((l) => [l.x1, l.x2]))
    expect(netLeft).toBeGreaterThan(sectionRight)
  })

  it('places a single lift exactly as before: no earlier lift, phase 5’s offset', () => {
    const solid = { minX: -3, minY: -2, maxX: 5, maxY: 4 }
    const shape = { minX: 1, minY: 0, maxX: 3, maxY: 1 }
    expect(liftOffset(solid, shape, null)).toEqual({ x: 5 + 2 - 1, y: 1 - 0.5 })
    expect(liftOffset(solid, shape)).toEqual(liftOffset(solid, shape, null))
    // A running edge past the solid moves the next lift past it.
    expect(liftOffset(solid, shape, 20).x).toBe(20 + 2 - 1)
  })

  it('dashes a cylinder’s two rim folds and draws its seam and circles solid', () => {
    const { svg, errors } = render('S = solid cylinder radius 3, height 10\nnet: S')
    expect(errors).toEqual([])
    const drawn = lines(svg, 1)
    expect(drawn.filter((l) => l.attrs.includes('stroke-dasharray')).map((l) => /data-object="([^"]*)"/.exec(l.attrs)![1]).sort()).toEqual(['fold-base', 'fold-top'])
    expect(drawn.filter((l) => l.attrs.includes('data-object="cut-seam"') && !l.attrs.includes('stroke-dasharray'))).toHaveLength(2)
    // Each circle is two half-turn arcs, solid.
    const circles = [...svg.matchAll(/<path d="[^"]*"([^>]*data-statement="1"[^>]*)\/>/g)].map((m) => m[1])
    expect(circles.filter((a) => a.includes('data-object="cut-base"'))).toHaveLength(2)
    expect(circles.filter((a) => a.includes('data-object="cut-top"'))).toHaveLength(2)
    for (const attrs of circles) expect(attrs).not.toContain('stroke-dasharray')
  })

  it('draws a cone’s sector as one circular arc, dashed, plus two solid radii', () => {
    const { svg, errors } = render('S = solid cone radius 3, height 4\nnet: S')
    expect(errors).toEqual([])
    const arcs = [...svg.matchAll(/<path d="M [^A]*A ([^ ]+) ([^ ]+) [^"]*"([^>]*)\/>/g)].filter((m) => m[3].includes('data-statement="1"') && m[3].includes('data-object="fold-base"'))
    expect(arcs).toHaveLength(1)
    // Circular: equal radii (the SVG arc's rx and ry).
    expect(arcs[0][1]).toBe(arcs[0][2])
    expect(arcs[0][3]).toContain('stroke-dasharray')
    const radii = lines(svg, 1).filter((l) => l.attrs.includes('data-object="cut-seam"'))
    expect(radii).toHaveLength(2)
    for (const radius of radii) expect(radius.attrs).not.toContain('stroke-dasharray')
  })

  it('reports a refused net as an error and draws the rest', () => {
    const { svg, errors } = render('S = solid sphere radius 3\nnet: S')
    expect(errors.map((e) => e.message)).toEqual(['"S" is a sphere, and a sphere has no net — nets are drawn for prisms, pyramids, tetrahedra, octahedra, frusta, cylinders and cones'])
    expect(svg.startsWith('<svg ')).toBe(true)
  })

  it('infers a solid figure from a net', () => {
    const parsed = parseSpec('A = (0, 0, 0)\nnet: S')
    expect(resolveMode(parsed.statements, parsed.config)).toBe('figure')
  })
})
