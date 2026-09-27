import { describe, expect, it } from 'vitest'
import type { MeshMark } from '../../scene/types'
import { approx, dot, lastDigitUnit, markNamed, meshArea, readout, sceneOf, vertices, windings } from './testing'

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
  it('f < g on part of R: the note names both, as written ("0 < x"), and says the integral counts that part negatively', () => {
    // top 0, bottom x: f < g where x > 0, and the integral of -x is 0
    const scene = sceneOf('volume: between x and 0 over x in [-1, 1], y in [0, 1]')
    const text = readout(scene, 1).text
    expect(text).toMatch(/0 < x on part of R; the integral counts that part negatively/)
    expect(Math.abs(approx(text, 'dA'))).toBeLessThan(1e-12)
  })

  it('under a surface that dips below zero: "x < 0 on part of R"', () => {
    const text = readout(sceneOf('volume: under x over x in [-1, 1], y in [0, 1]'), 1).text
    expect(text).toMatch(/x < 0 on part of R/)
  })

  it('names a defined function and a named region by their names', () => {
    const scene = sceneOf('f(x, y) = 4 - x^2 - y^2\nD = region r in [0, 2], theta in [0, 2*pi]\nvolume: under f over D')
    expect(scene.errors).toEqual([])
    const text = readout(scene, 3).text
    expect(text.startsWith('∬_D f dA ≈ ')).toBe(true)
    expect(Math.abs(approx(text, 'dA') - 8 * Math.PI)).toBeLessThan(1e-8)
  })

  it('over an inequality region: the mesh sum, with only the digits its error supports', () => {
    // the unit disc under z = 1: π
    const disc = readout(sceneOf('volume: under 1 over x^2 + y^2 <= 1 res: 160'), 1).text
    expect(Math.abs(approx(disc, 'dA') - Math.PI)).toBeLessThanOrEqual(lastDigitUnit(disc, 'dA'))
    // the hemisphere: 2π/3 = 2.0944, which 4 assumed digits printed as 2.092
    const dome = readout(sceneOf('volume: under sqrt(1 - x^2 - y^2) over x^2 + y^2 <= 1'), 1).text
    expect(Math.abs(approx(dome, 'dA') - (2 * Math.PI) / 3)).toBeLessThanOrEqual(lastDigitUnit(dome, 'dA'))
  })

  it('refuses a function of three variables as a target', () => {
    const scene = sceneOf('F(x, y, z) = x + y + z\nvolume: under F over x in [0, 1], y in [0, 1]')
    expect(scene.errors).toEqual([{ line: 2, message: expect.stringMatching(/"F" is a function of 3 variables/) }])
  })
})

describe('volume: every boundary face points out of the solid', () => {
  const cases: [string, (x: number, y: number) => boolean][] = [
    ['volume: between x^2 + y^2 and 2 over x in [-1, 1], y in [-1, 1]', (x, y) => Math.abs(x) < 1 && Math.abs(y) < 1],
    ['volume: under 1 + x over y in [0, 2], x in [0, y/2]', (x, y) => y > 0 && y < 2 && x > 0 && x < y / 2],
    ['volume: under 2 over theta in [0, pi/2], r in [1, 2]', (x, y) => Math.hypot(x, y) > 1 && Math.hypot(x, y) < 2 && x > 0 && y > 0],
    ['volume: under 1 over x^2 + y^2 <= 1 and y >= 0', (x, y) => x * x + y * y < 1 && y > 0],
  ]
  for (const [spec, inside] of cases) {
    it(spec, () => {
      const scene = sceneOf(spec)
      expect(scene.errors).toEqual([])
      const top = markNamed(scene, 's1', 'mesh')
      const bottom = markNamed(scene, 's1.bottom', 'mesh')
      // counted, then asserted once: tens of thousands of triangles
      const wrong = new Set<string>()
      for (const t of windings(top)) if (!(t.normal[2] > 0)) wrong.add('top faces down')
      for (const t of windings(bottom)) if (!(t.normal[2] < 0)) wrong.add('bottom faces up')
      const four = walls(scene)
      expect(four.length).toBeGreaterThan(0)
      for (const wall of four) {
        for (const t of windings(wall)) {
          const len = Math.hypot(t.normal[0], t.normal[1])
          if (len === 0) continue
          // 1e-2 out: past the mesh's chords, which lie up to 5e-4 inside its circle
          const [ox, oy] = [t.centre[0] + (1e-2 * t.normal[0]) / len, t.centre[1] + (1e-2 * t.normal[1]) / len]
          if (inside(ox, oy)) wrong.add(`${wall.source.object} faces in`)
        }
      }
      // and every triangle's winding agrees with its vertex normals, so the lit side is the outside
      for (const mesh of [top, bottom, ...four]) for (const t of windings(mesh)) if (!(dot(t.normal, t.vertexNormal) > 0)) wrong.add(`${mesh.source.object} against its normals`)
      expect([...wrong]).toEqual([])
    })
  }
})

describe('volume: the walls meet the top and bottom without T-junctions', () => {
  for (const spec of ['volume: between x^2 + y^2 and 2 over x in [-1, 1], y in [-1, 1]', 'volume: under 4 - x^2 - y^2 over r in [0, 2], theta in [0, pi]', 'volume: under 2 - x over x^2 + y^2 <= 1 res: 40']) {
    it(spec, () => {
      const scene = sceneOf(spec)
      const key = (p: readonly number[]) => p.map((c) => Math.round(c * 1e9)).join(',')
      const corners = new Set([...vertices(markNamed(scene, 's1', 'mesh')), ...vertices(markNamed(scene, 's1.bottom', 'mesh'))].map(key))
      for (const wall of walls(scene)) for (const p of vertices(wall)) expect([spec, corners.has(key(p))]).toEqual([spec, true])
    })
  }
})
