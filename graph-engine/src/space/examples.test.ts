import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { resolveBox } from './frame/bounds'
import { SPACE_EXAMPLES } from './examples'
import { createSpaceKernel } from './kernel/index'
import type { MeshMark } from './scene/types'

// Each S3 example must exercise what its label promises: an example whose
// feature silently stopped being drawn is a dead button (handoff lesson 4).
// examples.test.ts already builds every example with no errors.

function build(label: string) {
  const example = SPACE_EXAMPLES.find((e) => e.label === `Space · ${label}`)
  if (!example) throw new Error(`no example "${label}"`)
  const parsed = parseSpec(example.spec)
  expect(parsed.errors).toEqual([])
  const kernel = createSpaceKernel(parsed.statements, parsed.config, parsed.statementLines)
  const scene = kernel.scene()
  expect(scene.errors).toEqual([])
  return { parsed, kernel, scene }
}

describe('the S3 space examples', () => {
  it('"A diverging colormap" colours by x*y on the balance map, symmetric about zero', () => {
    const { scene } = build('A diverging colormap')
    expect(scene.colorScales).toHaveLength(1)
    const [scale] = scene.colorScales
    expect(scale).toMatchObject({ title: 'x*y', map: 'balance', diverging: true })
    expect(scale.domain.min).toBe(-scale.domain.max)
  })

  it('"Play a parameter" has a binding its surface reads', () => {
    const { kernel } = build('Play a parameter')
    expect(kernel.bindings().map((b) => b.name)).toEqual(['k'])
    const before = kernel.scene().marks[0]
    expect(kernel.setValue('k', 2).marks[0]).not.toBe(before)
  })

  it('"Drag a point on a paraboloid" has a point that drags a and b, on the surface', () => {
    const { scene } = build('Drag a point on a paraboloid')
    const point = scene.marks.find((m) => m.kind === 'points')
    expect(point?.kind === 'points' && point.drag?.params).toEqual(['a', 'b'])
    const [x, y, z] = point!.kind === 'points' ? Array.from(point!.positions) : []
    expect(z).toBeCloseTo(x * x + y * y, 12)
  })

  it('"A helix through a translucent sphere" has a translucent surface and a curve', () => {
    const { scene } = build('A helix through a translucent sphere')
    expect(scene.marks.some((m) => m.kind === 'mesh' && m.style.opacity < 1)).toBe(true)
    expect(scene.marks.some((m) => m.kind === 'lines')).toBe(true)
  })

  it('"A helix behind a surface" has an opaque surface and a curve drawn dashed where hidden', () => {
    const { scene } = build('A helix behind a surface')
    expect(scene.marks.some((m) => m.kind === 'mesh' && m.style.opacity === 1)).toBe(true)
    expect(scene.marks.some((m) => m.kind === 'lines' && m.style.hidden === 'dashed')).toBe(true)
  })

  it('"A pole cut by the box" rises far above the box, which the clip cuts', () => {
    const { parsed, scene } = build('A pole cut by the box')
    const mesh = scene.marks.find((m): m is MeshMark => m.kind === 'mesh')!
    let top = -Infinity
    for (let i = 2; i < mesh.positions.length; i += 3) top = Math.max(top, mesh.positions[i])
    const box = resolveBox(parsed.config.space, scene.extent)
    expect(top).toBeGreaterThan(10 * box.z.max)
  })
})
