import { describe, expect, it } from 'vitest'
import type { SpaceScene } from '../../scene/types'
import { determined, IntegralRefusal } from './common'
import { positionOrZero } from './centroids'
import { approx, approxTuple, kernelOf, markNamed, polylines, readout, sceneOf } from './testing'

function centre(scene: SpaceScene, line: number): number[] {
  return Array.from(markNamed(scene, `s${line}`, 'points').positions)
}

describe('centroid: of regions', () => {
  it('the triangle x in [0, 1], y in [0, x]: (2/3, 1/3), M = 1/2', () => {
    const scene = sceneOf('R = region x in [0, 1], y in [0, x]\ncentroid: R')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 2).text
    expect(text.startsWith('centroid ≈ (')).toBe(true)
    const [x, y] = approxTuple(text, 'centroid')
    expect(Math.abs(x - 2 / 3)).toBeLessThan(1e-10)
    expect(Math.abs(y - 1 / 3)).toBeLessThan(1e-10)
    expect(Math.abs(approx(text, 'M') - 1 / 2)).toBeLessThan(1e-12)
    const [px, py, pz] = centre(scene, 2)
    expect(px).toBeCloseTo(2 / 3, 12)
    expect(py).toBeCloseTo(1 / 3, 12)
    expect(pz).toBe(0)
  })

  it('the upper half-disc r in [0, 1], theta in [0, pi]: (0, 4/(3π)) ≈ (0, 0.42441)', () => {
    const scene = sceneOf('D = region r in [0, 1], theta in [0, pi]\ncentroid: D')
    const [x, y] = approxTuple(readout(scene, 2).text, 'centroid')
    expect(Math.abs(x)).toBeLessThan(1e-12)
    expect(4 / (3 * Math.PI)).toBeCloseTo(0.42441, 5)
    expect(Math.abs(y - 4 / (3 * Math.PI))).toBeLessThan(1e-10)
  })

  it('the same half-disc as an inequality: mesh sums, each coordinate to the digits its error supports', () => {
    const scene = sceneOf('@resolution: 160\nD = region x^2 + y^2 <= 1 and y >= 0\ncentroid: D')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 3).text
    const [x, y] = approxTuple(text, 'centroid')
    const printed = /\(([^,]+), ([^)]+)\)/.exec(text)!
    const unit = (t: string) => (t.includes('.') ? 10 ** -t.split('.')[1].length : 1)
    expect(Math.abs(x)).toBeLessThanOrEqual(unit(printed[1]))
    expect(Math.abs(y - 4 / (3 * Math.PI))).toBeLessThanOrEqual(unit(printed[2]))
  })

  it('density x on the triangle: M = 1/3, x̄ = (1/4)/(1/3) = 3/4, a centre of mass', () => {
    const scene = sceneOf('R = region x in [0, 1], y in [0, x]\ncentroid: R density x')
    const text = readout(scene, 2).text
    expect(text.startsWith('centre of mass ≈ (')).toBe(true)
    // SAFETY (breaker ruling, F1) trims a digit or two from the tightest checks below.
    expect(Math.abs(approx(text, 'M') - 1 / 3)).toBeLessThan(1e-10)
    // ȳ = (∫∫ x y dA) / M = (1/8) / (1/3) = 3/8
    const [x, y] = approxTuple(text, 'centre of mass')
    expect(Math.abs(x - 3 / 4)).toBeLessThan(1e-9)
    expect(Math.abs(y - 3 / 8)).toBeLessThan(1e-9)
  })

  it('zero mass is refused: the centre is undefined', () => {
    const scene = sceneOf('R = region x in [-1, 1], y in [0, 1]\ncentroid: R density x')
    expect(scene.errors).toEqual([{ line: 2, message: 'the mass is zero; the centre is undefined' }])
  })
})

describe('centroid: of volumes', () => {
  it('the tetrahedron: (1/4, 1/4, 1/4), M = 1/6', () => {
    const scene = sceneOf('V = volume x in [0, 1], y in [0, 1 - x], z in [0, 1 - x - y]\ncentroid: V')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 2).text
    for (const c of approxTuple(text, 'centroid')) expect(Math.abs(c - 1 / 4)).toBeLessThan(1e-10)
    // SAFETY (breaker ruling, F1) trims a digit from the tightest check below.
    expect(Math.abs(approx(text, 'M') - 1 / 6)).toBeLessThan(1e-11)
    for (const c of centre(scene, 2)) expect(c).toBeCloseTo(1 / 4, 10)
  })

  it('the cylindrical dome r in [0, 2], theta in [0, 2 pi], z in [0, 4 - r^2]: (0, 0, 4/3)', () => {
    // M = 8π; ∭ z dV = ∫∫ (4 - r^2)^2 / 2 r dr dθ = π ∫0^4 u^2 / 2 du... = 32π/3, so z̄ = 4/3
    const text = readout(sceneOf('V = volume r in [0, 2], theta in [0, 2*pi], z in [0, 4 - r^2] cylindrical\ncentroid: V'), 2).text
    const [x, y, z] = approxTuple(text, 'centroid')
    expect(Math.abs(x)).toBeLessThan(1e-9)
    expect(Math.abs(y)).toBeLessThan(1e-9)
    expect(Math.abs(z - 4 / 3)).toBeLessThan(1e-9)
  })

  it('the solid under z = 1 over the unit square: (1/2, 1/2, 1/2)', () => {
    const scene = sceneOf('W = volume under 1 over x in [0, 1], y in [0, 1]\ncentroid: W')
    expect(scene.errors).toEqual([])
    for (const c of approxTuple(readout(scene, 2).text, 'centroid')) expect(Math.abs(c - 1 / 2)).toBeLessThan(1e-10)
  })
})

describe('centroid: the drawing', () => {
  it('a diamond at the centre, with dashed drop lines to the floor and the planes x = 0 and y = 0', () => {
    const scene = sceneOf('V = volume x in [1, 2], y in [1, 2], z in [1, 2]\ncentroid: V')
    const point = markNamed(scene, 's2', 'points')
    expect(point.style.shape).toBe('diamond')
    const drops = markNamed(scene, 's2.drops', 'lines')
    expect(drops.style.dash).not.toBeNull()
    expect(polylines(drops).map((l) => l.map((p) => p.map((c) => Math.round(c * 1e9) / 1e9)))).toEqual([
      [
        [1.5, 1.5, 1.5],
        [1.5, 1.5, 0],
      ],
      [
        [1.5, 1.5, 1.5],
        [0, 1.5, 1.5],
      ],
      [
        [1.5, 1.5, 1.5],
        [1.5, 0, 1.5],
      ],
    ])
  })

  it('a drop line of no length is left out (a region’s centre lies on the floor)', () => {
    const drops = polylines(markNamed(sceneOf('D = region r in [0, 1], theta in [0, pi]\ncentroid: D'), 's2.drops', 'lines'))
    // to the floor: none; to x = 0: none (x̄ = 0); to y = 0: one
    expect(drops).toHaveLength(1)
  })

  it('an unknown name, and a density that reads a parameter', () => {
    expect(sceneOf('centroid: Q').errors).toEqual([{ line: 1, message: expect.stringMatching(/no region or volume named "Q"/) }])
    const kernel = kernelOf('@param k = 0 range [0, 2]\nR = region x in [0, 1], y in [0, 1]\ncentroid: R density 1 + k*x')
    expect(approxTuple(readout(kernel.scene(), 3).text, 'centre of mass')[0]).toBeCloseTo(0.5, 9)
    // density 1 + x: M = 3/2, ∫∫ x (1 + x) = 1/2 + 1/3 = 5/6, x̄ = 5/9
    expect(approxTuple(readout(kernel.setValue('k', 1), 3).text, 'centre of mass')[0]).toBeCloseTo(5 / 9, 9)
  })
})

describe('readouts: a value that is zero within its error shows as ≈ 0, never as rounding noise', () => {
  it('odd integrands over symmetric shapes, by quadrature, by the mesh, and as a Riemann sum', () => {
    expect(readout(sceneOf('volume: x in [-1, 1], y in [0, 1], z in [0, 1] integrand x'), 1).text).toBe('∭ x dV ≈ 0')
    expect(readout(sceneOf('volume: under x over x^2 + y^2 <= 1'), 1).text.startsWith('∬_R x dA ≈ 0;')).toBe(true)
    expect(readout(sceneOf('riemann: under x over x in [-1, 1], y in [0, 1], n = 4'), 1).text).toBe('Σ x ΔA ≈ 0; ∬_R x dA ≈ 0')
    // SAFETY (breaker ruling, F1) shows one fewer reliable digit, which
    // rounds the last one shown up (…815783… to 10 figures is …1816).
    expect(readout(sceneOf('D = region r in [0, 1], theta in [0, pi]\ncentroid: D'), 2).text).toMatch(/^centroid ≈ \(0, 0\.424413181\d\);/)
  })

  it('a mesh region’s x̄ of 5×10⁻⁵ (the grid’s asymmetry) lies inside its error (the changes between resolutions), so it reads 0', () => {
    expect(readout(sceneOf('@resolution: 160\nD = region x^2 + y^2 <= 1 and y >= 0\ncentroid: D'), 3).text).toMatch(/^centroid ≈ \(0, /)
  })
})

describe('centroids over mesh regions and solids (fix round 2)', () => {
  // S5 breaker follow-up, F1a: mass and each moment here are bounded mesh
  // sums (mesh: true), and quotient (centroids.ts) passes that through, so
  // this coordinate skips SAFETY and is never refused.
  it('the half-disc at @resolution: 64 is not refused, and every printed digit is right', () => {
    const scene = sceneOf('@resolution: 64\nD = region x^2 + y^2 <= 1 and y >= 0\ncentroid: D')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 3).text
    const [x, y] = approxTuple(text, 'centroid')
    expect(x).toBe(0)
    const printed = /\(([^,]+), ([^)]+)\)/.exec(text)!
    expect(Math.abs(y - 4 / (3 * Math.PI))).toBeLessThanOrEqual(10 ** -(printed[2].split('.')[1]?.length ?? 0))
  })

  it('the dome over the unit disc (a mesh solid): x̄ and ȳ read ≈ 0, z̄ = 3/8 to its digits', () => {
    const scene = sceneOf('V = volume under sqrt(1 - x^2 - y^2) over x^2 + y^2 <= 1\ncentroid: V')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 2).text
    const [x, y, z] = approxTuple(text, 'centroid')
    expect([x, y]).toEqual([0, 0])
    const printed = /\(([^,]+), ([^,]+), ([^)]+)\)/.exec(text)!
    expect(Math.abs(z - 0.375)).toBeLessThanOrEqual(10 ** -(printed[3].split('.')[1]?.length ?? 0))
  })
})

// S5 fix round 4, M4: a centroid coordinate is a position, not a general
// integral — it reads 0 when it is within its error and that error is small
// beside the shape's own size on that axis, even where the general "≈ 0"
// rule (common.ts, comparing against the integral of |density|) would
// refuse it as "not determined". The annulus at res 40 was refused with
// "≈ 6.486×10⁻¹⁸ ± 0.001314" — negligible against its own ~2-wide ring, but
// not against the integral of |density| the general rule compares to.
describe('a centroid coordinate reads 0 against its own extent, not the integral of |density| (fix round 4, M4)', () => {
  // S5 breaker follow-up, F1a: a bounded mesh sum, so mass and the moments
  // skip SAFETY and never refuse.
  it('the annulus centroid at its default resolution reads (0, 0)', () => {
    const scene = sceneOf('D = region x^2 + y^2 >= 0.95 and x^2 + y^2 <= 1.03\ncentroid: D')
    expect(scene.errors).toEqual([])
    const [x, y] = approxTuple(readout(scene, 2).text, 'centroid')
    expect([x, y]).toEqual([0, 0])
  })

  it('the rule itself: a value at float noise against a ~2-wide region reads 0; the same error against a tiny region does not', () => {
    // scale: 1 — small enough that the general "≈ 0" rule (error <= 1e-3 x
    // the integral of |g|) refuses this on its own, as it did before this
    // fix: error (1.314e-3) > 1e-3 x 1.
    const noise = { value: 6.486e-18, error: 1.314e-3, scale: 1 }
    expect(() => determined(noise)).toThrow(IntegralRefusal)
    // Reaches the same conclusion the reviewer's probe measured, without
    // depending on this build's exact mesh error at res 40: negligible
    // beside a ~2-wide region, so it reads 0.
    const wide = determined(positionOrZero(noise, 2.08))
    expect(wide.value).toBe(0)
    // The same absolute error against a region only 0.01 wide is not
    // negligible on that scale, and is refused, never silently shown as 0.
    expect(() => determined(positionOrZero(noise, 0.01))).toThrow(IntegralRefusal)
  })
})

// S5 fix round 5: a solid (a volume, not a region) passed positionOrZero an
// extent of Infinity for every coordinate, so "error <= 1e-3 x extent" was
// always true — a coordinate within its own error, however large, printed 0
// regardless of how far off it truly was. Solids now pass the solid's own
// finite bounding span on that axis (the max minus the min of its x, y or z
// bounds), computed from the coordinate map (an iterated solid) or the
// region's mesh and the top/bottom surfaces sampled at it (a "between"
// solid) — never Infinity unless the solid is genuinely unbounded or empty.
describe('a solid centroid reads its own finite extent, not Infinity (fix round 5)', () => {
  // Hand value: mass = area x height = pi x 1^2 x 1 = pi; x̄ = cx = 0.02 (the
  // moment of x over a disc offset by (cx, cy) is cx x area, so x̄ = cx);
  // ȳ = cy = 0.015; z̄ = 0.5 (the midpoint of the slab z in [0, 1]).
  // S5 breaker follow-up, F1a: a bounded mesh sum, so mass and the moments
  // skip SAFETY and never refuse.
  it('a slab (z in [0, 1]) over a disc centred at (0.02, 0.015): (0.02, 0.015, 0.5), M = π', () => {
    const scene = sceneOf('V = volume under 1 over (x - 0.02)^2 + (y - 0.015)^2 <= 1\ncentroid: V')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 2).text
    const [x, y, z] = approxTuple(text, 'centroid')
    expect(Math.abs(x - 0.02)).toBeLessThan(2e-3)
    expect(Math.abs(y - 0.015)).toBeLessThan(2e-3)
    expect(z).toBe(0.5)
    expect(Math.abs(approx(text, 'M') - Math.PI)).toBeLessThan(1e-2)
  })

  // The re-reviewer's exact probe: at res 8 the mesh is coarse enough that
  // x̄'s raw value (0.02) is well within its own mesh error (±0.0217) — the
  // same shape of noise the M4 fix (above) reads as 0 for a region, but
  // this shape's extent is only ~2 wide (not the disc's own |density|
  // integral, ~pi), and 0.0217 is not negligible beside 2. Never (0, 0, …):
  // right digits, or an honest refusal, either acceptable (never a wrong
  // confident number).
  // S5 breaker ruling, F3: pinned to the deterministic result, not "either
  // outcome" — SAFETY (F1) on the mesh's own error at this coarse a
  // resolution refuses the mass itself, before M4's own position-reads-0
  // logic is ever reached. Never (0, 0, 0.5).
  it('the same slab at res 8 never prints (0, 0, 0.5): the reviewer’s exact probe', () => {
    const scene = sceneOf('@resolution: 8\nV = volume under 1 over (x - 0.02)^2 + (y - 0.015)^2 <= 1\ncentroid: V')
    expect(scene.errors.filter((e) => e.line === 3)).toEqual([
      { line: 3, message: 'the integral could not be determined to one significant digit (≈ 3.087 ± 0.6727) — try tighter bounds or a finer res:' },
    ])
  })

  it('the annulus 1 <= r <= 2 at res 40 is unaffected: still (0, 0) — a genuinely negligible coordinate still reads 0', () => {
    const scene = sceneOf('@resolution: 40\nD = region x^2 + y^2 >= 1 and x^2 + y^2 <= 4\ncentroid: D')
    expect(scene.errors).toEqual([])
    const [x, y] = approxTuple(readout(scene, 3).text, 'centroid')
    expect([x, y]).toEqual([0, 0])
  })

  it('the cylindrical dome’s centroid (an iterated solid) is unaffected: still (0, 0, 4/3)', () => {
    const text = readout(sceneOf('V = volume r in [0, 2], theta in [0, 2*pi], z in [0, 4 - r^2] cylindrical\ncentroid: V'), 2).text
    const [x, y, z] = approxTuple(text, 'centroid')
    expect(Math.abs(x)).toBeLessThan(1e-9)
    expect(Math.abs(y)).toBeLessThan(1e-9)
    expect(Math.abs(z - 4 / 3)).toBeLessThan(1e-9)
  })
})
