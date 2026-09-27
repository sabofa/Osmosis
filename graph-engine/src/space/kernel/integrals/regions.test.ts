import { describe, expect, it } from 'vitest'
import type { MeshMark } from '../../scene/types'
import { approx, kernelOf, markNamed, meshArea, polylines, readout, sceneOf, vertices } from './testing'

describe('region: type I, x in [0, 1], y in [x^2, x]', () => {
  const scene = sceneOf('region: x in [0, 1], y in [x^2, x]')

  it('reads its area ≈ 1/6 (the integral of x - x^2 from 0 to 1) to 1e-10', () => {
    expect(scene.errors).toEqual([])
    expect(Math.abs(approx(readout(scene, 1).text, 'area') - 1 / 6)).toBeLessThan(1e-10)
  })

  it('draws its boundary exactly on y = x^2 and y = x, with points on both', () => {
    const boundary = markNamed(scene, 's1.boundary', 'lines')
    const onParabola = (p: number[]) => Math.abs(p[1] - p[0] * p[0]) < 1e-12
    const onLine = (p: number[]) => Math.abs(p[1] - p[0]) < 1e-12
    const points = vertices(boundary)
    expect(points.every((p) => onParabola(p) || onLine(p))).toBe(true)
    expect(points.filter((p) => onParabola(p) && p[0] > 0.1 && p[0] < 0.9).length).toBeGreaterThan(100)
    expect(points.filter((p) => onLine(p) && p[0] > 0.1 && p[0] < 0.9).length).toBeGreaterThan(100)
    // The sides x = 0 and x = 1 are single points: dropped, so two pieces of 256 segments.
    expect(polylines(boundary).map((l) => l.length)).toEqual([257, 257])
  })

  it('anchors its readout halfway along its longest boundary piece, clear of its centre and the box corners', () => {
    // the half-disc: the arc (length π) beats the diameter (2); its middle is (0, 1)
    const [x, y, z] = readout(sceneOf('region: r in [0, 1], theta in [0, pi]'), 1).position
    expect([Math.abs(x) < 1e-12, y, z]).toEqual([true, 1, 0])
    // type I: the parabola (length √5/2 + asinh(2)/4 = 1.4789) beats the line (1.4142). Half
    // its length, 0.7394, is reached at x = 0.6106 (L(0.60) = 0.7226, L(0.62) = 0.7542); the
    // anchor is the first of its 256 samples past it, x = 157/256.
    const [px, py] = readout(sceneOf('region: x in [0, 1], y in [x^2, x]'), 1).position
    expect(px).toBe(157 / 256)
    expect(py).toBeCloseTo(px * px, 12)
  })

  it('is a set: either range written high-to-low gives the same area', () => {
    // Each reverses the iterated integral's sign once.
    for (const spec of ['region: x in [1, 0], y in [x^2, x]', 'region: x in [0, 1], y in [x, x^2]']) {
      const scene = sceneOf(spec)
      expect(scene.errors).toEqual([])
      expect(Math.abs(approx(readout(scene, 1).text, 'area') - 1 / 6)).toBeLessThan(1e-10)
    }
  })

  it('shades the region on the floor (z = 0 unless @bounds3d says), at opacity 0.35', () => {
    const floor = markNamed(scene, 's1', 'mesh')
    expect(vertices(floor).every((p) => p[2] === 0)).toBe(true)
    expect(floor.style.opacity).toBe(0.35)
    expect(meshArea(floor)).toBeCloseTo(1 / 6, 3)
    const raised = sceneOf('@bounds3d: z [-2, 3]\nregion: x in [0, 1], y in [x^2, x]')
    expect(vertices(markNamed(raised, 's2', 'mesh')).every((p) => p[2] === -2)).toBe(true)
  })
})

describe('region: polar and inequality', () => {
  it('r in [0, 2], theta in [0, pi/2]: area ≈ pi', () => {
    const scene = sceneOf('region: r in [0, 2], theta in [0, pi/2]')
    expect(scene.errors).toEqual([])
    expect(Math.abs(approx(readout(scene, 1).text, 'area') - Math.PI)).toBeLessThan(1e-10)
  })

  it('r in [0, 1], theta in [0, pi]: area ≈ pi/2, which needs the Jacobian r (without it, pi)', () => {
    // r in [0, 2] cannot tell: the integral of r from 0 to 2 is 2, its length.
    const scene = sceneOf('region: r in [0, 1], theta in [0, pi]')
    expect(Math.abs(approx(readout(scene, 1).text, 'area') - Math.PI / 2)).toBeLessThan(1e-10)
  })

  it('theta written first (the outer variable) is the same region', () => {
    const scene = sceneOf('region: theta in [0, pi], r in [0, 1]')
    expect(Math.abs(approx(readout(scene, 1).text, 'area') - Math.PI / 2)).toBeLessThan(1e-10)
  })

  it('a full turn drops the theta seam and the centre: its boundary is the circle alone', () => {
    const scene = sceneOf('region: r in [0, 2], theta in [0, 2*pi]')
    const pieces = polylines(markNamed(scene, 's1.boundary', 'lines'))
    expect(pieces).toHaveLength(1)
    for (const p of pieces[0]) expect(Math.hypot(p[0], p[1])).toBeCloseTo(2, 12)
    expect(Math.abs(approx(readout(scene, 1).text, 'area') - 4 * Math.PI)).toBeLessThan(1e-9)
  })

  it('x^2 + y^2 <= 4 and y >= 0 at res 128: the mesh area is within 0.5% of 2 pi, shown to 4 digits', () => {
    const scene = sceneOf('region: x^2 + y^2 <= 4 and y >= 0 res: 128')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    expect(Math.abs(approx(text, 'area') / (2 * Math.PI) - 1)).toBeLessThan(0.005)
    // The mesh area carries no error estimate: 4 significant digits.
    expect(text).toMatch(/^area ≈ \d\.\d{3}$/)
    // Its boundary lies on the circle or on y = 0.
    for (const p of vertices(markNamed(scene, 's1.boundary', 'lines'))) {
      expect(Math.abs(Math.hypot(p[0], p[1]) - 2) < 1e-6 || Math.abs(p[1]) < 1e-12).toBe(true)
    }
  })
})

describe('named regions and "over R"', () => {
  it('R = region ... draws nothing on its own', () => {
    const scene = sceneOf('R = region x in [0, 1], y in [0, x]')
    expect(scene.errors).toEqual([])
    expect(scene.marks).toEqual([])
  })

  it('z = x + y over R: every vertex has 0 <= y <= x <= 1', () => {
    const scene = sceneOf('R = region x in [0, 1], y in [0, x]\nz = x + y over R')
    expect(scene.errors).toEqual([])
    const surface = markNamed(scene, 's2', 'mesh')
    expect(vertices(surface).length).toBeGreaterThan(100)
    for (const [x, y, z] of vertices(surface)) {
      expect(y).toBeGreaterThanOrEqual(-1e-12)
      expect(y).toBeLessThanOrEqual(x + 1e-12)
      expect(x).toBeLessThanOrEqual(1 + 1e-12)
      expect(z).toBeCloseTo(x + y, 12)
    }
  })

  it('z = x over a polar R is sampled in (r, theta) and evaluated at (x, y)', () => {
    const scene = sceneOf('R = region r in [0, 1], theta in [0, pi/2]\nz = x over R')
    expect(scene.errors).toEqual([])
    for (const [x, y, z] of vertices(markNamed(scene, 's2', 'mesh'))) {
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(1 + 1e-12)
      expect(z).toBeCloseTo(x, 12)
    }
  })

  it('region: R draws the named region', () => {
    const scene = sceneOf('R = region r in [0, 2], theta in [0, pi/2]\nregion: R')
    expect(scene.errors).toEqual([])
    expect(Math.abs(approx(readout(scene, 2).text, 'area') - Math.PI)).toBeLessThan(1e-10)
  })

  it('a region defined as another follows it; a cycle is refused', () => {
    expect(sceneOf('R = region x in [0, 1], y in [0, x]\nS = region R\nregion: S').errors).toEqual([])
    const cycle = sceneOf('R = region S\nS = region R\nregion: R')
    // Every line that resolves the cycle says so.
    expect(cycle.errors.map((e) => e.line)).toEqual([1, 2, 3])
    for (const e of cycle.errors) expect(e.message).toMatch(/defined in terms of itself \((R|S) → (R|S) → (R|S)\)/)
  })

  it('an unknown name is refused on the line that uses it', () => {
    expect(sceneOf('z = x over R').errors).toEqual([{ line: 1, message: expect.stringMatching(/no region named "R"/) }])
  })

  it('a name bound twice is refused on the later line', () => {
    const scene = sceneOf('R = region x in [0, 1], y in [0, x]\nR = region x in [0, 2], y in [0, x]')
    expect(scene.errors).toEqual([{ line: 2, message: expect.stringMatching(/"R" is named twice \(lines 1 and 2\)/) }])
  })

  it('a named region that reads a parameter rebuilds the surface over it on setValue', () => {
    const kernel = kernelOf('@param a = 1 range [0.5, 2]\nR = region x in [0, a], y in [0, x]\nz = x over R')
    const maxX = (mesh: MeshMark) => Math.max(...vertices(mesh).map((p) => p[0]))
    expect(maxX(markNamed(kernel.scene(), 's3', 'mesh'))).toBe(1)
    expect(maxX(markNamed(kernel.setValue('a', 2), 's3', 'mesh'))).toBe(2)
  })

  it('crossing bounds on a named region are refused where it is used', () => {
    const scene = sceneOf('R = region x in [0, 2], y in [x, 1]\nregion: R')
    expect(scene.errors.some((e) => e.line === 2 && /cross near x = 1/.test(e.message))).toBe(true)
  })
})
