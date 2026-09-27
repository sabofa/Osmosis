import { describe, expect, it } from 'vitest'
import { evalExpr } from '../parser/evalExpr'
import { parseSpec } from '../parser/parseSpec'
import type { Expr } from '../parser/types'
import { LIGHT_PALETTE } from '../render/palette'
import { GEOM_EPS } from '../scene/geometry/types'
import type { Vec2 } from '../scene/types'
import { authorToWorld, worldToAuthor } from './authorFrame'
import { hidesPoint } from './occlusion'
import { DEFAULT_CAMERA, type Vec3 } from './project3d'
import { renderFigure } from './render'
import { buildSolidFigure } from './solidScope'
import { angleArc, angleFrame, arcPoint, dihedralMark, projectArc, rightAngleCorners } from './spaceMarks'
import { dihedral3 } from './construct3d'
import { ellipsePoint } from './svg'

// Phase 10, Task 2 — angle arcs, right-angle marks and ticks on points in
// space (M1, M2, M4, M7). Expected geometry is computed by hand in the
// AUTHOR frame and carried to the internal one through authorToWorld, never
// read back from the engine.

const value = (e: Expr) => evalExpr(e, {}, 'radians', {})

function rendered(spec: string) {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
}

function layer(svg: string, name: string): string {
  const selfClosing = `<g data-layer="${name}"/>`
  if (svg.includes(selfClosing)) return ''
  const open = `<g data-layer="${name}">`
  const start = svg.indexOf(open)
  if (start < 0) throw new Error(`no layer "${name}" in output`)
  const from = start + open.length
  return svg.slice(from, svg.indexOf('</g>', from))
}

function elements(markup: string, tag: string, statement: number): string[] {
  return [...markup.matchAll(new RegExp(`<${tag} [^>]*/>`, 'g'))].map((m) => m[0]).filter((e) => e.includes(`data-statement="${statement}"`))
}

const CUBE_POINTS = [
  'A = (0, 0, 0)',
  'B = (1, 0, 0)',
  'C = (1, 1, 0)',
  'D = (0, 1, 0)',
  'E = (0, 0, 1)',
  'F = (1, 0, 1)',
  'G = (1, 1, 1)',
  'H = (0, 1, 1)',
]
// The unit cube by points, with no solid: nothing hides anything.
const CUBE = ['@mode: figure', ...CUBE_POINTS].join('\n')
// The same corners, and the solid cube on them.
const SOLID_CUBE = [...CUBE.split('\n'), 'S = solid hull A-B-C-D-E-F-G-H'].join('\n')
// The statement index of the first line after the cube's points; one more
// after SOLID_CUBE, whose hull is a statement of its own.
const MARK = CUBE_POINTS.length

const author = (x: number, y: number, z: number): Vec3 => authorToWorld({ x, y, z })

// The fitted projection of a figure, recovered from two of its dots: view =
// anchor + s (p - p_anchor) with y flipped, where p is the camera's picture
// coordinate. Dots are written to 0.001, so this is good to about that.
function projectionOf(svg: string, first: string, second: string, points: Record<string, Vec3>): (p: Vec3) => Vec2 {
  const dot = (name: string): Vec2 => {
    const m = new RegExp(`<circle cx="([^"]*)" cy="([^"]*)"[^>]*data-object="${name}"`).exec(layer(svg, 'points'))
    if (!m) throw new Error(`no dot ${name}`)
    return { x: Number(m[1]), y: Number(m[2]) }
  }
  const [va, vb] = [dot(first), dot(second)]
  const [pa, pb] = [DEFAULT_CAMERA.project(points[first]), DEFAULT_CAMERA.project(points[second])]
  const s = (vb.x - va.x) / (pb.x - pa.x)
  expect(-(pb.y - pa.y) * s).toBeCloseTo(vb.y - va.y, 1)
  return (p: Vec3) => {
    const q = DEFAULT_CAMERA.project(p)
    return { x: va.x + s * (q.x - pa.x), y: va.y - s * (q.y - pa.y) }
  }
}

const A = author(0, 0, 0)
const B = author(1, 0, 0)
const D = author(0, 1, 0)
const G = author(1, 1, 1)
const POINTS = { A, B, D, G }
const NAMES = { from: 'A', vertex: 'B', to: 'G' }

describe('an angle arc in space is a circle arc in the angle\'s own plane (M1)', () => {
  it('is built in space: radius 0.2 x the shorter arm, sweeping the true 90 degrees', () => {
    const arc = angleArc(angleFrame(B, A, G, NAMES))
    // min(|BA|, |BG|) = min(1, sqrt2) = 1.
    expect(arc.radius).toBeCloseTo(0.2, 14)
    expect(arc.sweep).toBeCloseTo(Math.PI / 2, 14)
    // Its ends are on the two rays, 0.2 from B: B + 0.2 unit(BA), and
    // B + 0.2 unit(BG) = B + 0.2 (0, 1, 1)/sqrt2, in the author frame.
    const start = worldToAuthor(arcPoint(arc, 0))
    const end = worldToAuthor(arcPoint(arc, arc.sweep))
    for (const [got, want] of [
      [start, { x: 0.8, y: 0, z: 0 }],
      [end, { x: 1, y: 0.2 / Math.SQRT2, z: 0.2 / Math.SQRT2 }],
    ] as const) {
      expect(got.x).toBeCloseTo(want.x, 14)
      expect(got.y).toBeCloseTo(want.y, 14)
      expect(got.z).toBeCloseTo(want.z, 14)
    }
  })

  it('projects to an elliptical arc whose ends are the camera\'s images of those points', () => {
    const arc = angleArc(angleFrame(B, A, G, NAMES))
    const edge = projectArc(arc, DEFAULT_CAMERA, 'B')
    const at = (t: number) => ellipsePoint(edge.center, edge.rx, edge.ry, edge.rotation, t)
    const want = [DEFAULT_CAMERA.project(author(0.8, 0, 0)), DEFAULT_CAMERA.project(author(1, 0.2 / Math.SQRT2, 0.2 / Math.SQRT2))]
    const got = [at(edge.startAngle), at(edge.endAngle)]
    for (let i = 0; i < 2; i++) {
      expect(Math.abs(got[i].x - want[i].x)).toBeLessThanOrEqual(GEOM_EPS)
      expect(Math.abs(got[i].y - want[i].y)).toBeLessThanOrEqual(GEOM_EPS)
    }
    // The camera foreshortens BA: the picture-plane radius along it is not
    // the true 0.2, so a circle drawn in the picture would miss this end.
    const b = DEFAULT_CAMERA.project(B)
    expect(Math.abs(Math.hypot(want[0].x - b.x, want[0].y - b.y) - 0.2)).toBeGreaterThan(0.05)
  })

  it('draws "angle: A-B-G" as ONE elliptical arc command, not a polyline', () => {
    const result = rendered(`${CUBE}\nangle: A-B-G`)
    expect(result.errors).toEqual([])
    const marks = layer(result.svg, 'marks')
    const paths = elements(marks, 'path', MARK)
    expect(paths).toHaveLength(1)
    expect(paths[0]).toMatch(/d="M [-\d.]+ [-\d.]+ A [-\d.]+ [-\d.]+ [-\d.]+ [01] [01] [-\d.]+ [-\d.]+"/)
    expect(marks).not.toContain('<polyline')
    expect(paths[0]).toContain('data-object="B"')
  })

  it('draws the arc through the ends the camera gives, on the page', () => {
    const svg = rendered(`${CUBE}\nangle: A-B-G`).svg
    const toView = projectionOf(svg, 'A', 'G', POINTS)
    const path = elements(layer(svg, 'marks'), 'path', MARK)[0]
    const m = /d="M ([-\d.]+) ([-\d.]+) A [-\d.]+ [-\d.]+ [-\d.]+ [01] [01] ([-\d.]+) ([-\d.]+)"/.exec(path)!
    const start = toView(author(0.8, 0, 0))
    const end = toView(author(1, 0.2 / Math.SQRT2, 0.2 / Math.SQRT2))
    expect(Number(m[1])).toBeCloseTo(start.x, 1)
    expect(Number(m[2])).toBeCloseTo(start.y, 1)
    expect(Number(m[3])).toBeCloseTo(end.x, 1)
    expect(Number(m[4])).toBeCloseTo(end.y, 1)
  })

  it('writes an "angle: … label:" text beside the arc, as in the plane', () => {
    const svg = rendered(`${CUBE}\nangle: A-B-G label: θ`).svg
    expect(layer(svg, 'labels')).toMatch(/>θ<\/text>/)
  })

  it('refuses a collinear angle, which has no plane, naming the points', () => {
    const errors = rendered(`${CUBE}\nK = (2, 0, 0)\nangle: A-B-K`).errors.map((e) => e.message)
    expect(errors).toEqual(['A, B and K are collinear, so angle A-B-K has no plane to draw its mark in'])
  })

  it('refuses a degenerate arm, naming the angle', () => {
    const errors = rendered(`${CUBE}\nangle: A-B-B`).errors.map((e) => e.message)
    expect(errors).toEqual(['An arm of angle ABB has zero length: its end and the vertex coincide'])
  })

  it('refuses an angle mixing a point in space with a point in the plane', () => {
    const errors = rendered(`${CUBE}\nP = (3, 4)\nangle: A-B-P`).errors.map((e) => e.message)
    expect(errors).toEqual([expect.stringMatching(/mixes a point in space \(A\) with a point in the plane \(P\)/)])
  })
})

describe('an inline angle label in space draws its arc and sits on it (M7)', () => {
  it('draws the arc and prints the true angle', () => {
    const result = rendered(`@angle: degrees\n${CUBE}\nlabel: angle ABG`)
    expect(result.errors).toEqual([])
    expect(elements(layer(result.svg, 'marks'), 'path', MARK)).toHaveLength(1)
    expect(layer(result.svg, 'labels')).toContain('>90°</text>')
  })

  it('draws one arc, not two, beside an "angle:" statement for the same angle', () => {
    const svg = rendered(`@angle: degrees\n${CUBE}\nangle: A-B-G\nlabel: angle GBA`).svg
    expect(layer(svg, 'marks').match(/<path /g)).toHaveLength(1)
  })
})

describe('a right angle in space is a square in 3D, and asserted (M1, M2)', () => {
  it('has its corners at B, B + s x, B + s x + s y, B + s y with s = 0.15', () => {
    const corners = rightAngleCorners(angleFrame(B, A, G, NAMES))
    // x = unit(BA) = (-1, 0, 0), y = unit(BG) = (0, 1, 1)/sqrt2 (author).
    const k = 0.15 / Math.SQRT2
    const want = [author(1, 0, 0), author(0.85, 0, 0), author(0.85, k, k), author(1, k, k)]
    corners.forEach((corner, i) => {
      expect(corner.x).toBeCloseTo(want[i].x, 14)
      expect(corner.y).toBeCloseTo(want[i].y, 14)
      expect(corner.z).toBeCloseTo(want[i].z, 14)
    })
  })

  it('draws the projected square at those corners (the L, as in the plane)', () => {
    const result = rendered(`${CUBE}\nright-angle: A-B-G`)
    expect(result.errors).toEqual([])
    const toView = projectionOf(result.svg, 'A', 'G', POINTS)
    const lines = elements(layer(result.svg, 'marks'), 'polyline', MARK)
    expect(lines).toHaveLength(1)
    const drawn = /points="([^"]*)"/.exec(lines[0])![1].split(' ').map((p) => p.split(',').map(Number))
    const k = 0.15 / Math.SQRT2
    const want = [author(0.85, 0, 0), author(0.85, k, k), author(1, k, k)].map(toView)
    expect(drawn).toHaveLength(3)
    drawn.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(want[i].x, 1)
      expect(y).toBeCloseTo(want[i].y, 1)
    })
  })

  it('refuses a right-angle mark on an angle that is not 90 degrees, naming its true angle', () => {
    // BA = (-1,0,0), BD = (-1,1,0): 45 degrees.
    expect(rendered(`${CUBE}\nright-angle: A-B-D`).errors.map((e) => e.message)).toEqual([
      'A-B-D is not a right angle — its true angle is 45°',
    ])
    expect(elements(layer(rendered(`${CUBE}\nright-angle: A-B-D`).svg, 'marks'), 'polyline', MARK)).toHaveLength(0)
  })

  it('draws it anyway under "@scale: false"', () => {
    const result = rendered(`@scale: false\n${CUBE}\nright-angle: A-B-D`)
    expect(result.errors).toEqual([])
    expect(elements(layer(result.svg, 'marks'), 'polyline', MARK)).toHaveLength(1)
  })
})

describe('ticks on a segment in space are drawn in the picture plane (M1)', () => {
  it('draws "tick: A-G count: 2" as two ticks square to the drawn A-G, about its drawn midpoint', () => {
    const result = rendered(`${CUBE}\nsegment: A-G\ntick: A-G count: 2`)
    expect(result.errors).toEqual([])
    const toView = projectionOf(result.svg, 'A', 'G', POINTS)
    const [a, g] = [toView(A), toView(G)]
    const ticks = elements(layer(result.svg, 'marks'), 'line', MARK + 1).map((line) => {
      const n = (k: string) => Number(new RegExp(` ${k}="([^"]*)"`).exec(line)![1])
      return { a: { x: n('x1'), y: n('y1') }, b: { x: n('x2'), y: n('y2') } }
    })
    expect(ticks).toHaveLength(2)
    const along = { x: g.x - a.x, y: g.y - a.y }
    const length = Math.hypot(along.x, along.y)
    for (const tick of ticks) {
      const d = { x: tick.b.x - tick.a.x, y: tick.b.y - tick.a.y }
      // Square to the drawn segment (to the 0.001 the markup is written to).
      expect(Math.abs(d.x * along.x + d.y * along.y) / (Math.hypot(d.x, d.y) * length)).toBeLessThan(1e-3)
    }
    const centre = {
      x: (ticks[0].a.x + ticks[0].b.x + ticks[1].a.x + ticks[1].b.x) / 4,
      y: (ticks[0].a.y + ticks[0].b.y + ticks[1].a.y + ticks[1].b.y) / 4,
    }
    expect(centre.x).toBeCloseTo((a.x + g.x) / 2, 1)
    expect(centre.y).toBeCloseTo((a.y + g.y) / 2, 1)
  })
})

describe('marks under the glass rule: decided whole, by their middle (M4)', () => {
  const dashed = (element: string) => element.includes('stroke-dasharray')

  it('dashes an arc on a hidden face of a solid cube, in the layer beneath', () => {
    // Face y = 0 (ABFE) faces away from the standard camera.
    const svg = rendered(`${SOLID_CUBE}\nangle: A-B-F`).svg
    const statement = MARK + 1
    expect(elements(layer(svg, 'marks'), 'path', statement)).toHaveLength(0)
    const hidden = elements(layer(svg, 'auxiliary'), 'path', statement)
    expect(hidden).toHaveLength(1)
    expect(dashed(hidden[0])).toBe(true)
  })

  it('dashes the arc of A-B-G, which lies inside the cube', () => {
    const svg = rendered(`${SOLID_CUBE}\nangle: A-B-G`).svg
    expect(elements(layer(svg, 'auxiliary'), 'path', MARK + 1).filter(dashed)).toHaveLength(1)
  })

  it('draws the same arc on a front face solid', () => {
    // Face x = 1 (BCGF) faces the standard camera.
    const svg = rendered(`${SOLID_CUBE}\nangle: C-B-F`).svg
    const drawn = elements(layer(svg, 'marks'), 'path', MARK + 1)
    expect(drawn).toHaveLength(1)
    expect(dashed(drawn[0])).toBe(false)
    expect(elements(layer(svg, 'auxiliary'), 'path', MARK + 1)).toHaveLength(0)
  })

  it('dashes a right-angle mark and ticks by the same rule', () => {
    const svg = rendered(`${SOLID_CUBE}\nright-angle: A-B-F\ntick: A-G\ntick: F-H`).svg
    expect(elements(layer(svg, 'auxiliary'), 'polyline', MARK + 1).filter(dashed)).toHaveLength(1)
    // A-G's midpoint is the cube's centre: hidden. F-H is a diagonal of the
    // top face: seen.
    expect(elements(layer(svg, 'auxiliary'), 'line', MARK + 2).filter(dashed)).toHaveLength(1)
    const top = elements(layer(svg, 'marks'), 'line', MARK + 3)
    expect(top).toHaveLength(1)
    expect(dashed(top[0])).toBe(false)
  })

  // A 120-degree arc of radius 1.8 behind the cube, bulging across the
  // cube's shadow: its middle is behind the cube's centre, its two ends are
  // clear of the cube on either side. Built in the picture frame of the
  // standard camera (e1 right, e2 up, d toward the viewer), in author
  // coordinates.
  function arcBehindCube(shift: number): { spec: string; middle: Vec3; ends: [Vec3, Vec3] } {
    const toAuthor = (p: Vec3) => worldToAuthor(p)
    const [e1, e2, d] = [toAuthor(DEFAULT_CAMERA.right), toAuthor(DEFAULT_CAMERA.up), toAuthor(DEFAULT_CAMERA.direction)]
    const at = (a: number, b: number): Vec3 => ({
      x: 0.5 + a * e1.x + b * e2.x - 3 * d.x,
      y: 0.5 + a * e1.y + b * e2.y - 3 * d.y,
      z: 0.5 + a * e1.z + b * e2.z - 3 * d.z,
    })
    const rho = 1.8
    const vertex = at(shift, -rho)
    const arm = rho / 0.2
    const [s, c] = [Math.sin(Math.PI / 3), Math.cos(Math.PI / 3)]
    const from = at(shift - arm * s, -rho + arm * c)
    const to = at(shift + arm * s, -rho + arm * c)
    const write = (name: string, p: Vec3) => `${name} = (${p.x}, ${p.y}, ${p.z})`
    return {
      spec: [SOLID_CUBE, write('P', from), write('V', vertex), write('Q', to), 'angle: P-V-Q'].join('\n'),
      middle: authorToWorld(at(shift, 0)),
      ends: [authorToWorld(at(shift - rho * s, -rho + rho * c)), authorToWorld(at(shift + rho * s, -rho + rho * c))],
    }
  }

  it('decides a whole arc by its middle: middle hidden, ends seen, drawn dashed whole', () => {
    const { spec, middle, ends } = arcBehindCube(0)
    // The premises, checked against the cube itself.
    const cube = buildSolidFigure(parseSpec(SOLID_CUBE).statements, value).solids.get('S')!
    expect(hidesPoint(cube, middle, DEFAULT_CAMERA)).toBe(true)
    for (const end of ends) expect(hidesPoint(cube, end, DEFAULT_CAMERA)).toBe(false)
    const result = rendered(spec)
    expect(result.errors).toEqual([])
    const statement = MARK + 4
    expect(elements(layer(result.svg, 'marks'), 'path', statement)).toHaveLength(0)
    const hidden = elements(layer(result.svg, 'auxiliary'), 'path', statement)
    expect(hidden).toHaveLength(1)
    expect(dashed(hidden[0])).toBe(true)
  })

  it('draws the same arc solid once its middle moves clear of the cube', () => {
    const { spec, middle } = arcBehindCube(1)
    const cube = buildSolidFigure(parseSpec(SOLID_CUBE).statements, value).solids.get('S')!
    expect(hidesPoint(cube, middle, DEFAULT_CAMERA)).toBe(false)
    const svg = rendered(spec).svg
    const statement = MARK + 4
    expect(elements(layer(svg, 'auxiliary'), 'path', statement)).toHaveLength(0)
    expect(elements(layer(svg, 'marks'), 'path', statement)).toHaveLength(1)
  })

  it('renders byte-identically twice', () => {
    const spec = `${SOLID_CUBE}\nangle: A-B-G\nright-angle: A-B-F\ntick: A-G count: 3\nlabel: angle CBF`
    expect(rendered(spec).svg).toBe(rendered(spec).svg)
  })
})

// ---------------------------------------------------------------------------
// Task 3 — the dihedral angle, drawn as its plane angle on the edge (M3)
// ---------------------------------------------------------------------------

describe("a dihedral mark is its plane angle at the edge's midpoint (M3)", () => {
  const AIME = '@mode: figure\n@angle: degrees\nS = solid prism regular 6 side 12, height sqrt(108) vertices ABCDEFGHIJKL'
  const pointsOf = (spec: string) => buildSolidFigure(parseSpec(spec).statements, value).points

  // The construction segments of one statement, by which half-plane each
  // lies in: data-object "<dihedral>:<end name>".
  function pieces(svg: string, statement: number, object: string): { dashed: boolean }[] {
    const out: { dashed: boolean }[] = []
    for (const name of ['auxiliary', 'primary']) {
      for (const line of elements(layer(svg, name), 'line', statement)) {
        if (line.includes(`data-object="${object}"`)) out.push({ dashed: line.includes('stroke-dasharray') })
      }
    }
    return out
  }

  // Corrected from the plan (0.3 |BF| on both): a segment is capped at its
  // end point's distance from the edge, so the one toward A ends AT A.
  it('draws two segments from the midpoint of BF toward A and G, capped at A, in the AIME prism', () => {
    const points = pointsOf(AIME)
    const [a, b, f, g] = ['A', 'B', 'F', 'G'].map((n) => points.get(n)!)
    const m = { x: (b.x + f.x) / 2, y: (b.y + f.y) / 2, z: (b.z + f.z) / 2 }
    // Hand values: BF is the hexagon's short diagonal, 12 sqrt3; A is 6 from
    // it (12 cos 60) on the axis of symmetry through M, and G is sqrt(108)
    // above A, so |G - M| = sqrt(36 + 108) = 12. Both offsets are already
    // square to BF here.
    const length = (p: Vec3, q: Vec3) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)
    expect(length(b, f)).toBeCloseTo(12 * Math.sqrt(3), 12)
    expect(length(a, m)).toBeCloseTo(6, 12)
    expect(length(g, m)).toBeCloseTo(12, 12)
    // 0.3 |BF| = 3.6 sqrt3 = 6.24 is longer than |A - M| = 6: the segments
    // are 6 long, so the first ends at A.
    expect(0.3 * 12 * Math.sqrt(3)).toBeGreaterThan(6)
    const ell = 6
    const toward = (p: Vec3, d: number) => ({ x: m.x + (ell * (p.x - m.x)) / d, y: m.y + (ell * (p.y - m.y)) / d, z: m.z + (ell * (p.z - m.z)) / d })
    const mark = dihedralMark(dihedral3(a, b, f, g, { from: 'A', a: 'B', b: 'F', to: 'G' }), length(b, f))
    const want = [toward(a, 6), toward(g, 12)]
    mark.ends.forEach((end, i) => {
      expect(end.x).toBeCloseTo(want[i].x, 12)
      expect(end.y).toBeCloseTo(want[i].y, 12)
      expect(end.z).toBeCloseTo(want[i].z, 12)
    })
    // The arc between them: radius 0.2 x the segment, sweeping the 60.
    expect(mark.arc.radius).toBeCloseTo(0.2 * ell, 12)
    expect(mark.arc.sweep).toBeCloseTo(Math.PI / 3, 12)
  })

  it("points the cube's segments square to the edge, where the raw offsets are not", () => {
    // Edge BC, M = (1, 1/2, 0). A - M = (-1, -1/2, 0) and G - M = (0, 1/2, 1)
    // are not square to BC; their square parts are -x and +z, and the
    // segments are 0.3 long.
    const mark = dihedralMark(dihedral3(A, B, author(1, 1, 0), G, { from: 'A', a: 'B', b: 'C', to: 'G' }), 1)
    const want = [author(0.7, 0.5, 0), author(1, 0.5, 0.3)]
    mark.ends.forEach((end, i) => {
      expect(end.x).toBeCloseTo(want[i].x, 14)
      expect(end.y).toBeCloseTo(want[i].y, 14)
      expect(end.z).toBeCloseTo(want[i].z, 14)
    })
    expect(mark.arc.sweep).toBeCloseTo(Math.PI / 2, 14)
    expect(mark.arc.radius).toBeCloseTo(0.06, 14)
  })

  it('draws the AIME dihedral: both segments dashed, an arc, and the label 60', () => {
    const result = rendered(`${AIME}\ndihedral: A-B-F-G\nlabel: dihedral A-B-F-G`)
    expect(result.errors).toEqual([])
    // The segment in face ABF lies in the base, which faces away; the one in
    // plane GBF runs through the prism's inside. Both are hidden, and
    // neither is split.
    expect(pieces(result.svg, 1, 'A-BF-G:A')).toEqual([{ dashed: true }])
    expect(pieces(result.svg, 1, 'A-BF-G:G')).toEqual([{ dashed: true }])
    const arcs = [...elements(layer(result.svg, 'marks'), 'path', 1), ...elements(layer(result.svg, 'auxiliary'), 'path', 1)]
    expect(arcs).toHaveLength(1)
    expect(arcs[0]).toContain('data-object="A-BF-G"')
    expect(arcs[0]).toMatch(/ A [-\d.]+ [-\d.]+ /)
    expect(layer(result.svg, 'labels')).toContain('>60°</text>')
  })

  it("draws the cube's dihedral: the segment in the hidden base dashed, the one on the front face solid", () => {
    const result = rendered(`@angle: degrees\n${SOLID_CUBE}\ndihedral: A-B-C-G\nlabel: dihedral A-B-C-G`)
    expect(result.errors).toEqual([])
    const statement = MARK + 1
    expect(pieces(result.svg, statement, 'A-BC-G:A')).toEqual([{ dashed: true }])
    expect(pieces(result.svg, statement, 'A-BC-G:G')).toEqual([{ dashed: false }])
    expect(layer(result.svg, 'labels')).toContain('>90°</text>')
  })

  it('splits a construction segment exactly where a second solid starts to hide it', () => {
    // A sphere of radius 0.05 in front of (1, 1/2, 0.25), the upper part of
    // the segment on the face x = 1, which runs from (1, 1/2, 0) to
    // (1, 1/2, 0.3). Its midpoint, at z = 0.15, is clear of the sphere, so a
    // segment judged by its midpoint would be drawn solid whole.
    const d = worldToAuthor(DEFAULT_CAMERA.direction)
    const centre = { x: 1 + 2 * d.x, y: 0.5 + 2 * d.y, z: 0.25 + 2 * d.z }
    const spec = [
      '@angle: degrees',
      SOLID_CUBE,
      `O = (${centre.x}, ${centre.y}, ${centre.z})`,
      'K = solid sphere center O radius 0.05',
      'dihedral: A-B-C-G',
    ].join('\n')
    const scope = buildSolidFigure(parseSpec(spec).statements, value)
    const ball = scope.solids.get('K')!
    expect(hidesPoint(ball, author(1, 0.5, 0.25), DEFAULT_CAMERA)).toBe(true)
    expect(hidesPoint(ball, author(1, 0.5, 0.15), DEFAULT_CAMERA)).toBe(false)
    const result = rendered(spec)
    expect(result.errors).toEqual([])
    const drawn = pieces(result.svg, MARK + 3, 'A-BC-G:G')
    expect(drawn.filter((p) => p.dashed)).toHaveLength(1)
    expect(drawn.filter((p) => !p.dashed).length).toBeGreaterThanOrEqual(1)
  })

  it('refuses an edge of one point and an end on the edge line', () => {
    expect(rendered(`${CUBE}\ndihedral: A-B-B-G`).errors.map((e) => e.message)).toEqual([expect.stringMatching(/B and B are the same point/)])
    expect(rendered(`${CUBE}\nK = (2, 0, 0)\ndihedral: K-A-B-G`).errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/K lies on the line A-B/),
    ])
  })

  it('refuses a dihedral whose half-planes make one plane: it has no plane angle to draw', () => {
    // D = (0, 1, 0) and K = (0, -1, 0) lie on opposite sides of the edge
    // A-B in one plane: 180.
    const errors = rendered(`${CUBE}\nK = (0, -1, 0)\ndihedral: D-A-B-K`).errors.map((e) => e.message)
    expect(errors).toEqual(['The half-planes of dihedral D-A-B-K lie in one plane (it measures 180°), so it has no plane angle to draw'])
  })

  it('refuses a dihedral on points in the plane', () => {
    const errors = rendered('@mode: figure\nA = (0, 0)\nB = (1, 0)\nC = (0, 1)\nD = (1, 1)\ndihedral: C-A-B-D').errors.map((e) => e.message)
    expect(errors).toEqual([expect.stringMatching(/dihedral: C-A-B-D.*points in space/)])
  })

  it('draws one mark, not two, for a "dihedral:" and its label', () => {
    const svg = rendered(`${AIME}\ndihedral: A-B-F-G\nlabel: dihedral G-F-B-A`).svg
    const arcs = [...layer(svg, 'marks').matchAll(/<path /g), ...layer(svg, 'auxiliary').matchAll(/<path [^>]*data-object="[AG]-BF-[GA]"/g)]
    expect(arcs).toHaveLength(1)
    expect(layer(svg, 'auxiliary').match(/data-object="[AG]-(BF|FB)-[GA]:/g)).toHaveLength(2)
  })

  it('renders byte-identically twice', () => {
    const spec = `${AIME}\ndihedral: A-B-F-G\nlabel: dihedral A-B-F-G`
    expect(rendered(spec).svg).toBe(rendered(spec).svg)
  })
})
