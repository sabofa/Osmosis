// 2x2 and 3x3 dense linear algebra (K4): determinants, solves that refuse a
// singular matrix, and symmetric eigenvalues; and a 4x4 solve, for Newton on
// a three-variable Lagrange system (x, y, z, λ). Matrices are row-major
// arrays.

import { JACOBI_REL, SINGULAR_REL } from './tolerance'

export type Matrix = readonly (readonly number[])[]

export function det2(m: Matrix): number {
  return m[0][0] * m[1][1] - m[0][1] * m[1][0]
}

export function det3(m: Matrix): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  )
}

function rowNormProduct(m: Matrix): number {
  let product = 1
  for (const row of m) product *= Math.hypot(...row)
  return product
}

// Singular when |det| is at most SINGULAR_REL times Hadamard's bound (the
// product of the row norms), so the test is independent of scale.
function singular(det: number, m: Matrix): boolean {
  const bound = rowNormProduct(m)
  return !(bound > 0) || !Number.isFinite(det) || Math.abs(det) <= SINGULAR_REL * bound
}

export function solve2(m: Matrix, b: readonly number[]): [number, number] | null {
  const det = det2(m)
  if (singular(det, m)) return null
  // Cramer's rule.
  return [(b[0] * m[1][1] - m[0][1] * b[1]) / det, (m[0][0] * b[1] - b[0] * m[1][0]) / det]
}

export function solve3(m: Matrix, b: readonly number[]): [number, number, number] | null {
  if (singular(det3(m), m)) return null
  // Gaussian elimination with partial pivoting, on a copy.
  const a = m.map((row, i) => [row[0], row[1], row[2], b[i]])
  for (let col = 0; col < 3; col++) {
    let pivot = col
    for (let r = col + 1; r < 3; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r
    if (pivot !== col) [a[col], a[pivot]] = [a[pivot], a[col]]
    for (let r = col + 1; r < 3; r++) {
      const factor = a[r][col] / a[col][col]
      for (let c = col; c < 4; c++) a[r][c] -= factor * a[col][c]
    }
  }
  const x2 = a[2][3] / a[2][2]
  const x1 = (a[1][3] - a[1][2] * x2) / a[1][1]
  const x0 = (a[0][3] - a[0][1] * x1 - a[0][2] * x2) / a[0][0]
  return [x0, x1, x2]
}

// Gaussian elimination with partial pivoting, on a copy. The determinant is
// the product of the pivots, negated for each row swap, and the matrix is
// refused as singular by the same relative test as solve2 and solve3.
export function solve4(m: Matrix, b: readonly number[]): [number, number, number, number] | null {
  const a = m.map((row, i) => [row[0], row[1], row[2], row[3], b[i]])
  let det = 1
  for (let col = 0; col < 4; col++) {
    let pivot = col
    for (let r = col + 1; r < 4; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r
    if (pivot !== col) {
      const swap = a[col]
      a[col] = a[pivot]
      a[pivot] = swap
      det = -det
    }
    det *= a[col][col]
    if (a[col][col] === 0) return null
    for (let r = col + 1; r < 4; r++) {
      const factor = a[r][col] / a[col][col]
      for (let c = col; c < 5; c++) a[r][c] -= factor * a[col][c]
    }
  }
  if (singular(det, m)) return null
  const x = [0, 0, 0, 0]
  for (let r = 3; r >= 0; r--) {
    let sum = a[r][4]
    for (let c = r + 1; c < 4; c++) sum -= a[r][c] * x[c]
    x[r] = sum / a[r][r]
  }
  return [x[0], x[1], x[2], x[3]]
}

// Eigenvalues of a symmetric 2x2, ascending, in closed form.
export function symEig2(m: Matrix): number[] {
  const mean = (m[0][0] + m[1][1]) / 2
  const radius = Math.hypot((m[0][0] - m[1][1]) / 2, m[0][1])
  return [mean - radius, mean + radius]
}

// Eigenvalues of a symmetric 3x3, ascending, by cyclic Jacobi rotations.
export function symEig3(m: Matrix): number[] {
  const a = m.map((row) => [...row])
  const frobenius = Math.hypot(...a.flat())
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.hypot(a[0][1], a[0][2], a[1][2])
    if (off <= JACOBI_REL * frobenius) break
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (a[p][q] === 0) continue
        // The rotation that zeroes a[p][q] (the stable form of the angle).
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p]
          const akq = a[k][q]
          a[k][p] = c * akp - s * akq
          a[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k]
          const aqk = a[q][k]
          a[p][k] = c * apk - s * aqk
          a[q][k] = s * apk + c * aqk
        }
      }
    }
  }
  return [a[0][0], a[1][1], a[2][2]].sort((x, y) => x - y)
}
