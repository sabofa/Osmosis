import { describe, expect, it } from 'vitest'
import { det2, det3, solve2, solve3, symEig2, symEig3 } from './linalg'

describe('determinants and solves', () => {
  it('det2 and solve2', () => {
    // 2*4 - 1*3 = 5
    expect(det2([[2, 1], [3, 4]])).toBe(5)
    // 2x + y = 3, 3x + 4y = 7 -> x = 1, y = 1
    expect(solve2([[2, 1], [3, 4]], [3, 7])).toEqual([1, 1])
    // rows proportional
    expect(solve2([[1, 2], [2, 4]], [1, 2])).toBeNull()
  })

  it('det3 of a singular matrix is 0, and solve3 refuses it', () => {
    // 2(3*1 - 2*1) - 0(1*1 - 2*1) + 1(1*1 - 3*1) = 2 - 0 - 2 = 0
    const m = [
      [2, 0, 1],
      [1, 3, 2],
      [1, 1, 1],
    ]
    expect(det3(m)).toBe(0)
    expect(solve3(m, [1, 2, 3])).toBeNull()
  })

  it('solve3 on a regular system', () => {
    // x + y + z = 6, 2y + 5z = -4, 2x + 5y - z = 27 -> (5, 3, -2)
    const x = solve3(
      [
        [1, 1, 1],
        [0, 2, 5],
        [2, 5, -1],
      ],
      [6, -4, 27]
    )!
    expect(x[0]).toBeCloseTo(5, 13)
    expect(x[1]).toBeCloseTo(3, 13)
    expect(x[2]).toBeCloseTo(-2, 13)
  })

  it('singularity is relative to the matrix’s scale', () => {
    // A tiny but regular matrix is still solvable: (1e-20 I) x = 1e-20 (1, 2, 3).
    const s = 1e-20
    const x = solve3(
      [
        [s, 0, 0],
        [0, s, 0],
        [0, 0, s],
      ],
      [s, 2 * s, 3 * s]
    )!
    expect(x).toEqual([1, 2, 3])
  })
})

describe('symmetric eigenvalues, ascending', () => {
  it('symEig2 of [[2,1],[1,2]] is [1, 3]', () => {
    expect(symEig2([[2, 1], [1, 2]])).toEqual([1, 3])
  })

  it('symEig3 of diag(3, 1, 2) is [1, 2, 3]', () => {
    expect(
      symEig3([
        [3, 0, 0],
        [0, 1, 0],
        [0, 0, 2],
      ])
    ).toEqual([1, 2, 3])
  })

  it('symEig3 of the second-difference matrix is [2 - sqrt 2, 2, 2 + sqrt 2]', () => {
    // characteristic polynomial (2 - l)((2 - l)^2 - 2) = 0
    const eig = symEig3([
      [2, -1, 0],
      [-1, 2, -1],
      [0, -1, 2],
    ])
    expect(eig[0]).toBeCloseTo(2 - Math.SQRT2, 13)
    expect(eig[1]).toBeCloseTo(2, 13)
    expect(eig[2]).toBeCloseTo(2 + Math.SQRT2, 13)
  })
})
