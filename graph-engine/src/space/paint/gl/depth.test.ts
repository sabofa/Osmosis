import { describe, expect, it } from 'vitest'
import { depthBias, DEPTH_BIAS_FRACTION, NO_SURFACE, originMatrix } from './depth'

// Column-major clip = M p
const apply = (m: ArrayLike<number>, p: readonly number[]) => [0, 1, 2, 3].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r])

describe('the depth pass helpers', () => {
  const vp = Float32Array.from([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, -0.1, -0.5, 0.25, -0.5, 0.75, 1.5])

  it('folds the scene origin into the matrix: a mesh stored relative to the origin lands where the absolute point does', () => {
    const origin: [number, number, number] = [10, -4, 2.5]
    const p = [10.5, -3, 3]
    const rel = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]]
    const a = apply(originMatrix(vp, origin), rel)
    const b = apply(vp, p)
    for (let i = 0; i < 4; i++) expect(a[i]).toBeCloseTo(b[i], 4)
  })

  it('is the matrix itself for a scene at the origin', () => {
    expect(Array.from(originMatrix(vp, [0, 0, 0]))).toEqual(Array.from(vp))
  })

  it('does not flip y or scale to a grid: the paint targets are drawn as the strokes are, GL y up', () => {
    // a point at ndc y = +0.5 stays at +0.5 (the G-buffer matrix, which flips y for readback, would put it at -0.5)
    const m = originMatrix(Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), [0, 0, 0])
    expect(apply(m, [0, 0.5, 0])[1]).toBe(0.5)
  })

  it('has a bias of about a hundredth of the scene radius (0.012), and a no-surface depth far past any scene', () => {
    expect(DEPTH_BIAS_FRACTION).toBe(0.012)
    expect(depthBias(2)).toBeCloseTo(0.024, 12)
    expect(depthBias(0)).toBeGreaterThan(0)
    expect(NO_SURFACE).toBe(1e30)
  })
})
