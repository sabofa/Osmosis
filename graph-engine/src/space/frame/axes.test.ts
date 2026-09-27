import { describe, expect, it } from 'vitest'
import { defaultSpaceConfig, type SpaceView } from '../config'
import { cameraMatrices } from '../camera/projection'
import { worldMap } from '../camera/world'
import type { Box3 } from '../scene/types'
import { axesFrame } from './axes'
import { buildFrame } from './build'
import { frameAxes } from './ticks'

const VIEW: SpaceView = { azimuth: 40, elevation: 25, zoom: 1, target: [0, 0, 0] }

function frameFor(box: Box3, style: 'axes' | 'none' | 'box' = 'axes') {
  const world = worldMap(box, [1, 1, 1])
  const camera = cameraMatrices({ ...VIEW, target: world.centre }, world, { width: 800, height: 600 }, 'orthographic')
  const space = { ...defaultSpaceConfig(), titles: { x: 't (s)', y: 'y', z: 'E (J)' } }
  const axes = frameAxes(space, box)
  return style === 'axes' ? axesFrame(world, camera, axes) : buildFrame(style, world, camera, axes)
}

describe('axesFrame', () => {
  it('runs three axes through the origin when it is inside the box, each 8% past the max', () => {
    const f = frameFor({ x: { min: -2, max: 2 }, y: { min: -1, max: 1 }, z: { min: -1, max: 3 } })
    const axes = f.lines.filter((l) => l.role === 'axis')
    expect(axes).toHaveLength(3)
    const [x, y, z] = axes
    expect(x.a).toEqual([-2, 0, 0])
    expect(x.b[0]).toBeCloseTo(2 + 0.08 * 4, 12)
    expect([x.b[1], x.b[2]]).toEqual([0, 0])
    expect(y.a).toEqual([0, -1, 0])
    expect([y.b[0], y.b[2]]).toEqual([0, 0])
    expect(z.a).toEqual([0, 0, -1])
    expect([z.b[0], z.b[1]]).toEqual([0, 0])
  })

  it('clamps the crossing into the box: with x in [2, 5] the y and z axes run at x = 2', () => {
    const f = frameFor({ x: { min: 2, max: 5 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } })
    const [x, y, z] = f.lines.filter((l) => l.role === 'axis')
    expect(x.a).toEqual([2, 0, 0])
    expect(y.a[0]).toBe(2)
    expect(y.b[0]).toBe(2)
    expect(z.a[0]).toBe(2)
    expect(z.b[0]).toBe(2)
  })

  it('letters each axis with its title beyond the tip, and skips the tick label at the origin', () => {
    const f = frameFor({ x: { min: -2, max: 2 }, y: { min: -2, max: 2 }, z: { min: -2, max: 2 } })
    const titles = f.labels.filter((l) => l.role === 'title')
    expect(titles.map((t) => t.text)).toEqual(['t (s)', 'y', 'E (J)'])
    const xTitle = titles[0]
    expect(xTitle.position[0]).toBeGreaterThan(2)
    const ticks = f.labels.filter((l) => l.role === 'tick')
    expect(ticks.length).toBeGreaterThan(0)
    expect(ticks.some((l) => l.text === '0')).toBe(false)
  })

  it('draws short tick marks perpendicular to their axis', () => {
    const f = frameFor({ x: { min: -2, max: 2 }, y: { min: -2, max: 2 }, z: { min: -2, max: 2 } })
    const marks = f.lines.filter((l) => l.role === 'tick')
    expect(marks.length).toBeGreaterThan(0)
    for (const m of marks) {
      const d = [m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]]
      // Exactly one coordinate changes, and it is short.
      expect(d.filter((c) => c !== 0)).toHaveLength(1)
      expect(Math.hypot(d[0], d[1], d[2])).toBeLessThan(0.2)
    }
  })
})

describe('the axes frame key', () => {
  it('differs for a different box', () => {
    const a = frameFor({ x: { min: -2, max: 2 }, y: { min: -2, max: 2 }, z: { min: -2, max: 2 } })
    const b = frameFor({ x: { min: -1, max: 3 }, y: { min: -2, max: 2 }, z: { min: -2, max: 2 } })
    expect(a.key).not.toBe(b.key)
  })
})

describe('buildFrame', () => {
  it('@frame: none produces an empty model', () => {
    const f = frameFor({ x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }, 'none')
    expect(f.lines).toEqual([])
    expect(f.labels).toEqual([])
  })

  it('@frame: box builds the box frame', () => {
    const f = frameFor({ x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }, 'box')
    expect(f.lines.some((l) => l.role === 'wall')).toBe(true)
    expect(f.lines.some((l) => l.role === 'axis')).toBe(false)
  })
})
