import { describe, expect, it } from 'vitest'
import type { SpaceView } from '../config'
import type { Box3, Vec3 } from '../scene/types'
import { INERTIA_TAU_MS, inertiaStep, orbit, pan, reset, wrapAzimuth, zoomAt } from './controls'
import { cameraMatrices, project } from './projection'
import { screenBasis } from './turntable'
import { worldMap } from './world'

const CUBE: Box3 = { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }
const EQUAL = worldMap(CUBE, [1, 1, 1])
const VIEWPORT = { width: 800, height: 600 }
const VIEW: SpaceView = { azimuth: 40, elevation: 25, zoom: 1, target: [0, 0, 0] }

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

describe('orbit', () => {
  it('turns 0.4 degrees per pixel: right decreases azimuth, down increases elevation', () => {
    const v = orbit(VIEW, 10, 5)
    expect(v.azimuth).toBeCloseTo(36, 12)
    expect(v.elevation).toBeCloseTo(27, 12)
    expect(v.zoom).toBe(1)
    expect(v.target).toEqual([0, 0, 0])
  })

  it('clamps elevation 90 to 89.5, and the basis there stays finite, orthonormal and upright', () => {
    // 25 + 0.4 * 162.5 = 90 exactly without the clamp.
    const v = orbit(VIEW, 0, 162.5)
    expect(v.elevation).toBe(89.5)
    const past = orbit(VIEW, 0, 1000)
    expect(past.elevation).toBe(89.5)
    expect(orbit(VIEW, 0, -1000).elevation).toBe(-89.5)
    for (const view of [v, past]) {
      const { right, up, forward } = screenBasis(view)
      for (const c of [...right, ...up, ...forward]) expect(Number.isFinite(c)).toBe(true)
      expect(Math.hypot(...right)).toBeCloseTo(1, 12)
      expect(Math.hypot(...up)).toBeCloseTo(1, 12)
      expect(Math.hypot(...forward)).toBeCloseTo(1, 12)
      expect(dot(right, up)).toBeCloseTo(0, 12)
      expect(dot(up, forward)).toBeCloseTo(0, 12)
      expect(dot(right, forward)).toBeCloseTo(0, 12)
      // Upright: world +z still reads as screen up.
      expect(up[2]).toBeGreaterThan(0)
    }
  })

  it('wraps azimuth into (-180, 180]', () => {
    // 400 px right from 170: 170 - 160 = 10 (no wrap needed under the grab convention).
    expect(orbit({ ...VIEW, azimuth: 170 }, 400, 0).azimuth).toBeCloseTo(10, 12)
    // 400 px left from 170: 170 + 160 = 330, which wraps to -30.
    expect(orbit({ ...VIEW, azimuth: 170 }, -400, 0).azimuth).toBeCloseTo(-30, 12)
    // 400 px right from -170: -330 wraps to 30.
    expect(orbit({ ...VIEW, azimuth: -170 }, 400, 0).azimuth).toBeCloseTo(30, 12)
    expect(wrapAzimuth(180)).toBe(180)
    expect(wrapAzimuth(-180)).toBe(180)
    expect(wrapAzimuth(540)).toBe(180)
    expect(wrapAzimuth(-190)).toBe(170)
  })
})

describe('pan', () => {
  for (const projection of ['orthographic', 'perspective'] as const) {
    it(`${projection}: panning by (+50, 0) px puts the new target 50 px left of centre in the old camera`, () => {
      const before = cameraMatrices(VIEW, EQUAL, VIEWPORT, projection)
      const panned = pan(VIEW, 50, 0, VIEWPORT, EQUAL, projection)
      const t = project(before, EQUAL.toWorld(panned.target))
      expect(t.x).toBeCloseTo(400 - 50, 9)
      expect(t.y).toBeCloseTo(300, 9)
      // And the content follows the cursor: the old target moves 50 px right.
      const after = cameraMatrices(panned, EQUAL, VIEWPORT, projection)
      const old = project(after, EQUAL.toWorld(VIEW.target))
      expect(old.x).toBeCloseTo(400 + 50, 9)
      expect(old.y).toBeCloseTo(300, 9)
    })
  }

  it('pans in author units under non-uniform scale (k = h / half-span)', () => {
    const box: Box3 = { x: { min: 0, max: 10 }, y: { min: -1, max: 1 }, z: { min: 4000, max: 5000 } }
    const world = worldMap(box, [1, 1, 0.7])
    const start: SpaceView = { ...VIEW, target: [5, 0, 4500] }
    const before = cameraMatrices(start, world, VIEWPORT, 'orthographic')
    const panned = pan(start, 30, -20, VIEWPORT, world, 'orthographic')
    const t = project(before, world.toWorld(panned.target))
    expect(t.x).toBeCloseTo(400 - 30, 6)
    expect(t.y).toBeCloseTo(300 + 20, 6)
  })
})

describe('zoomAt', () => {
  it('orthographic: an author point under the cursor stays under it to 1e-9 px', () => {
    const p: Vec3 = [0.3, -0.2, 0.5]
    const before = cameraMatrices(VIEW, EQUAL, VIEWPORT, 'orthographic')
    const s = project(before, p)
    for (const factor of [1.1, 1 / 1.1, 3]) {
      const zoomed = zoomAt(VIEW, factor, s.x, s.y, VIEWPORT, EQUAL, 'orthographic')
      expect(zoomed.zoom).toBeCloseTo(factor, 12)
      const after = project(cameraMatrices(zoomed, EQUAL, VIEWPORT, 'orthographic'), p)
      expect(Math.abs(after.x - s.x)).toBeLessThan(1e-9)
      expect(Math.abs(after.y - s.y)).toBeLessThan(1e-9)
    }
  })

  it('perspective: dollies toward the point on the target plane under the cursor, which stays put', () => {
    const before = cameraMatrices(VIEW, EQUAL, VIEWPORT, 'perspective')
    const { right, up } = before.basis
    // The target-plane point 120 px right of and 40 px above centre.
    const s = before.worldPerPixel
    const p: Vec3 = [120 * s * right[0] + 40 * s * up[0], 120 * s * right[1] + 40 * s * up[1], 120 * s * right[2] + 40 * s * up[2]]
    const at = project(before, p)
    const zoomed = zoomAt(VIEW, 1.1, at.x, at.y, VIEWPORT, EQUAL, 'perspective')
    const after = project(cameraMatrices(zoomed, EQUAL, VIEWPORT, 'perspective'), p)
    expect(after.x).toBeCloseTo(at.x, 6)
    expect(after.y).toBeCloseTo(at.y, 6)
  })

  it('clamps zoom to [0.05, 50]', () => {
    expect(zoomAt({ ...VIEW, zoom: 49 }, 1.1, 400, 300, VIEWPORT, EQUAL, 'orthographic').zoom).toBe(50)
    expect(zoomAt({ ...VIEW, zoom: 0.051 }, 1 / 1.1, 400, 300, VIEWPORT, EQUAL, 'orthographic').zoom).toBe(0.05)
  })
})

describe('reset and inertia', () => {
  it('reset returns a copy of the authored view', () => {
    const authored: SpaceView = { azimuth: 10, elevation: 20, zoom: 2, target: [1, 2, 3] }
    const r = reset(authored)
    expect(r).toEqual(authored)
    expect(r).not.toBe(authored)
  })

  it('decays exponentially with tau = 120 ms and stops below 0.02 degrees per frame', () => {
    expect(INERTIA_TAU_MS).toBe(120)
    const v = inertiaStep({ azimuth: 1, elevation: -0.5 }, 120)
    expect(v).not.toBeNull()
    expect(v!.azimuth).toBeCloseTo(Math.exp(-1), 12)
    expect(v!.elevation).toBeCloseTo(-0.5 * Math.exp(-1), 12)
    // 0.001 deg/ms is 0.0167 deg per 60 Hz frame: below the stop threshold.
    expect(inertiaStep({ azimuth: 0.001, elevation: 0 }, 1)).toBeNull()
    // 0.0015 deg/ms decays for 1 ms to about 0.0249 deg per frame: still moving.
    expect(inertiaStep({ azimuth: 0.0015, elevation: 0 }, 1)).not.toBeNull()
  })
})
