import { describe, expect, it } from 'vitest'
import { parseSpec } from '../../../parser/parseSpec'
import type { MeshMark, SpaceScene } from '../../scene/types'
import { approx, kernelOf, markNamed, polylines, readout, sceneOf, vertices } from './testing'

const faces = (scene: SpaceScene, line = 1) =>
  scene.marks.filter((m) => m.source.object.startsWith(`s${line}.face`)).map((m) => m.source.object.slice(`s${line}.`.length))

const face = (scene: SpaceScene, name: string, line = 1): MeshMark => markNamed(scene, `s${line}.${name}`, 'mesh')

describe('volume: the tetrahedron x in [0, 1], y in [0, 1 - x], z in [0, 1 - x - y]', () => {
  const scene = sceneOf('volume: x in [0, 1], y in [0, 1 - x], z in [0, 1 - x - y]')

  it('reads ∭ dV ≈ 1/6', () => {
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    expect(text.startsWith('∭ dV ≈ ')).toBe(true)
    expect(Math.abs(approx(text, 'dV') - 1 / 6)).toBeLessThan(1e-10)
  })

  it('keeps exactly its four faces: x = 0, y = 0, z = 0 and x + y + z = 1 (the x = 1 and y-top faces collapse)', () => {
    // faces 2p + v: p = 0 the outer (x), 1 the middle (y), 2 the inner (z); v = 0 the low bound, 1 the high
    expect(faces(scene)).toEqual(['face0', 'face2', 'face4', 'face5'])
    for (const [x] of vertices(face(scene, 'face0'))) expect(x).toBe(0)
    for (const [, y] of vertices(face(scene, 'face2'))) expect(y).toBe(0)
    for (const [, , z] of vertices(face(scene, 'face4'))) expect(z).toBe(0)
    for (const [x, y, z] of vertices(face(scene, 'face5'))) expect(x + y + z).toBeCloseTo(1, 12)
  })

  it('draws its six edges, once each', () => {
    const edges = polylines(markNamed(scene, 's1.edges', 'lines'))
    expect(edges).toHaveLength(6)
    const ends = edges.map((l) => [l[0], l[l.length - 1]].map((p) => p.map((c) => Math.round(c * 1e9) / 1e9).join(',')).sort().join(' '))
    expect(ends.sort()).toEqual(['0,0,0 0,0,1', '0,0,0 0,1,0', '0,0,0 1,0,0', '0,0,1 0,1,0', '0,0,1 1,0,0', '0,1,0 1,0,0'])
  })

  it('is translucent at 0.4, every face outward (normals away from the centroid)', () => {
    const c = [0.25, 0.25, 0.25]
    for (const name of faces(scene)) {
      const mesh = face(scene, name)
      expect(mesh.style.opacity).toBe(0.4)
      const p = mesh.positions
      const n = mesh.normals
      const mid = Math.floor(p.length / 6) * 3
      expect((p[mid] - c[0]) * n[mid] + (p[mid + 1] - c[1]) * n[mid + 1] + (p[mid + 2] - c[2]) * n[mid + 2]).toBeGreaterThan(0)
    }
  })

  it('drops a face whose area is at most 1e-9 of the diagonal squared, though its triangles are not degenerate', () => {
    // A wedge whose x = 0 face is 0.000000000001 tall: area 1e-12 against a diagonal of about
    // sqrt 3, while each of its triangles' cross product is 1e-12 of its longest edge squared
    // (above finishMesh's 1e-14), so only the area rule removes it. The x = 1 face opposite is
    // a full square, so the coincident-face rule does not apply. (Written out: the expression
    // grammar reads "1e-12" as 1·e − 12.)
    const scene = sceneOf('volume: x in [0, 1], y in [0, 1], z in [0, 0.000000000001 + x]')
    expect(faces(scene)).toEqual(['face1', 'face2', 'face3', 'face4', 'face5'])
  })

  it('integrand x: ∭ x dV = 1/24', () => {
    const text = readout(sceneOf('volume: x in [0, 1], y in [0, 1 - x], z in [0, 1 - x - y] integrand x'), 1).text
    expect(text.startsWith('∭ x dV ≈ ')).toBe(true)
    expect(Math.abs(approx(text, 'dV') - 1 / 24)).toBeLessThan(1e-10)
  })

  it('written in any order, the same solid', () => {
    const text = readout(sceneOf('volume: z in [0, 1 - x - y], x in [0, 1], y in [0, 1 - x]'), 1).text
    expect(Math.abs(approx(text, 'dV') - 1 / 6)).toBeLessThan(1e-10)
  })
})

describe('volume: cylindrical and spherical', () => {
  it('r in [0, 2], theta in [0, 2 pi], z in [0, 4 - r^2] cylindrical: ∭ = 8π, the dome and the floor disc alone', () => {
    const scene = sceneOf('volume: r in [0, 2], theta in [0, 2*pi], z in [0, 4 - r^2] cylindrical')
    expect(scene.errors).toEqual([])
    expect(Math.abs(approx(readout(scene, 1).text, 'dV') - 8 * Math.PI)).toBeLessThan(1e-8)
    // r = 0 is the axis (no area); the theta = 0 and theta = 2 pi faces coincide (interior); r = 2 has zero height
    expect(faces(scene)).toEqual(['face4', 'face5'])
    for (const [x, y, z] of vertices(face(scene, 'face5'))) expect(z).toBeCloseTo(4 - x * x - y * y, 12)
    for (const [, , z] of vertices(face(scene, 'face4'))) expect(z).toBe(0)
    // the rim where the dome meets the floor, once
    const edges = polylines(markNamed(scene, 's1.edges', 'lines'))
    expect(edges).toHaveLength(1)
    for (const [x, y, z] of edges[0]) {
      expect(Math.hypot(x, y)).toBeCloseTo(2, 12)
      expect(z).toBeCloseTo(0, 12)
    }
  })

  it('half a turn keeps both theta faces: five faces, ∭ = π/2', () => {
    const scene = sceneOf('volume: r in [0, 1], theta in [0, pi], z in [0, 1] cylindrical')
    expect(faces(scene)).toEqual(['face1', 'face2', 'face3', 'face4', 'face5'])
    expect(Math.abs(approx(readout(scene, 1).text, 'dV') - Math.PI / 2)).toBeLessThan(1e-10)
  })

  it('the ice-cream cone rho in [0, 2], phi in [0, pi/4], theta in [0, 2 pi]: ∭ = (2π)(1 − cos(π/4))(8/3) ≈ 4.90747', () => {
    const scene = sceneOf('volume: rho in [0, 2], phi in [0, pi/4], theta in [0, 2*pi] spherical')
    expect(scene.errors).toEqual([])
    // (16π/3)(1 − √2/2) = 16.75516 × 0.29289 = 4.90747 (the plan's "4.90737" drops a digit)
    const expected = ((16 * Math.PI) / 3) * (1 - Math.SQRT2 / 2)
    expect(expected).toBeCloseTo(4.90747, 5)
    expect(Math.abs(approx(readout(scene, 1).text, 'dV') - expected)).toBeLessThan(1e-9)
    // the cap rho = 2 and the cone phi = pi/4; rho = 0 is a point, phi = 0 the axis, the theta faces coincide
    expect(faces(scene)).toEqual(['face1', 'face3'])
    for (const p of vertices(face(scene, 'face1'))) expect(Math.hypot(...p)).toBeCloseTo(2, 12)
    for (const [x, y, z] of vertices(face(scene, 'face3'))) expect(Math.hypot(x, y)).toBeCloseTo(z, 12)
  })

  it('@angle: degrees reads the angles in degrees, with the Jacobian in radians', () => {
    const scene = sceneOf('@angle: degrees\nvolume: rho in [0, 2], phi in [0, 45], theta in [0, 360] spherical')
    expect(Math.abs(approx(readout(scene, 2).text, 'dV') - ((16 * Math.PI) / 3) * (1 - Math.SQRT2 / 2))).toBeLessThan(1e-9)
  })
})

describe('volume: refusals, names and parameters', () => {
  it('an order that is not a chain is refused on its line', () => {
    const parsed = parseSpec('volume: x in [0, y], y in [0, x], z in [0, 1]')
    expect(parsed.errors).toEqual([{ line: 1, message: expect.stringMatching(/the bounds of x read y, and the bounds of y read x/) }])
  })

  it('bounds that cross are refused', () => {
    const scene = sceneOf('volume: x in [0, 2], y in [0, 1], z in [x, 1]')
    expect(scene.errors).toEqual([{ line: 1, message: expect.stringMatching(/the bounds of z cross/) }])
  })

  it('V = volume ... draws nothing; volume: V draws it and names it in the readout', () => {
    const scene = sceneOf('V = volume x in [0, 1], y in [0, 1 - x], z in [0, 1 - x - y]\nvolume: V')
    expect(scene.errors).toEqual([])
    expect(scene.marks.every((m) => m.source.line === 2)).toBe(true)
    const text = readout(scene, 2).text
    expect(text.startsWith('∭_V dV ≈ ')).toBe(true)
    expect(Math.abs(approx(text, 'dV') - 1 / 6)).toBeLessThan(1e-10)
  })

  it('a named volume under a surface draws as one', () => {
    const scene = sceneOf('W = volume under 1 over x in [0, 1], y in [0, 1]\nvolume: W')
    expect(scene.errors).toEqual([])
    expect(Math.abs(approx(readout(scene, 2).text, 'dA') - 1)).toBeLessThan(1e-12)
  })

  it('a region is not a volume, and a volume is not a region', () => {
    expect(sceneOf('R = region x in [0, 1], y in [0, 1]\nvolume: R').errors).toEqual([{ line: 2, message: '"R" is a region, not a volume' }])
    expect(sceneOf('V = volume x in [0, 1], y in [0, 1], z in [0, 1]\nregion: V').errors).toEqual([{ line: 2, message: '"V" is a volume, not a region' }])
  })

  it('a bound that reads a parameter rebuilds on setValue', () => {
    const kernel = kernelOf('@param a = 1 range [1, 3]\nvolume: x in [0, a], y in [0, 1], z in [0, 1]')
    expect(approx(readout(kernel.scene(), 2).text, 'dV')).toBeCloseTo(1, 12)
    expect(approx(readout(kernel.setValue('a', 2), 2).text, 'dV')).toBeCloseTo(2, 12)
  })
})
