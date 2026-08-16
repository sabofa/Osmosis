import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { buildScene3d } from './buildScene3d'

function build(spec: string) {
  const parsed = parseSpec(spec)
  return buildScene3d(parsed.statements, parsed.config)
}

describe('buildScene3d', () => {
  it('samples an explicit surface with the correct z values', () => {
    const scene = build('z = x * y')
    const surface = scene.objects.find((o) => o.kind === 'surface3d')
    if (surface?.kind !== 'surface3d') throw new Error('unreachable')
    const p = surface.positions.find((pt) => pt.x === -5 && pt.y === -5)
    expect(p?.z).toBeCloseTo(25)
  })

  it('resolves a named function used in a surface, forward-referenced', () => {
    const scene = build('z = k(x) + y\nk(a) = a^2')
    expect(scene.errors).toEqual([])
    const surface = scene.objects.find((o) => o.kind === 'surface3d')
    if (surface?.kind !== 'surface3d') throw new Error('unreachable')
    const p = surface.positions.find((pt) => pt.x === 2 && pt.y === 3)
    // z = k(2) + 3 = 2^2 + 3 = 7
    expect(p?.z).toBeCloseTo(7)
  })

  it('lifts a 2D explicit curve onto the z=0 plane', () => {
    const scene = build('y = x^2\nA = (0, 0, 1)') // z-bearing point forces 3D mode
    const curve = scene.objects.find((o) => o.kind === 'curve3d')
    if (curve?.kind !== 'curve3d') throw new Error('unreachable')
    expect(curve.points.every((p) => p.z === 0)).toBe(true)
  })

  it('lifts a 2D implicit curve (ellipse) onto the z=0 plane', () => {
    const scene = build('x^2/9 + y^2/4 = 1\nA = (0,0,1)')
    const segments = scene.objects.filter((o) => o.kind === 'segment3d')
    expect(segments.length).toBeGreaterThan(0)
    expect(segments.every((s) => s.kind === 'segment3d' && s.from.z === 0 && s.to.z === 0)).toBe(true)
  })

  it('builds a parametric curve with a z component', () => {
    const scene = build('(cos(t), sin(t), t*0.1) for t in [0, 6.283]')
    const curve = scene.objects.find((o) => o.kind === 'curve3d')
    if (curve?.kind !== 'curve3d') throw new Error('unreachable')
    expect(curve.points[curve.points.length - 1].z).toBeGreaterThan(0)
  })
})
