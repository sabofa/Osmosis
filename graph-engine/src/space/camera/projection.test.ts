import { describe, expect, it } from 'vitest'
import type { SpaceView } from '../config'
import type { Box3, Vec3 } from '../scene/types'
import { cameraMatrices, project, rayAt } from './projection'
import { eyeDirection, screenBasis } from './turntable'
import { worldMap } from './world'

const CUBE: Box3 = { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }
const EQUAL = worldMap(CUBE, [1, 1, 1])
const VIEWPORT = { width: 800, height: 600 }
const VIEW: SpaceView = { azimuth: 40, elevation: 25, zoom: 1, target: [0, 0, 0] }

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

// Distance from p to the line through `origin` along unit `direction`.
function distanceToRay(p: Vec3, origin: Vec3, direction: Vec3): number {
  const v: Vec3 = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]]
  const along = dot(v, direction)
  const perp: Vec3 = [v[0] - along * direction[0], v[1] - along * direction[1], v[2] - along * direction[2]]
  return Math.hypot(perp[0], perp[1], perp[2])
}

describe('the turntable basis', () => {
  it('looks from azimuth/elevation: d = (cos el cos az, cos el sin az, sin el)', () => {
    const d = eyeDirection(VIEW)
    const el = (25 * Math.PI) / 180
    const az = (40 * Math.PI) / 180
    expect(d[0]).toBeCloseTo(Math.cos(el) * Math.cos(az), 15)
    expect(d[1]).toBeCloseTo(Math.cos(el) * Math.sin(az), 15)
    expect(d[2]).toBeCloseTo(Math.sin(el), 15)
  })

  it('screen right at azimuth 40 is (-sin 40, cos 40, 0) = (-0.6427876, 0.7660444, 0)', () => {
    const { right, up, forward } = screenBasis(VIEW)
    expect(right[0]).toBeCloseTo(-0.6427876, 7)
    expect(right[1]).toBeCloseTo(0.7660444, 7)
    expect(right[2]).toBe(0)
    // up = right x forward, and z is up on screen.
    expect(up[2]).toBeGreaterThan(0)
    expect(dot(up, forward)).toBeCloseTo(0, 15)
    expect(dot(right, up)).toBeCloseTo(0, 15)
  })
})

describe('projection', () => {
  for (const projection of ['orthographic', 'perspective'] as const) {
    it(`${projection}: +x moves left, +y moves right, +z moves up on screen`, () => {
      const m = cameraMatrices(VIEW, EQUAL, VIEWPORT, projection)
      const o = project(m, [0, 0, 0])
      const px = project(m, [1, 0, 0])
      const py = project(m, [0, 1, 0])
      const pz = project(m, [0, 0, 1])
      expect(px.x - o.x).toBeLessThan(0)
      expect(py.x - o.x).toBeGreaterThan(0)
      expect(pz.y - o.y).toBeLessThan(0)
    })
  }

  it('orthographic, equal extents: screen-x of unit +x over unit +y is -0.6427876 / 0.7660444 = -0.8390996', () => {
    const m = cameraMatrices(VIEW, EQUAL, VIEWPORT, 'orthographic')
    const o = project(m, [0, 0, 0])
    const ratio = (project(m, [1, 0, 0]).x - o.x) / (project(m, [0, 1, 0]).x - o.x)
    expect(ratio).toBeCloseTo(-0.8390996, 7)
  })

  it('orthographic: the target projects to the viewport centre and the half-height is |h| * 1.35 / zoom', () => {
    const m = cameraMatrices({ ...VIEW, zoom: 2 }, EQUAL, VIEWPORT, 'orthographic')
    const o = project(m, [0, 0, 0])
    expect(o.x).toBeCloseTo(400, 9)
    expect(o.y).toBeCloseTo(300, 9)
    // H = sqrt(3) * 1.35 / 2 world units across 300 px.
    const H = (Math.sqrt(3) * 1.35) / 2
    expect(m.worldPerPixel).toBeCloseTo((2 * H) / 600, 12)
  })

  it('orthographic in a portrait viewport fits the bounding sphere across the width', () => {
    const m = cameraMatrices(VIEW, EQUAL, { width: 300, height: 600 }, 'orthographic')
    // Half-width = |h| * 1.35 across 150 px.
    expect(m.worldPerPixel).toBeCloseTo((2 * Math.sqrt(3) * 1.35) / 300, 12)
  })

  it('near and far bracket the box sphere, never a fixed 0.1..1000', () => {
    for (const projection of ['orthographic', 'perspective'] as const) {
      const m = cameraMatrices(VIEW, EQUAL, VIEWPORT, projection)
      // Every corner of the box lands strictly inside the depth range.
      for (const x of [-1, 1])
        for (const y of [-1, 1])
          for (const z of [-1, 1]) {
            const p = project(m, [x, y, z])
            expect(p.depth).toBeGreaterThan(-1)
            expect(p.depth).toBeLessThan(1)
          }
    }
  })

  for (const projection of ['orthographic', 'perspective'] as const) {
    it(`${projection}: rayAt of the projection of (0.3, -0.2, 0.5) passes within 1e-9 of it`, () => {
      const m = cameraMatrices(VIEW, EQUAL, VIEWPORT, projection)
      const p: Vec3 = [0.3, -0.2, 0.5]
      const s = project(m, p)
      const ray = rayAt(m, s.x, s.y)
      expect(Math.hypot(...ray.direction)).toBeCloseTo(1, 12)
      expect(distanceToRay(p, ray.origin, ray.direction)).toBeLessThan(1e-9)
    })
  }

  it('orthographic rays are all parallel to the view direction', () => {
    const m = cameraMatrices(VIEW, EQUAL, VIEWPORT, 'orthographic')
    const forward = screenBasis(VIEW).forward
    const a = rayAt(m, 10, 20)
    const b = rayAt(m, 700, 500)
    expect(dot(a.direction, forward)).toBeCloseTo(1, 12)
    expect(dot(b.direction, forward)).toBeCloseTo(1, 12)
  })

  it('the target is in author coordinates: a box centred at (4500, 0, 0) centres on its own target', () => {
    const box: Box3 = { x: { min: 4499, max: 4501 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }
    const world = worldMap(box, [1, 1, 1])
    const m = cameraMatrices({ ...VIEW, target: [4500, 0, 0] }, world, VIEWPORT, 'orthographic')
    const o = project(m, world.toWorld([4500, 0, 0]))
    expect(o.x).toBeCloseTo(400, 9)
    expect(o.y).toBeCloseTo(300, 9)
  })
})
