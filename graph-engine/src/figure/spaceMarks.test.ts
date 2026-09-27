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
import { angleArc, angleFrame, arcPoint, projectArc, rightAngleCorners } from './spaceMarks'
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
