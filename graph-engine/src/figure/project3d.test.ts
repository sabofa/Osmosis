import { describe, expect, it } from 'vitest'
import { LIGHT_PALETTE } from '../render/palette'
import {
  CAMERA_DIRECTION,
  drawEdge,
  edgeExtremes,
  edgeObject,
  faceNormal,
  projectPoint,
  projectSolid,
  type ProjectedArc,
  rectangularPrism,
  renderSolidFigure,
} from './project3d'

const COS30 = Math.sqrt(3) / 2

describe('the fixed axonometric camera', () => {
  it('projects the origin and the three basis vectors to hand-computed coordinates', () => {
    expect(projectPoint({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0 })

    const ex = projectPoint({ x: 1, y: 0, z: 0 })
    expect(ex.x).toBeCloseTo(COS30, 12)
    expect(ex.y).toBeCloseTo(-0.5, 12)

    const ey = projectPoint({ x: 0, y: 1, z: 0 })
    expect(ey.x).toBeCloseTo(0, 12)
    expect(ey.y).toBeCloseTo(1, 12)

    const ez = projectPoint({ x: 0, y: 0, z: 1 })
    expect(ez.x).toBeCloseTo(-COS30, 12)
    expect(ez.y).toBeCloseTo(-0.5, 12)
  })

  it('is linear, which is what makes it a drawing rather than a perspective scene', () => {
    const a = { x: 2, y: -3, z: 5 }
    const b = { x: -1, y: 4, z: 0.5 }
    const sum = projectPoint({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
    const pa = projectPoint(a)
    const pb = projectPoint(b)
    expect(sum.x).toBeCloseTo(pa.x + pb.x, 12)
    expect(sum.y).toBeCloseTo(pa.y + pb.y, 12)
  })

  it('collapses exactly the view axis, and nothing else', () => {
    // (1,1,1) is the direction the camera looks along, so it projects to a
    // point. Anything not parallel to it must not.
    const along = projectPoint({ x: 1, y: 1, z: 1 })
    expect(along.x).toBeCloseTo(0, 12)
    expect(along.y).toBeCloseTo(0, 12)
    const across = projectPoint({ x: 1, y: -1, z: 1 })
    expect(Math.hypot(across.x, across.y)).toBeGreaterThan(0.5)
  })

  it('keeps parallel lines parallel — no convergence to read values against', () => {
    const d = { x: 1, y: 2, z: -0.5 }
    const first = [projectPoint({ x: 0, y: 0, z: 0 }), projectPoint(d)]
    const second = [projectPoint({ x: 3, y: 0, z: 1 }), projectPoint({ x: 3 + d.x, y: d.y, z: 1 + d.z })]
    const angle = (p: { x: number; y: number }[]) => Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x)
    expect(angle(first)).toBeCloseTo(angle(second), 12)
  })
})

describe('face orientation', () => {
  it('computes an outward normal from a face in the winding the solid declares', () => {
    const prism = rectangularPrism(2, 2, 2)
    // Face 0 is the +z face (see rectangularPrism).
    const n = faceNormal(prism, 0)
    expect(n.x).toBeCloseTo(0, 12)
    expect(n.y).toBeCloseTo(0, 12)
    expect(n.z).toBeGreaterThan(0)
  })

  it('points the camera direction at the near corner', () => {
    expect(CAMERA_DIRECTION.x).toBeGreaterThan(0)
    expect(CAMERA_DIRECTION.y).toBeGreaterThan(0)
    expect(CAMERA_DIRECTION.z).toBeGreaterThan(0)
  })
})

describe('the rectangular prism', () => {
  it('has eight vertices, six faces and twelve edges', () => {
    const prism = rectangularPrism(4, 3, 2)
    expect(prism.vertices).toHaveLength(8)
    expect(prism.faces).toHaveLength(6)
    expect(projectSolid(prism)).toHaveLength(12)
  })

  it('has the dimensions it was asked for', () => {
    const prism = rectangularPrism(4, 3, 2)
    const xs = prism.vertices.map((v) => v.x)
    const ys = prism.vertices.map((v) => v.y)
    const zs = prism.vertices.map((v) => v.z)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4, 12)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(3, 12)
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2, 12)
  })
})

describe('hidden-edge classification', () => {
  it('hides exactly the three edges at the far corner of a box', () => {
    const prism = rectangularPrism(2, 2, 2)
    const edges = projectSolid(prism)
    const hidden = edges.filter((e) => e.hidden)
    expect(hidden).toHaveLength(3)

    // The far corner is the one with every coordinate at its minimum: it is
    // the vertex pointing directly away from the camera.
    const farCorner = prism.vertices.findIndex((v) => v.x < 0 && v.y < 0 && v.z < 0)
    for (const edge of hidden) {
      expect(edge.vertices).toContain(farCorner)
    }
  })

  it('leaves the other nine visible', () => {
    const edges = projectSolid(rectangularPrism(2, 2, 2))
    expect(edges.filter((e) => !e.hidden)).toHaveLength(9)
  })

  it('classifies by which faces face the camera, not by depth alone', () => {
    // A very flat box: the hidden set is still the three edges at the far
    // corner, because the classification is about face orientation. A rule
    // written on projected depth would get a squashed box wrong.
    const edges = projectSolid(rectangularPrism(8, 0.4, 8))
    expect(edges.filter((e) => e.hidden)).toHaveLength(3)
  })
})

describe('drawing the solid', () => {
  it('produces a complete, well-formed svg', () => {
    const svg = renderSolidFigure(rectangularPrism(4, 3, 2), LIGHT_PALETTE)
    expect(svg.startsWith('<svg ')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).toContain('viewBox="')
  })

  it('draws twelve edges, dashing exactly the hidden three', () => {
    const svg = renderSolidFigure(rectangularPrism(4, 3, 2), LIGHT_PALETTE)
    const lines = [...svg.matchAll(/<line [^>]*\/>/g)].map((m) => m[0])
    expect(lines).toHaveLength(12)
    expect(lines.filter((l) => l.includes('stroke-dasharray'))).toHaveLength(3)
  })

  it('puts the hidden edges behind the visible ones', () => {
    const svg = renderSolidFigure(rectangularPrism(4, 3, 2), LIGHT_PALETTE)
    expect(svg.indexOf('data-layer="auxiliary"')).toBeLessThan(svg.indexOf('data-layer="primary"'))
    expect(svg).toContain('stroke-dasharray')
  })

  it('renders byte-identical svg twice', () => {
    const build = () => renderSolidFigure(rectangularPrism(4, 3, 2), LIGHT_PALETTE)
    expect(build()).toBe(build())
  })
})


// ---------------------------------------------------------------------------
// H3 — the drawn-edge type carries arcs
// ---------------------------------------------------------------------------

// The prism exactly as it was emitted BEFORE the edge type was widened,
// captured from the working tree at commit eab44ef and pasted here verbatim.
//
// This is the whole of what "a widening, not a rewrite" means, and a literal
// is the only form of it that cannot quietly drift: a test that re-derived
// the expected output from the code would agree with any change at all.
const PRISM_4_3_2_BEFORE_ARCS =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-295.128 -338 590.256 676" preserveAspectRatio="xMidYMid meet"><rect x="-295.128" y="-338" width="590.256" height="676" fill="#fdf6ea" data-layer="paper"/><g data-layer="regions"/><g data-layer="auxiliary"><line x1="-92.376" y1="0" x2="277.128" y2="213.333" stroke="#17170f" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="9 7" opacity="0.6" data-statement="0" data-object="edge-0-1"/><line x1="-92.376" y1="0" x2="-92.376" y2="-320" stroke="#17170f" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="9 7" opacity="0.6" data-statement="0" data-object="edge-0-3"/><line x1="-92.376" y1="0" x2="-277.128" y2="106.667" stroke="#17170f" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="9 7" opacity="0.6" data-statement="0" data-object="edge-0-4"/></g><g data-layer="primary"><line x1="-277.128" y1="106.667" x2="92.376" y2="320" stroke="#17170f" stroke-width="2.4" stroke-linecap="round" data-statement="0" data-object="edge-4-5"/><line x1="92.376" y1="320" x2="92.376" y2="0" stroke="#17170f" stroke-width="2.4" stroke-linecap="round" data-statement="0" data-object="edge-5-6"/><line x1="92.376" y1="0" x2="-277.128" y2="-213.333" stroke="#17170f" stroke-width="2.4" stroke-linecap="round" data-statement="0" data-object="edge-6-7"/><line x1="-277.128" y1="106.667" x2="-277.128" y2="-213.333" stroke="#17170f" stroke-width="2.4" stroke-linecap="round" data-statement="0" data-object="edge-4-7"/><line x1="277.128" y1="-106.667" x2="-92.376" y2="-320" stroke="#17170f" stroke-width="2.4" stroke-linecap="round" data-statement="0" data-object="edge-2-3"/><line x1="277.128" y1="213.333" x2="277.128" y2="-106.667" stroke="#17170f" stroke-width="2.4" stroke-linecap="round" data-statement="0" data-object="edge-1-2"/><line x1="277.128" y1="213.333" x2="92.376" y2="320" stroke="#17170f" stroke-width="2.4" stroke-linecap="round" data-statement="0" data-object="edge-1-5"/><line x1="277.128" y1="-106.667" x2="92.376" y2="0" stroke="#17170f" stroke-width="2.4" stroke-linecap="round" data-statement="0" data-object="edge-2-6"/><line x1="-92.376" y1="-320" x2="-277.128" y2="-213.333" stroke="#17170f" stroke-width="2.4" stroke-linecap="round" data-statement="0" data-object="edge-3-7"/></g><g data-layer="marks"/><g data-layer="points"/><g data-layer="labels"/></svg>'

describe('the widened drawn-edge type', () => {
  it('emits a polyhedron byte for byte as it did before arcs existed', () => {
    expect(renderSolidFigure(rectangularPrism(4, 3, 2), LIGHT_PALETTE)).toBe(PRISM_4_3_2_BEFORE_ARCS)
  })

  it('marks every edge of a polyhedron as a segment', () => {
    for (const edge of projectSolid(rectangularPrism(4, 3, 2))) expect(edge.kind).toBe('segment')
  })

  const ARC: ProjectedArc = {
    kind: 'arc',
    center: { x: 0, y: 0 },
    rx: 4,
    ry: 2,
    rotation: 0,
    startAngle: 0,
    endAngle: Math.PI,
    hidden: false,
    object: 'rim-front',
  }

  const identity = (p: { x: number; y: number }) => p

  it('emits an arc as a path arc, never as a sampled polyline', () => {
    const markup = drawEdge(ARC, identity, 1, { stroke: '#000' })
    expect(markup.startsWith('<path ')).toBe(true)
    expect(markup).not.toContain('<polyline')
    // One `A` command, with both radii, the rotation in degrees and the two
    // flags — the whole curve, at any zoom.
    expect(markup).toContain('d="M 4 0 A 4 2 0 0 0 -4 0"')
    expect(markup).toContain('fill="none"')
  })

  it('negates the rotation and both parameters, because view space flips y', () => {
    const tilted: ProjectedArc = { ...ARC, rotation: Math.PI / 6, endAngle: Math.PI / 2 }
    const markup = drawEdge(tilted, identity, 1, { stroke: '#000' })
    // rotation -30 degrees, and the sweep runs the other way round, so the
    // sweep flag is 0 rather than 1.
    expect(markup).toContain('A 4 2 -30 0 0 ')
  })

  it('scales an arc with the figure projection, radii and all', () => {
    const markup = drawEdge(ARC, (p) => ({ x: p.x * 10, y: p.y * 10 }), 10, { stroke: '#000' })
    expect(markup).toContain('d="M 40 0 A 40 20 0 0 0 -40 0"')
  })

  it('dashes a hidden arc exactly as it dashes a hidden segment', () => {
    const style = (hidden: boolean) => ({ stroke: '#000', 'stroke-dasharray': hidden ? '9 7' : null })
    const hiddenArc = drawEdge({ ...ARC, hidden: true }, identity, 1, style(true))
    const visibleArc = drawEdge(ARC, identity, 1, style(false))
    expect(hiddenArc).toContain('stroke-dasharray="9 7"')
    expect(visibleArc).not.toContain('stroke-dasharray')
  })

  it('names an arc by its own object, since it has no vertices to name it', () => {
    expect(edgeObject(ARC)).toBe('rim-front')
    expect(edgeObject(projectSolid(rectangularPrism(2, 2, 2))[0])).toMatch(/^edge-\d+-\d+$/)
  })

  it('bounds a half-ellipse by its bulge, not by its two ends', () => {
    const points = edgeExtremes(ARC)
    const ys = points.map((p) => p.y)
    // The sweep runs from (4,0) up through (0,2) to (-4,0): the bulge at
    // parameter pi/2 is the top, and an outline bounded by the ends alone
    // would crop it.
    expect(Math.max(...ys)).toBeCloseTo(2, 12)
    expect(Math.min(...ys)).toBeCloseTo(0, 12)
    expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(4, 12)
    expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(-4, 12)
  })

  it('bounds a tilted arc by the ellipse parameters where it turns back', () => {
    // A quarter of an ellipse tilted 45 degrees. Its widest point in x is not
    // an endpoint, and the bound has to find it.
    const quarter: ProjectedArc = { ...ARC, rotation: Math.PI / 4, startAngle: -Math.PI / 4, endAngle: Math.PI / 2 }
    const points = edgeExtremes(quarter)
    const widest = Math.max(...points.map((p) => p.x))
    // x(t) = 4 cos45 cos t - 2 sin45 sin t, whose maximum over all t is
    // sqrt((4 cos45)^2 + (2 sin45)^2) = sqrt(8 + 2) = sqrt(10).
    expect(widest).toBeCloseTo(Math.sqrt(10), 12)
  })

  it('bounds a segment by its own two ends and nothing else', () => {
    const segment = projectSolid(rectangularPrism(2, 2, 2))[0]
    expect(edgeExtremes(segment)).toEqual([segment.a, segment.b])
  })
})
