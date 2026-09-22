import { describe, expect, it } from 'vitest'
import { LIGHT_PALETTE } from '../render/palette'
import { CAMERA_DIRECTION, faceNormal, projectPoint, projectSolid, rectangularPrism, renderSolidFigure } from './project3d'

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
