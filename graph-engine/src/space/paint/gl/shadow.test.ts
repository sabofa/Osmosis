import { describe, expect, it } from 'vitest'
import { lightFrame, SHADOW_FIT, SHADOW_SIZE } from './shadow'

// Apply the light matrix (column-major, positions relative to the origin).
function clip(m: Float32Array, p: [number, number, number]): [number, number, number] {
  return [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]) as [number, number, number]
}

describe('lightFrame', () => {
  it('a light straight above looks down with x along +x and y along +y: radius 2, a point 2 up is nearest (depth -1)', () => {
    const f = lightFrame([0, 0, 1], 2)
    expect(f.right).toEqual([1, 0, 0])
    expect(f.up.map((v) => Math.abs(v))).toEqual([0, 1, 0])
    const c = clip(f.matrix, [0, 0, 2])
    expect(c[2]).toBeCloseTo(-1, 6)
    // The far side of the sphere is at depth +1, the centre at 0.
    expect(clip(f.matrix, [0, 0, -2])[2]).toBeCloseTo(1, 6)
    expect(clip(f.matrix, [0, 0, 0])[2]).toBeCloseTo(0, 6)
  })

  it('a light from +x: right is +y, up is +z, so (0, 1, 0) * radius is the right edge and (0, 0, 1) * radius the top', () => {
    const f = lightFrame([1, 0, 0], 3)
    expect(f.right.map((v) => +v.toFixed(6))).toEqual([0, 1, 0])
    expect(f.up.map((v) => +v.toFixed(6))).toEqual([0, 0, 1])
    const edge = clip(f.matrix, [0, 3, 0])
    expect(edge[0]).toBeCloseTo(1, 6)
    expect(edge[1]).toBeCloseTo(0, 6)
    const top = clip(f.matrix, [0, 0, 3])
    expect(top[0]).toBeCloseTo(0, 6)
    expect(top[1]).toBeCloseTo(1, 6)
  })

  it('keeps an orthonormal frame for an oblique light', () => {
    const f = lightFrame([0.3, -0.4, 0.5], 1)
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    expect(dot(f.right, f.right)).toBeCloseTo(1, 6)
    expect(dot(f.up, f.up)).toBeCloseTo(1, 6)
    expect(dot(f.toward, f.toward)).toBeCloseTo(1, 6)
    expect(dot(f.right, f.up)).toBeCloseTo(0, 6)
    expect(dot(f.right, f.toward)).toBeCloseTo(0, 6)
    expect(dot(f.up, f.toward)).toBeCloseTo(0, 6)
  })

  it('has a map of 1024 squared and fits the sphere with a 2% margin', () => {
    expect(SHADOW_SIZE).toBe(1024)
    expect(SHADOW_FIT).toBeCloseTo(1.02, 6)
  })
})
