// Marching tetrahedra (plan A1): the level set F = c over a box, as a
// triangle mesh.
//
// - The box is a grid of n^3 cubes. F is sampled once at the (n + 1)^3 grid
//   points (sampleGrid), and every level of one F reuses the samples.
// - Every cube is split into the same six tetrahedra along its main diagonal
//   (the Kuhn split: one per ordering of the axes, 0 -> e_a -> e_a + e_b ->
//   (1, 1, 1)). Each face of a cube is then cut along the same diagonal from
//   both sides, so neighbouring cubes' triangles meet edge to edge with no
//   ambiguity table and no cracks.
// - A grid point is inside when F - c < 0, else outside. A tetrahedron with
//   one or three inside corners gives one triangle, with two a quad split in
//   two.
// - Each crossing vertex lies on the edge's TRUE zero, refined by bisection
//   on F itself until the bracket is BISECTION_REL of the edge, and it is
//   shared through a global key of the edge's two grid points, so every
//   tetrahedron touching an edge uses the same vertex. A crossing at a grid
//   point where F - c is exactly 0 is keyed by that point, so the edges that
//   meet there share it too; the triangles that collapse onto it are dropped.
// - Triangles are wound so their geometric normal points toward increasing
//   F, the direction of the gradient: from the tetrahedron's inside corners
//   toward its outside ones.
// - A non-finite sample voids every cube touching it, which leaves an honest
//   hole and no error.

import { BISECTION_REL } from '../../../math/tolerance'
import type { Box3, Range } from '../../scene/types'
import { MAX_TRIANGLES } from '../common'

export type Field = (x: number, y: number, z: number) => number

// The most cubes per axis an implicit surface is sampled at: (n + 1)^3
// samples of F are held at once.
export const MAX_IMPLICIT_RES = 160

export interface Grid {
  box: Box3
  // cubes per axis
  n: number
  // F at the (n + 1)^3 grid points, x fastest, then y, then z
  values: Float64Array
}

export interface Isosurface {
  positions: Float64Array
  indices: Uint32Array
}

// The six tetrahedra of a cube, as corner numbers (bit 0 is +x, bit 1 +y,
// bit 2 +z), one per ordering of the axes.
export const KUHN_TETS: readonly (readonly [number, number, number, number])[] = [
  [0, 1, 3, 7],
  [0, 1, 5, 7],
  [0, 2, 3, 7],
  [0, 2, 6, 7],
  [0, 4, 5, 7],
  [0, 4, 6, 7],
]

function coordinates(range: Range, n: number): Float64Array {
  const out = new Float64Array(n + 1)
  for (let i = 0; i <= n; i++) out[i] = range.min + (range.max - range.min) * (i / n)
  return out
}

export function checkImplicitRes(n: number): void {
  if (n > MAX_IMPLICIT_RES) {
    throw new Error(`res ${n} is over the ${MAX_IMPLICIT_RES} cubes per axis an implicit surface is sampled at — lower the resolution`)
  }
}

export function sampleGrid(F: Field, box: Box3, n: number): Grid {
  const xs = coordinates(box.x, n)
  const ys = coordinates(box.y, n)
  const zs = coordinates(box.z, n)
  const s = n + 1
  const values = new Float64Array(s * s * s)
  let g = 0
  for (let k = 0; k <= n; k++) {
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) values[g++] = F(xs[i], ys[j], zs[k])
    }
  }
  return { box, n, values }
}

// The smallest and largest finite values of F on a `samples`^3 grid over the
// box (the range "levels n" divides), or null when none is finite.
export function sampledRange(F: Field, box: Box3, samples: number): Range | null {
  const { values } = sampleGrid(F, box, samples - 1)
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  return min <= max ? { min, max } : null
}

// The level set F = level over the grid's box.
export function marchingTets(F: Field, grid: Grid, level: number): Isosurface {
  const { n, values } = grid
  const s = n + 1
  const total = s * s * s
  const xs = coordinates(grid.box.x, n)
  const ys = coordinates(grid.box.y, n)
  const zs = coordinates(grid.box.z, n)
  const gx = (g: number) => xs[g % s]
  const gy = (g: number) => ys[Math.floor(g / s) % s]
  const gz = (g: number) => zs[Math.floor(g / (s * s))]

  const positions: number[] = []
  const indices: number[] = []
  const vertexOf = new Map<number, number>()

  // The vertex where F crosses the level on the edge from grid point `a`
  // (inside) to `b` (outside).
  const crossing = (a: number, b: number): number => {
    const onB = values[b] - level === 0
    const key = onB ? -1 - b : a < b ? a * total + b : b * total + a
    const known = vertexOf.get(key)
    if (known !== undefined) return known
    const ax = gx(a)
    const ay = gy(a)
    const az = gz(a)
    const bx = gx(b)
    const by = gy(b)
    const bz = gz(b)
    let t = 1
    if (!onB) {
      let lo = 0
      let hi = 1
      while (hi - lo > BISECTION_REL) {
        const mid = 0.5 * (lo + hi)
        // A non-finite value counts as outside, as a value >= level does.
        if (F(ax + mid * (bx - ax), ay + mid * (by - ay), az + mid * (bz - az)) - level < 0) lo = mid
        else hi = mid
      }
      t = 0.5 * (lo + hi)
    }
    const index = positions.length / 3
    if (onB) positions.push(bx, by, bz)
    else positions.push(ax + t * (bx - ax), ay + t * (by - ay), az + t * (bz - az))
    vertexOf.set(key, index)
    return index
  }

  // One triangle, wound so its normal points along (dx, dy, dz); a triangle
  // collapsed onto a grid point is dropped.
  const emit = (p: number, q: number, r: number, dx: number, dy: number, dz: number) => {
    if (p === q || q === r || p === r) return
    const e1x = positions[3 * q] - positions[3 * p]
    const e1y = positions[3 * q + 1] - positions[3 * p + 1]
    const e1z = positions[3 * q + 2] - positions[3 * p + 2]
    const e2x = positions[3 * r] - positions[3 * p]
    const e2y = positions[3 * r + 1] - positions[3 * p + 1]
    const e2z = positions[3 * r + 2] - positions[3 * p + 2]
    const nx = e1y * e2z - e1z * e2y
    const ny = e1z * e2x - e1x * e2z
    const nz = e1x * e2y - e1y * e2x
    if (nx * dx + ny * dy + nz * dz < 0) indices.push(p, r, q)
    else indices.push(p, q, r)
    if (indices.length / 3 > MAX_TRIANGLES) {
      throw new Error(`res ${n} makes more than ${MAX_TRIANGLES.toLocaleString('en-US')} triangles — lower the resolution`)
    }
  }

  const corner = new Int32Array(8)
  const inside: number[] = []
  const outside: number[] = []
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const base = (k * s + j) * s + i
        let finite = true
        for (let c = 0; c < 8; c++) {
          const g = base + (c & 1) + ((c >> 1) & 1) * s + ((c >> 2) & 1) * s * s
          corner[c] = g
          if (!Number.isFinite(values[g])) finite = false
        }
        if (!finite) continue
        for (const tet of KUHN_TETS) {
          inside.length = 0
          outside.length = 0
          for (const c of tet) (values[corner[c]] - level < 0 ? inside : outside).push(corner[c])
          if (inside.length === 0 || outside.length === 0) continue
          // From the inside corners' centroid toward the outside corners':
          // the direction F increases in.
          let dx = 0
          let dy = 0
          let dz = 0
          for (const g of outside) {
            dx += gx(g) / outside.length
            dy += gy(g) / outside.length
            dz += gz(g) / outside.length
          }
          for (const g of inside) {
            dx -= gx(g) / inside.length
            dy -= gy(g) / inside.length
            dz -= gz(g) / inside.length
          }
          if (inside.length === 1) {
            const [p] = inside
            emit(crossing(p, outside[0]), crossing(p, outside[1]), crossing(p, outside[2]), dx, dy, dz)
          } else if (inside.length === 3) {
            const [q] = outside
            emit(crossing(inside[0], q), crossing(inside[1], q), crossing(inside[2], q), dx, dy, dz)
          } else {
            // The quad's corners in cyclic order: consecutive ones share an
            // inside or an outside corner.
            const [p1, p2] = inside
            const [q1, q2] = outside
            const a = crossing(p1, q1)
            const b = crossing(p1, q2)
            const c = crossing(p2, q2)
            const d = crossing(p2, q1)
            emit(a, b, c, dx, dy, dz)
            emit(a, c, d, dx, dy, dz)
          }
        }
      }
    }
  }
  return { positions: Float64Array.from(positions), indices: Uint32Array.from(indices) }
}
