import { describe, expect, it } from 'vitest'
import type { MeshMark } from '../../scene/types'
import { approx, markNamed, meshArea, readout, sceneOf, vertices } from './testing'

const walls = (scene: ReturnType<typeof sceneOf>) => scene.marks.filter((m) => /\.wall\d+$/.test(m.source.object)) as MeshMark[]

describe('volume: under 4 - x^2 - y^2 over r in [0, 2], theta in [0, 2 pi] (the dome)', () => {
  const scene = sceneOf('volume: under 4 - x^2 - y^2 over r in [0, 2], theta in [0, 2*pi]')

  it('reads ∬ = ∫∫ (4 - r^2) r dr dθ = 2π(8 - 4) = 8π ≈ 25.13274 to 1e-8', () => {
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    expect(text.startsWith('∬_R (4 - x^2 - y^2) dA ≈ ')).toBe(true)
    expect(Math.abs(approx(text, 'dA') - 8 * Math.PI)).toBeLessThan(1e-8)
  })

  it('has no wall: the side r = 2 runs from z = 0 to 0, and the theta seam is interior', () => {
    expect(walls(scene)).toEqual([])
  })

  it('draws the dome on top and the disc z = 0 below, translucent at 0.45', () => {
    const top = markNamed(scene, 's1', 'mesh')
    const bottom = markNamed(scene, 's1.bottom', 'mesh')
    for (const [x, y, z] of vertices(top)) expect(z).toBeCloseTo(4 - x * x - y * y, 12)
    expect(vertices(bottom).every((p) => p[2] === 0)).toBe(true)
    expect(top.style.opacity).toBe(0.45)
    expect(bottom.style.opacity).toBe(0.45)
    // one flat colour: the statement's slot, no colour scale
    expect(top.style.colorScale).toBeNull()
    expect(top.style.color).toEqual(bottom.style.color)
  })
})

describe('volume: between x^2 + y^2 and 2 over x in [-1, 1], y in [-1, 1]', () => {
  const scene = sceneOf('volume: between x^2 + y^2 and 2 over x in [-1, 1], y in [-1, 1]')

  it('reads ∬ (2 - x^2 - y^2) dA = 8 - 8/3 = 16/3 ≈ 5.33333', () => {
    expect(scene.errors).toEqual([])
    const text = readout(scene, 1).text
    expect(text.startsWith('∬_R (2 − (x^2 + y^2)) dA ≈ ')).toBe(true)
    expect(Math.abs(approx(text, 'dA') - 16 / 3)).toBeLessThan(1e-9)
    expect(text).not.toMatch(/on part of/)
  })

  it('has four wall patches, every vertex on the square’s boundary, running from g up to f', () => {
    const four = walls(scene)
    expect(four).toHaveLength(4)
    for (const wall of four) {
      expect(meshArea(wall)).toBeGreaterThan(0.1)
      for (const [x, y, z] of vertices(wall)) {
        expect(Math.abs(Math.abs(x) - 1) < 1e-12 || Math.abs(Math.abs(y) - 1) < 1e-12).toBe(true)
        const g = x * x + y * y
        expect(Math.abs(z - g) < 1e-12 || Math.abs(z - 2) < 1e-12).toBe(true)
      }
    }
  })

  it('the bottom is z = x^2 + y^2', () => {
    for (const [x, y, z] of vertices(markNamed(scene, 's1.bottom', 'mesh'))) expect(z).toBeCloseTo(x * x + y * y, 12)
  })
})

describe('volume: the readout and its note', () => {
  it('f < g on part of R: the note says the integral counts that part negatively', () => {
    // top 0, bottom x: f < g where x > 0, and the integral of -x is 0
    const scene = sceneOf('volume: between x and 0 over x in [-1, 1], y in [0, 1]')
    const text = readout(scene, 1).text
    expect(text).toMatch(/f < g on part of R; the integral counts that part negatively/)
    expect(Math.abs(approx(text, 'dA'))).toBeLessThan(1e-12)
  })

  it('under a surface that dips below zero: f < 0', () => {
    const text = readout(sceneOf('volume: under x over x in [-1, 1], y in [0, 1]'), 1).text
    expect(text).toMatch(/f < 0 on part of R/)
  })

  it('names a defined function and a named region by their names', () => {
    const scene = sceneOf('f(x, y) = 4 - x^2 - y^2\nD = region r in [0, 2], theta in [0, 2*pi]\nvolume: under f over D')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 3).text
    expect(text.startsWith('∬_D f dA ≈ ')).toBe(true)
    expect(Math.abs(approx(text, 'dA') - 8 * Math.PI)).toBeLessThan(1e-8)
  })

  it('over an inequality region: the mesh sum, 4 digits', () => {
    // the unit disc under z = 1: pi
    const text = readout(sceneOf('volume: under 1 over x^2 + y^2 <= 1 res: 160'), 1).text
    expect(Math.abs(approx(text, 'dA') - Math.PI)).toBeLessThan(2e-3)
    expect(text).toMatch(/dA ≈ \d\.\d{3}$/)
  })

  it('refuses a function of three variables as a target', () => {
    const scene = sceneOf('F(x, y, z) = x + y + z\nvolume: under F over x in [0, 1], y in [0, 1]')
    expect(scene.errors).toEqual([{ line: 2, message: expect.stringMatching(/"F" is a function of 3 variables/) }])
  })
})
