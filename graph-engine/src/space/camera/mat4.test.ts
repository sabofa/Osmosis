import { describe, expect, it } from 'vitest'
import { identity, invert, multiply, ortho, perspective, transformPoint } from './mat4'

// Hand-computed: column-major, so element (row r, column c) is m[c * 4 + r].
describe('mat4', () => {
  it('multiplies column-major: a translation after a scale moves the scaled point', () => {
    const scale = identity()
    scale[0] = 2
    scale[5] = 3
    scale[10] = 4
    const translate = identity()
    translate[12] = 1
    translate[13] = -1
    translate[14] = 5
    // (T * S) p = T (S p): (1, 1, 1) -> (2, 3, 4) -> (3, 2, 9).
    expect(Array.from(transformPoint(multiply(translate, scale), [1, 1, 1]))).toEqual([3, 2, 9, 1])
  })

  it('inverts a scale-and-translate exactly', () => {
    const m = identity()
    m[0] = 2
    m[5] = 4
    m[10] = 8
    m[12] = 3
    const inv = invert(m)
    expect(inv).not.toBeNull()
    // m p = (2x + 3, 4y, 8z); m^-1 (5, 4, 8) = (1, 1, 1).
    expect(Array.from(transformPoint(inv!, [5, 4, 8]))).toEqual([1, 1, 1, 1])
  })

  it('refuses a singular matrix', () => {
    const m = identity()
    m[10] = 0
    expect(invert(m)).toBeNull()
  })

  it('ortho maps the box corners to the NDC cube (near to -1, far to +1)', () => {
    const m = ortho(-2, 2, -1, 1, 1, 11)
    // Eye space looks down -z: a point at z = -1 is on the near plane.
    const near = transformPoint(m, [2, 1, -1])
    const far = transformPoint(m, [-2, -1, -11])
    ;[1, 1, -1, 1].forEach((v, i) => expect(near[i]).toBeCloseTo(v, 14))
    ;[-1, -1, 1, 1].forEach((v, i) => expect(far[i]).toBeCloseTo(v, 14))
  })

  it('perspective puts the near plane at NDC -1 and the far plane at +1', () => {
    const m = perspective(Math.PI / 2, 1, 1, 3)
    const near = transformPoint(m, [0, 0, -1])
    const far = transformPoint(m, [0, 0, -3])
    expect(near[2] / near[3]).toBeCloseTo(-1, 12)
    expect(far[2] / far[3]).toBeCloseTo(1, 12)
    // 90 degree fov: at depth 1, y = 1 is the top edge.
    const top = transformPoint(m, [0, 1, -1])
    expect(top[1] / top[3]).toBeCloseTo(1, 12)
  })
})
