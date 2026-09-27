import { describe, expect, it } from 'vitest'
import type { BoxMark, PointMark, SpaceScene } from '../../scene/types'
import { approx, kernelOf, markNamed, readout, sceneOf } from './testing'

function boxes(scene: SpaceScene, line = 1): BoxMark {
  return markNamed(scene, `s${line}`, 'boxes')
}

function samples(scene: SpaceScene, line = 1): number[][] {
  const mark: PointMark = markNamed(scene, `s${line}.samples`, 'points')
  const out: number[][] = []
  for (let i = 0; i < mark.positions.length; i += 3) out.push([mark.positions[i], mark.positions[i + 1], mark.positions[i + 2]])
  return out
}

const tops = (mark: BoxMark) => Array.from({ length: mark.maxs.length / 3 }, (_, i) => mark.maxs[3 * i + 2])

describe('riemann: under x*y over x in [0, 2], y in [0, 2], n = 2', () => {
  const spec = 'riemann: under x*y over x in [0, 2], y in [0, 2], n = 2'

  it('mid: samples at the four cell centres, heights 0.25, 0.75, 0.75, 2.25, Σ ΔA = 4 = ∬', () => {
    const scene = sceneOf(spec)
    expect(scene.errors).toEqual([])
    expect(samples(scene)).toEqual([
      [0.5, 0.5, 0.25],
      [1.5, 0.5, 0.75],
      [0.5, 1.5, 0.75],
      [1.5, 1.5, 2.25],
    ])
    const mark = boxes(scene)
    expect(tops(mark)).toEqual([0.25, 0.75, 0.75, 2.25])
    expect(Array.from(mark.mins)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0])
    expect(Array.from(mark.maxs.filter((_, i) => i % 3 !== 2))).toEqual([1, 1, 2, 1, 1, 2, 2, 2])
    const text = readout(scene, 1).text
    expect(approx(text, 'ΔA')).toBe(4)
    expect(approx(text, 'dA')).toBeCloseTo(4, 10)
  })

  it('upper-right: heights 1, 2, 2, 4, Σ ΔA = 9', () => {
    const scene = sceneOf(`${spec} sample: upper-right`)
    expect(tops(boxes(scene))).toEqual([1, 2, 2, 4])
    expect(approx(readout(scene, 1).text, 'ΔA')).toBe(9)
  })

  it('the other corners: lower-left 1 (0 + 0 + 0 + 1), lower-right and upper-left 3 (0 + 0 + 1 + 2)', () => {
    expect(approx(readout(sceneOf(`${spec} sample: lower-left`), 1).text, 'ΔA')).toBe(1)
    expect(approx(readout(sceneOf(`${spec} sample: lower-right`), 1).text, 'ΔA')).toBe(3)
    expect(approx(readout(sceneOf(`${spec} sample: upper-left`), 1).text, 'ΔA')).toBe(3)
    expect(samples(sceneOf(`${spec} sample: lower-right`)).map((p) => p.slice(0, 2))).toEqual([
      [1, 0],
      [2, 0],
      [1, 1],
      [2, 1],
    ])
  })

  it('is drawn at opacity 0.6 with edges, in the statement’s colour, sample dots on the tops', () => {
    const scene = sceneOf(spec)
    expect(boxes(scene).style).toEqual({ color: { author: null, slot: 0 }, opacity: 0.6, edges: true })
    expect(markNamed(scene, 's1.samples', 'points').style.color).toEqual({ author: null, slot: 0 })
  })
})

describe('riemann: counts, sampling and parameters', () => {
  it('n = 4 by 3 gives 12 boxes, 4 along x and 3 along y', () => {
    const mark = boxes(sceneOf('riemann: under x + y over x in [0, 2], y in [0, 1], n = 4 by 3'))
    expect(mark.mins.length / 3).toBe(12)
    expect(mark.maxs[0] - mark.mins[0]).toBe(0.5)
    expect(mark.maxs[1] - mark.mins[1]).toBeCloseTo(1 / 3, 15)
  })

  it('random is deterministic across two builds, and each sample lies in its own cell', () => {
    const spec = 'riemann: under x*y over x in [0, 2], y in [0, 2], n = 3 sample: random'
    const a = samples(sceneOf(spec))
    expect(samples(sceneOf(spec))).toEqual(a)
    const width = 2 / 3
    a.forEach(([x, y], k) => {
      const [i, j] = [k % 3, Math.floor(k / 3)]
      expect(x).toBeGreaterThanOrEqual(i * width)
      expect(x).toBeLessThanOrEqual((i + 1) * width)
      expect(y).toBeGreaterThanOrEqual(j * width)
      expect(y).toBeLessThanOrEqual((j + 1) * width)
    })
    // Not the midpoints, and not all the same offset.
    const offsets = new Set(a.map(([x]) => Math.round(((x % width) / width) * 1e6)))
    expect(offsets.size).toBeGreaterThan(3)
  })

  it('n from a binding rebuilds on setValue, and the sum converges toward the integral', () => {
    const kernel = kernelOf('@param n = 2 range [1, 20] integer\nriemann: under x*y over x in [0, 2], y in [0, 2], n = n sample: upper-right')
    expect(boxes(kernel.scene(), 2).mins.length / 3).toBe(4)
    expect(approx(readout(kernel.scene(), 2).text, 'ΔA')).toBe(9)
    const scene = kernel.setValue('n', 4)
    expect(boxes(scene, 2).mins.length / 3).toBe(16)
    // upper-right with n = 4: (Σ i/2)^2 * (1/4) for i = 1..4 = 25 * 0.25 = 6.25
    expect(approx(readout(scene, 2).text, 'ΔA')).toBe(6.25)
  })

  it('refuses n that is not a whole number from 1 to 100', () => {
    expect(sceneOf('riemann: under x*y over x in [0, 2], y in [0, 2], n = 2.5').errors).toEqual([
      { line: 1, message: expect.stringMatching(/n must be a whole number from 1 to 100, got 2.5/) },
    ])
    expect(sceneOf('riemann: under x*y over x in [0, 2], y in [0, 2], n = 0').errors).toHaveLength(1)
  })

  it('refuses a named region that is not a rectangle, and draws one that is', () => {
    const tri = sceneOf('R = region x in [0, 1], y in [0, x]\nriemann: under x over R, n = 2')
    expect(tri.errors).toEqual([{ line: 2, message: 'Riemann boxes need a rectangle; use x in [a, b], y in [c, d]' }])
    const square = sceneOf('Q = region x in [0, 2], y in [0, 2]\nriemann: under x*y over Q, n = 2')
    expect(square.errors).toEqual([])
    expect(approx(readout(square, 2).text, 'ΔA')).toBe(4)
  })

  it('refuses a sample where f is undefined', () => {
    const scene = sceneOf('riemann: under 1/(x - 0.5) over x in [0, 1], y in [0, 1], n = 1')
    expect(scene.errors).toEqual([{ line: 1, message: expect.stringMatching(/undefined at the sample \(0\.5, 0\.5\)/) }])
  })
})
