import { describe, expect, it } from 'vitest'
import type { SpaceScene } from '../../scene/types'
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

  it('the same half-disc as an inequality: mesh sums, each coordinate to the digits two resolutions agree on', () => {
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
    expect(Math.abs(approx(text, 'M') - 1 / 3)).toBeLessThan(1e-12)
    // ȳ = (∫∫ x y dA) / M = (1/8) / (1/3) = 3/8
    const [x, y] = approxTuple(text, 'centre of mass')
    expect(Math.abs(x - 3 / 4)).toBeLessThan(1e-10)
    expect(Math.abs(y - 3 / 8)).toBeLessThan(1e-10)
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
    expect(Math.abs(approx(text, 'M') - 1 / 6)).toBeLessThan(1e-12)
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
    expect(approxTuple(readout(kernel.scene(), 3).text, 'centre of mass')[0]).toBeCloseTo(0.5, 10)
    // density 1 + x: M = 3/2, ∫∫ x (1 + x) = 1/2 + 1/3 = 5/6, x̄ = 5/9
    expect(approxTuple(readout(kernel.setValue('k', 1), 3).text, 'centre of mass')[0]).toBeCloseTo(5 / 9, 10)
  })
})

describe('readouts: a value that is zero within its error shows as ≈ 0, never as rounding noise', () => {
  it('odd integrands over symmetric shapes, by quadrature, by the mesh, and as a Riemann sum', () => {
    expect(readout(sceneOf('volume: x in [-1, 1], y in [0, 1], z in [0, 1] integrand x'), 1).text).toBe('∭ x dV ≈ 0')
    expect(readout(sceneOf('volume: under x over x^2 + y^2 <= 1'), 1).text.startsWith('∬_R x dA ≈ 0;')).toBe(true)
    expect(readout(sceneOf('riemann: under x over x in [-1, 1], y in [0, 1], n = 4'), 1).text).toBe('Σ x ΔA ≈ 0; ∬_R x dA ≈ 0')
    expect(readout(sceneOf('D = region r in [0, 1], theta in [0, pi]\ncentroid: D'), 2).text).toMatch(/^centroid ≈ \(0, 0\.4244131815\d\);/)
  })

  it('a mesh region’s x̄ of 5×10⁻⁵ (the grid’s asymmetry) lies inside its two-resolution error, so it reads 0', () => {
    expect(readout(sceneOf('@resolution: 160\nD = region x^2 + y^2 <= 1 and y >= 0\ncentroid: D'), 3).text).toMatch(/^centroid ≈ \(0, /)
  })
})
