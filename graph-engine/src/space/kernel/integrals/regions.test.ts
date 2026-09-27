import { describe, expect, it } from 'vitest'
import type { MeshMark } from '../../scene/types'
import { approx, kernelOf, lastDigitUnit, markNamed, meshArea, polylines, readout, sceneOf, vertices } from './testing'

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
    // the half-disc: the arc (length π) beats the diameter (2); its middle is
    // (0, 1), on the floor: with no z data, a lone region: gets a thin box
    // (S6 plan V1) — x spans 2, y spans 1, so z is [-0.1, 0.1], floor -0.1.
    const [x, y, z] = readout(sceneOf('region: r in [0, 1], theta in [0, pi]'), 1).position
    expect([Math.abs(x) < 1e-12, y, z]).toEqual([true, 1, -0.1])
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

  it('shades the region on the box floor (with no z data, a lone region: gets a thin box, S6 plan V1: x and y both span 1, so z is [-0.05, 0.05]), at opacity 0.35', () => {
    const floor = markNamed(scene, 's1', 'mesh')
    expect(vertices(floor).every((p) => p[2] === -0.05)).toBe(true)
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

  it('x^2 + y^2 <= 4 and y >= 0 at res 128: the mesh area is within 0.5% of 2 pi, and every digit it prints is right', () => {
    const scene = sceneOf('region: x^2 + y^2 <= 4 and y >= 0 res: 128')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    const area = approx(text, 'area')
    expect(Math.abs(area / (2 * Math.PI) - 1)).toBeLessThan(0.005)
    // The digits come from the mesh's own error (the larger of its last two changes, the
    // boundary's measured gap, rounding), so the last one printed is right.
    expect(Math.abs(area - 2 * Math.PI)).toBeLessThanOrEqual(lastDigitUnit(text, 'area'))
    // Its boundary lies on the circle or on y = 0.
    for (const p of vertices(markNamed(scene, 's1.boundary', 'lines'))) {
      expect(Math.abs(Math.hypot(p[0], p[1]) - 2) < 1e-6 || Math.abs(p[1]) < 1e-12).toBe(true)
    }
  })

  it('a small disc at the default resolution: 0.7832 printed 4 digits against π/4 = 0.7854; now only the digits that are right', () => {
    const text = readout(sceneOf('region: x^2 + y^2 <= 0.25'), 1).text
    expect(Math.abs(approx(text, 'area') - Math.PI / 4)).toBeLessThanOrEqual(lastDigitUnit(text, 'area'))
  })
})

describe('boundary orientation: every piece runs counter-clockwise, the region on its left', () => {
  // The probe's distance from the boundary: the iterated boundaries lie on
  // their curves; the mesh's is chords, up to 5e-4 inside the circle, so its
  // probe steps past that.
  const cases: [string, (x: number, y: number) => boolean, number][] = [
    ['region: x in [0, 1], y in [x^2, x]', (x, y) => x > 0 && x < 1 && y > x * x && y < x, 1e-4],
    ['region: x in [1, 0], y in [x^2, x]', (x, y) => x > 0 && x < 1 && y > x * x && y < x, 1e-4],
    ['region: y in [0, 2], x in [0, y/2]', (x, y) => y > 0 && y < 2 && x > 0 && x < y / 2, 1e-4],
    ['region: r in [1, 2], theta in [0, pi/2]', (x, y) => Math.hypot(x, y) > 1 && Math.hypot(x, y) < 2 && x > 0 && y > 0, 1e-4],
    ['region: theta in [0, pi/2], r in [1, 2]', (x, y) => Math.hypot(x, y) > 1 && Math.hypot(x, y) < 2 && x > 0 && y > 0, 1e-4],
    ['region: x^2 + y^2 <= 1 and y >= 0', (x, y) => x * x + y * y < 1 && y > 0, 1e-2],
  ]
  for (const [spec, inside, eps] of cases) {
    it(spec, () => {
      const pieces = polylines(markNamed(sceneOf(spec), 's1.boundary', 'lines'))
      expect(pieces.length).toBeGreaterThan(0)
      for (const piece of pieces) {
        for (let k = 0; k + 1 < piece.length; k += Math.max(1, Math.floor(piece.length / 7))) {
          const [p, q] = [piece[k], piece[k + 1]]
          const len = Math.hypot(q[0] - p[0], q[1] - p[1])
          if (len === 0) continue
          const left = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len]
          const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
          expect([spec, k, inside(mid[0] + eps * left[0], mid[1] + eps * left[1])]).toEqual([spec, k, true])
          expect([spec, k, inside(mid[0] - eps * left[0], mid[1] - eps * left[1])]).toEqual([spec, k, false])
        }
      }
    })
  }
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

describe('inequality regions: meshed on their own box, every printed digit right (fix round 2)', () => {
  for (const r of [0.05, 0.1, 0.15, 0.2, 0.3, 0.5]) {
    it(`the disc of radius ${r} at the default resolution: area πr², not refused`, () => {
      const scene = sceneOf(`region: x^2 + y^2 <= ${r * r}`)
      expect(scene.errors).toEqual([])
      const text = readout(scene, 1).text
      expect(Math.abs(approx(text, 'area') - Math.PI * r * r)).toBeLessThanOrEqual(lastDigitUnit(text, 'area'))
      // and at least 2 digits of it (the error is the larger of the last two
      // changes, |A(96) - A(48)| and |A(48) - A(24)|: honest, if cautious)
      expect(lastDigitUnit(text, 'area')).toBeLessThanOrEqual(Math.PI * r * r * 1e-1)
    })
  }

  it('a small region is meshed on its own box: the drawn floor spans it at full resolution', () => {
    const floor = markNamed(sceneOf('region: x^2 + y^2 <= 0.01'), 's1', 'mesh')
    const xs = vertices(floor).map((p) => p[0])
    // 96 cells over about 0.3 across, not 2 cells of the box's 10/96
    expect(new Set(xs.map((v) => v.toFixed(9))).size).toBeGreaterThan(50)
  })

  it('a region the grid cannot find is refused, saying what to do', () => {
    expect(sceneOf('region: x^2 + y^2 <= 0.000001 res: 95').errors).toEqual([
      { line: 1, message: 'the region is empty or too small to find at this resolution; raise res:' },
    ])
  })

  it('a polygon is meshed exactly: abs(x) + abs(y) <= 1 at res 32 reads 2', () => {
    expect(readout(sceneOf('region: abs(x) + abs(y) <= 1 res: 32'), 1).text).toBe('area ≈ 2')
  })

  it('the hemisphere over the disc at res 160: no sample lands outside, so no NaN; digits right', () => {
    const scene = sceneOf('volume: under sqrt(1 - x^2 - y^2) over x^2 + y^2 <= 1 res: 160')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    expect(Math.abs(approx(text, 'dA') - (2 * Math.PI) / 3)).toBeLessThanOrEqual(lastDigitUnit(text, 'dA'))
  })
})

describe('inequality regions: samples never fall outside, divergence only on evidence (fix round 2)', () => {
  it('a concave boundary: sqrt(x^2 + y^2 - 1) over the annulus 1 <= r <= 2 is 2π√3, no sample in the hole', () => {
    // the chords along r = 1 lie in the hole, where the integrand is not a number
    const scene = sceneOf('volume: under sqrt(x^2 + y^2 - 1) over x^2 + y^2 >= 1 and x^2 + y^2 <= 4')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    expect(Math.abs(approx(text, 'dA') - 2 * Math.PI * Math.sqrt(3))).toBeLessThanOrEqual(lastDigitUnit(text, 'dA'))
  })

  it('a bounded, oscillating integrand is not taken for divergence: 1 + sin(40x) over the unit disc is π', () => {
    for (const spec of ['volume: under 1 + sin(40*x) over x^2 + y^2 <= 1', 'volume: under 1 + sin(20*x)*sin(20*y) over x^2 + y^2 <= 1']) {
      const scene = sceneOf(spec)
      expect(scene.errors).toEqual([])
      const text = readout(scene, 1).text
      expect(Math.abs(approx(text, 'dA') - Math.PI)).toBeLessThanOrEqual(lastDigitUnit(text, 'dA'))
    }
    // Under-resolved rings: the sums wander (6.257, 6.262, 6.282, 6.255) without shrinking, but
    // |g| <= 3 everywhere, so it is a value with a wide error, never divergence.
    // 2π(1 + sin(150)/300)
    const rings = sceneOf('volume: under 2 + cos(150*(x^2+y^2)) over x^2 + y^2 <= 1')
    expect(rings.errors).toEqual([])
    const text = readout(rings, 1).text
    expect(Math.abs(approx(text, 'dA') - 2 * Math.PI * (1 + Math.sin(150) / 300))).toBeLessThanOrEqual(lastDigitUnit(text, 'dA'))
  })
})
