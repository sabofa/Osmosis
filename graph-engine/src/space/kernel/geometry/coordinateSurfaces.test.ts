import { describe, expect, it } from 'vitest'
import type { MeshMark } from '../../scene/types'
import { marksOf, sceneOf, vertices } from '../../testing/kernel'
import { coordinateRow } from './coordinateSurfaces'

function surface(spec: string): MeshMark {
  const scene = sceneOf(spec)
  expect(scene.errors).toEqual([])
  const meshes = marksOf(scene, 'mesh')
  expect(meshes).toHaveLength(1)
  return meshes[0]
}

const worst = (mesh: MeshMark, residual: (x: number, y: number, z: number) => number) =>
  Math.max(...vertices(mesh.positions).map(([x, y, z]) => Math.abs(residual(x, y, z))))

describe('cylindrical:', () => {
  it('r = 2 is a cylinder: x^2 + y^2 = 4 at every vertex, over the box z range', () => {
    const mesh = surface('cylindrical: r = 2 res: 24')
    expect(worst(mesh, (x, y) => x * x + y * y - 4)).toBeLessThanOrEqual(1e-12)
    const zs = vertices(mesh.positions).map((p) => p[2])
    expect(Math.min(...zs)).toBe(-5)
    expect(Math.max(...zs)).toBe(5)
    const bounded = surface('@bounds3d: z [0, 3]\ncylindrical: r = 2 res: 12')
    const bz = vertices(bounded.positions).map((p) => p[2])
    expect([Math.min(...bz), Math.max(...bz)]).toEqual([0, 3])
  })

  it('is a parametric surface in (theta, z), the coordinate names', () => {
    const mesh = surface('cylindrical: r = 2 res: 12')
    expect(mesh.pick).toMatchObject({ kind: 'parametric', param: ['theta', 'z'] })
    if (mesh.pick?.kind !== 'parametric') return
    const [x, y, z] = mesh.pick.r(Math.PI / 2, 1)
    expect([x, y, z]).toEqual([expect.closeTo(0, 15), 2, 1])
  })

  it('z = r is a cone over r in [0, R], R the largest box half-span', () => {
    const mesh = surface('cylindrical: z = r res: 16')
    expect(worst(mesh, (x, y, z) => z - Math.hypot(x, y))).toBeLessThanOrEqual(1e-12)
    expect(Math.max(...vertices(mesh.positions).map((p) => p[2]))).toBe(5)
  })

  it('for ranges replace the defaults', () => {
    const mesh = surface('cylindrical: r = 2 for theta in [0, pi], z in [0, 1] res: 12')
    for (const [, y, z] of vertices(mesh.positions)) {
      expect(y).toBeGreaterThanOrEqual(-1e-12)
      expect(z).toBeGreaterThanOrEqual(0)
      expect(z).toBeLessThanOrEqual(1)
    }
  })
})

describe('spherical:', () => {
  it('phi = pi/4 is the cone z = sqrt(x^2 + y^2), z >= 0 (phi from +z)', () => {
    const mesh = surface('spherical: phi = pi/4 res: 24')
    expect(worst(mesh, (x, y, z) => z - Math.hypot(x, y))).toBeLessThanOrEqual(1e-12)
    for (const p of vertices(mesh.positions)) expect(p[2]).toBeGreaterThanOrEqual(0)
  })

  it('phi = pi/6 is the narrower cone z = sqrt 3 · sqrt(x^2 + y^2)', () => {
    // z = rho cos(pi/6) = rho sqrt 3 / 2, r = rho sin(pi/6) = rho / 2
    const mesh = surface('spherical: phi = pi/6 res: 24')
    expect(worst(mesh, (x, y, z) => z - Math.sqrt(3) * Math.hypot(x, y))).toBeLessThanOrEqual(1e-12)
  })

  it('rho = 2 sin(phi) satisfies x^2 + y^2 + z^2 = 2 sqrt(x^2 + y^2) at every vertex', () => {
    // rho^2 = 2 rho sin(phi), and rho sin(phi) = sqrt(x^2 + y^2)
    const mesh = surface('spherical: rho = 2 sin(phi) res: 32')
    expect(worst(mesh, (x, y, z) => x * x + y * y + z * z - 2 * Math.hypot(x, y))).toBeLessThanOrEqual(1e-9)
  })

  it('theta = pi/3 is the half-plane y = sqrt 3 · x, x >= 0', () => {
    const mesh = surface('spherical: theta = pi/3 res: 16')
    expect(worst(mesh, (x, y) => y - Math.sqrt(3) * x)).toBeLessThanOrEqual(1e-12)
    for (const p of vertices(mesh.positions)) expect(p[0]).toBeGreaterThanOrEqual(0)
  })

  it('reads the angle unit: under @angle: degrees, phi = 45 is the same cone', () => {
    const mesh = surface('@angle: degrees\nspherical: phi = 45 res: 16')
    expect(worst(mesh, (x, y, z) => z - Math.hypot(x, y))).toBeLessThanOrEqual(1e-12)
    // ... all the way round: theta's default range is [0, 360] there, and rho
    // reaches R = 5, so x runs from -5 sin 45° to 5 sin 45°
    const xs = vertices(mesh.positions).map((p) => p[0])
    expect(Math.min(...xs)).toBeCloseTo(-5 * Math.SQRT1_2, 9)
    expect(Math.max(...xs)).toBeCloseTo(5 * Math.SQRT1_2, 9)
  })

  it('takes the parametric surface style', () => {
    const scene = sceneOf('spherical: rho = 2 opacity: 0.5 colormap: height res: 12')
    expect(scene.errors).toEqual([])
    const [mesh] = marksOf(scene, 'mesh')
    expect(mesh.style.opacity).toBe(0.5)
    expect(mesh.style.colorScale).toBe(0)
    expect(scene.colorScales).toHaveLength(1)
  })
})

describe('the coordinate readout', () => {
  it('a cylindrical pick at (0, 2, 1) reads (r, θ, z) = (2, 1.571, 1)', () => {
    expect(coordinateRow('cylindrical', [0, 2, 1], 'radians')).toEqual({ label: '(r, θ, z)', value: '(2, 1.571, 1)' })
    const mesh = surface('cylindrical: r = 2 res: 12')
    if (mesh.pick?.kind !== 'parametric') throw new Error('not parametric')
    expect(mesh.pick.coordinates?.([0, 2, 1])).toEqual({ label: '(r, θ, z)', value: '(2, 1.571, 1)' })
  })

  it('spherical: (1, 1, sqrt 2) reads (ρ, θ, φ) = (2, 0.7854, 0.7854); θ runs over [0, 2π)', () => {
    expect(coordinateRow('spherical', [1, 1, Math.SQRT2], 'radians')).toEqual({ label: '(ρ, θ, φ)', value: '(2, 0.7854, 0.7854)' })
    // (0, -2, 0): θ = 3π/2 = 4.712, not -π/2
    expect(coordinateRow('cylindrical', [0, -2, 0], 'radians').value).toBe('(2, 4.712, 0)')
  })

  it('in degrees under @angle: degrees', () => {
    expect(coordinateRow('spherical', [1, 1, Math.SQRT2], 'degrees').value).toBe('(2, 45°, 45°)')
    const mesh = surface('@angle: degrees\nspherical: rho = 2 res: 12')
    if (mesh.pick?.kind !== 'parametric') throw new Error('not parametric')
    expect(mesh.pick.coordinates?.([0, 0, 2])).toEqual({ label: '(ρ, θ, φ)', value: '(2, 0°, 0°)' })
  })
})
