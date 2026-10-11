// Where a z = f(x, y) surface is (plan E6): the graph pick marches the true
// f along the ray, but f is defined beyond the surface's domain (a paraboloid
// over a disk), so a crossing only counts where the mesh covers (x, y). This
// answers that with a uniform grid over the mesh's xy bounding box, each cell
// listing the triangles whose xy bounding boxes touch it. Built on the first
// pick of a mark and cached by mark identity.

import type { MeshMark } from '../scene/types'

export interface Footprint {
  contains(x: number, y: number): boolean
}

const CACHE = new WeakMap<MeshMark, Footprint>()
// Barycentric slack, so a point on a shared edge is inside one of its triangles.
const EDGE_EPS = 1e-9

export function footprintOf(mark: MeshMark): Footprint {
  let known = CACHE.get(mark)
  if (!known) {
    known = buildFootprint(mark.positions, mark.indices)
    CACHE.set(mark, known)
  }
  return known
}

export function buildFootprint(positions: Float64Array, indices: Uint32Array): Footprint {
  const triangles = Math.floor(indices.length / 3)
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (let i = 0; i < indices.length; i++) {
    const x = positions[3 * indices[i]]
    const y = positions[3 * indices[i] + 1]
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  if (!(triangles > 0) || !(x1 >= x0) || !(y1 >= y0)) return { contains: () => false }
  const n = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(triangles / 4))))
  const w = (x1 - x0) / n || 1
  const h = (y1 - y0) / n || 1
  const cell = (v: number, lo: number, size: number) => Math.min(n - 1, Math.max(0, Math.floor((v - lo) / size)))
  const cells: number[][] = Array.from({ length: n * n }, () => [])
  for (let t = 0; t < triangles; t++) {
    let tx0 = Infinity
    let tx1 = -Infinity
    let ty0 = Infinity
    let ty1 = -Infinity
    for (let k = 0; k < 3; k++) {
      const v = indices[3 * t + k]
      tx0 = Math.min(tx0, positions[3 * v])
      tx1 = Math.max(tx1, positions[3 * v])
      ty0 = Math.min(ty0, positions[3 * v + 1])
      ty1 = Math.max(ty1, positions[3 * v + 1])
    }
    for (let j = cell(ty0, y0, h); j <= cell(ty1, y0, h); j++) {
      for (let i = cell(tx0, x0, w); i <= cell(tx1, x0, w); i++) cells[j * n + i].push(t)
    }
  }
  const inTriangle = (t: number, x: number, y: number) => {
    const a = 3 * indices[3 * t]
    const b = 3 * indices[3 * t + 1]
    const c = 3 * indices[3 * t + 2]
    const ax = positions[a]
    const ay = positions[a + 1]
    const v0x = positions[b] - ax
    const v0y = positions[b + 1] - ay
    const v1x = positions[c] - ax
    const v1y = positions[c + 1] - ay
    const det = v0x * v1y - v1x * v0y
    if (det === 0) return false
    const px = x - ax
    const py = y - ay
    const l1 = (px * v1y - v1x * py) / det
    const l2 = (v0x * py - px * v0y) / det
    return l1 >= -EDGE_EPS && l2 >= -EDGE_EPS && l1 + l2 <= 1 + EDGE_EPS
  }
  const tolX = EDGE_EPS * (x1 - x0)
  const tolY = EDGE_EPS * (y1 - y0)
  return {
    contains(x, y) {
      if (x < x0 - tolX || x > x1 + tolX || y < y0 - tolY || y > y1 + tolY) return false
      return cells[cell(y, y0, h) * n + cell(x, x0, w)].some((t) => inTriangle(t, x, y))
    },
  }
}
