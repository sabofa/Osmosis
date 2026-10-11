// A bounding-volume hierarchy over a mesh's triangles (plan E6), for ray
// picks on parametric and implicit surfaces. Pure.
//
// - Median split on triangle centroids along the longest axis of their
//   bounds; leaves of at most 8 triangles.
// - Built on the first pick of a mark and cached by mark identity (a mark is
//   never mutated; setValue makes a new one).
// - Ray-triangle is Moller-Trumbore, two-sided, in Float64; the nearest hit
//   in [sMin, sMax] wins. intersectTriangles is the brute-force reference the
//   BVH must agree with.

import type { MeshMark } from '../scene/types'
import type { Ray } from './types'

export const LEAF_SIZE = 8
// Barycentric slack, so a ray through a shared edge hits one of its triangles.
const EDGE_EPS = 1e-12

export interface Bvh {
  // Per node: min xyz, max xyz.
  bounds: Float64Array
  // Per node: child indices, or -1 for a leaf.
  left: Int32Array
  right: Int32Array
  // Per leaf: its triangles, order[start .. start + count).
  start: Int32Array
  count: Int32Array
  order: Uint32Array
}

export interface TriangleHit {
  s: number
  triangle: number
  // Barycentric weights of the triangle's second and third vertices.
  b1: number
  b2: number
}

const CACHE = new WeakMap<MeshMark, Bvh>()

export function bvhOf(mark: MeshMark): Bvh {
  let known = CACHE.get(mark)
  if (!known) {
    known = buildBvh(mark.positions, mark.indices)
    CACHE.set(mark, known)
  }
  return known
}

export function buildBvh(positions: Float64Array, indices: Uint32Array): Bvh {
  const triangles = Math.floor(indices.length / 3)
  const centroid = new Float64Array(3 * triangles)
  const tmin = new Float64Array(3 * triangles)
  const tmax = new Float64Array(3 * triangles)
  for (let t = 0; t < triangles; t++) {
    for (let a = 0; a < 3; a++) {
      const p = positions[3 * indices[3 * t] + a]
      const q = positions[3 * indices[3 * t + 1] + a]
      const r = positions[3 * indices[3 * t + 2] + a]
      centroid[3 * t + a] = (p + q + r) / 3
      tmin[3 * t + a] = Math.min(p, q, r)
      tmax[3 * t + a] = Math.max(p, q, r)
    }
  }
  const order = new Uint32Array(triangles)
  for (let t = 0; t < triangles; t++) order[t] = t
  const bounds: number[] = []
  const left: number[] = []
  const right: number[] = []
  const start: number[] = []
  const count: number[] = []

  const build = (from: number, to: number): number => {
    const node = left.length
    left.push(-1)
    right.push(-1)
    start.push(from)
    count.push(to - from)
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    const clo = [Infinity, Infinity, Infinity]
    const chi = [-Infinity, -Infinity, -Infinity]
    for (let i = from; i < to; i++) {
      const t = order[i]
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], tmin[3 * t + a])
        hi[a] = Math.max(hi[a], tmax[3 * t + a])
        clo[a] = Math.min(clo[a], centroid[3 * t + a])
        chi[a] = Math.max(chi[a], centroid[3 * t + a])
      }
    }
    bounds.push(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2])
    const extent = [chi[0] - clo[0], chi[1] - clo[1], chi[2] - clo[2]]
    const axis = extent[0] >= extent[1] && extent[0] >= extent[2] ? 0 : extent[1] >= extent[2] ? 1 : 2
    if (to - from <= LEAF_SIZE || !(extent[axis] > 0)) return node
    order.subarray(from, to).sort((p, q) => centroid[3 * p + axis] - centroid[3 * q + axis] || p - q)
    const mid = (from + to) >> 1
    const l = build(from, mid)
    const r = build(mid, to)
    left[node] = l
    right[node] = r
    count[node] = 0
    return node
  }
  if (triangles > 0) build(0, triangles)
  return {
    bounds: Float64Array.from(bounds),
    left: Int32Array.from(left),
    right: Int32Array.from(right),
    start: Int32Array.from(start),
    count: Int32Array.from(count),
    order,
  }
}

// Moller-Trumbore: the ray parameter s and barycentrics of a hit, or null.
export function intersectTriangle(positions: Float64Array, indices: Uint32Array, t: number, ray: Ray): TriangleHit | null {
  const a = 3 * indices[3 * t]
  const b = 3 * indices[3 * t + 1]
  const c = 3 * indices[3 * t + 2]
  const [ox, oy, oz] = ray.origin
  const [dx, dy, dz] = ray.direction
  const e1x = positions[b] - positions[a]
  const e1y = positions[b + 1] - positions[a + 1]
  const e1z = positions[b + 2] - positions[a + 2]
  const e2x = positions[c] - positions[a]
  const e2y = positions[c + 1] - positions[a + 1]
  const e2z = positions[c + 2] - positions[a + 2]
  const px = dy * e2z - dz * e2y
  const py = dz * e2x - dx * e2z
  const pz = dx * e2y - dy * e2x
  const det = e1x * px + e1y * py + e1z * pz
  if (det === 0 || !Number.isFinite(det)) return null
  const inv = 1 / det
  const tx = ox - positions[a]
  const ty = oy - positions[a + 1]
  const tz = oz - positions[a + 2]
  const b1 = (tx * px + ty * py + tz * pz) * inv
  if (b1 < -EDGE_EPS || b1 > 1 + EDGE_EPS) return null
  const qx = ty * e1z - tz * e1y
  const qy = tz * e1x - tx * e1z
  const qz = tx * e1y - ty * e1x
  const b2 = (dx * qx + dy * qy + dz * qz) * inv
  if (b2 < -EDGE_EPS || b1 + b2 > 1 + EDGE_EPS) return null
  const s = (e2x * qx + e2y * qy + e2z * qz) * inv
  return Number.isFinite(s) ? { s, triangle: t, b1, b2 } : null
}

function better(hit: TriangleHit | null, best: TriangleHit | null, sMin: number, sMax: number): boolean {
  if (!hit || hit.s < sMin || hit.s > sMax) return false
  return !best || hit.s < best.s || (hit.s === best.s && hit.triangle < best.triangle)
}

// The brute-force reference: every triangle.
export function intersectTriangles(positions: Float64Array, indices: Uint32Array, ray: Ray, sMin: number, sMax: number): TriangleHit | null {
  let best: TriangleHit | null = null
  const triangles = Math.floor(indices.length / 3)
  for (let t = 0; t < triangles; t++) {
    const hit = intersectTriangle(positions, indices, t, ray)
    if (better(hit, best, sMin, sMax)) best = hit
  }
  return best
}

// The slab test: whether the ray meets a node's box within [sMin, sMax].
function slab(bvh: Bvh, node: number, ray: Ray, sMin: number, sMax: number): boolean {
  let lo = sMin
  let hi = sMax
  for (let a = 0; a < 3; a++) {
    const o = ray.origin[a]
    const d = ray.direction[a]
    const min = bvh.bounds[6 * node + a]
    const max = bvh.bounds[6 * node + 3 + a]
    if (d === 0) {
      if (o < min || o > max) return false
      continue
    }
    const t1 = (min - o) / d
    const t2 = (max - o) / d
    lo = Math.max(lo, Math.min(t1, t2))
    hi = Math.min(hi, Math.max(t1, t2))
    // A hair of slack, so a ray grazing a box face still enters it.
    if (lo > hi + 1e-12 * Math.max(1, Math.abs(hi))) return false
  }
  return true
}

export function intersectBvh(bvh: Bvh, positions: Float64Array, indices: Uint32Array, ray: Ray, sMin: number, sMax: number): TriangleHit | null {
  if (bvh.left.length === 0) return null
  let best: TriangleHit | null = null
  const stack = [0]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (!slab(bvh, node, ray, sMin, best ? best.s : sMax)) continue
    if (bvh.left[node] < 0) {
      for (let i = bvh.start[node]; i < bvh.start[node] + bvh.count[node]; i++) {
        const hit = intersectTriangle(positions, indices, bvh.order[i], ray)
        if (better(hit, best, sMin, sMax)) best = hit
      }
    } else {
      stack.push(bvh.right[node], bvh.left[node])
    }
  }
  return best
}
