// Turns a sampled grid into a MeshMark's arrays (K10, SP2):
// - a vertex with a non-finite coordinate removes every triangle touching it
//   (an honest hole; no zero is invented);
// - a degenerate triangle (collapsed where inner bounds meet, or at a pole)
//   is dropped;
// - on a graph z = f, every triangle is wound counter-clockwise seen from
//   above, the side its analytic normal points to;
// - normals are normalised, with the face fallback where the analytic one is
//   missing (normals.ts);
// - vertices no triangle uses are compacted away, keeping their order.

import { DEGENERATE_REL } from '../../math/tolerance'
import { fallbackNormals, normalizeAt } from './normals'

export interface RawMesh {
  positions: Float64Array
  // analytic, unnormalised; NaN or zero where undefined
  normals: Float64Array
  uv: Float64Array
  indices: Uint32Array
}

export interface FinishedMesh {
  positions: Float64Array
  normals: Float64Array
  uv: Float64Array
  indices: Uint32Array
}

// Two triangles per grid cell, (i, j) -> j * (n + 1) + i with i fastest:
// [a, b, c] and [a, c, d], counter-clockwise in (i, j). Read-only once made,
// so one array per resolution is shared.
const GRIDS = new Map<number, Uint32Array>()

export function gridIndices(n: number): Uint32Array {
  const cached = GRIDS.get(n)
  if (cached) return cached
  const indices = new Uint32Array(6 * n * n)
  let k = 0
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i
      const b = a + 1
      const d = a + n + 1
      const c = d + 1
      indices[k++] = a
      indices[k++] = b
      indices[k++] = c
      indices[k++] = a
      indices[k++] = c
      indices[k++] = d
    }
  }
  GRIDS.set(n, indices)
  return indices
}

export function finishMesh(raw: RawMesh, orientUp: boolean): FinishedMesh {
  const { positions, normals, uv } = raw
  const n = positions.length / 3
  const valid = new Uint8Array(n)
  for (let v = 0; v < n; v++) {
    valid[v] = Number.isFinite(positions[3 * v]) && Number.isFinite(positions[3 * v + 1]) && Number.isFinite(positions[3 * v + 2]) ? 1 : 0
  }

  const kept = new Uint32Array(raw.indices.length)
  let k = 0
  const limit = DEGENERATE_REL * DEGENERATE_REL
  for (let t = 0; t < raw.indices.length; t += 3) {
    const a = raw.indices[t]
    let b = raw.indices[t + 1]
    let c = raw.indices[t + 2]
    if (!valid[a] || !valid[b] || !valid[c]) continue
    const e1x = positions[3 * b] - positions[3 * a]
    const e1y = positions[3 * b + 1] - positions[3 * a + 1]
    const e1z = positions[3 * b + 2] - positions[3 * a + 2]
    const e2x = positions[3 * c] - positions[3 * a]
    const e2y = positions[3 * c + 1] - positions[3 * a + 1]
    const e2z = positions[3 * c + 2] - positions[3 * a + 2]
    const cx = e1y * e2z - e1z * e2y
    const cy = e1z * e2x - e1x * e2z
    const cz = e1x * e2y - e1y * e2x
    const e3x = e2x - e1x
    const e3y = e2y - e1y
    const e3z = e2z - e1z
    const longest = Math.max(e1x * e1x + e1y * e1y + e1z * e1z, e2x * e2x + e2y * e2y + e2z * e2z, e3x * e3x + e3y * e3y + e3z * e3z)
    // |cross| <= DEGENERATE_REL * longest^2, squared
    if (cx * cx + cy * cy + cz * cz <= limit * longest * longest) continue
    if (orientUp && cz < 0) {
      const swap = b
      b = c
      c = swap
    }
    kept[k++] = a
    kept[k++] = b
    kept[k++] = c
  }
  const indices = k === kept.length ? kept : kept.slice(0, k)

  const used = new Uint8Array(n)
  for (let i = 0; i < indices.length; i++) used[indices[i]] = 1
  const needy: number[] = []
  for (let v = 0; v < n; v++) if (used[v] && !normalizeAt(normals, v)) needy.push(v)
  fallbackNormals(positions, normals, indices, needy)

  let count = 0
  for (let v = 0; v < n; v++) count += used[v]
  if (count === n) return { positions, normals, uv, indices }

  const remap = new Uint32Array(n)
  const p = new Float64Array(3 * count)
  const nn = new Float64Array(3 * count)
  const q = new Float64Array(2 * count)
  let w = 0
  for (let v = 0; v < n; v++) {
    if (!used[v]) continue
    remap[v] = w
    p[3 * w] = positions[3 * v]
    p[3 * w + 1] = positions[3 * v + 1]
    p[3 * w + 2] = positions[3 * v + 2]
    nn[3 * w] = normals[3 * v]
    nn[3 * w + 1] = normals[3 * v + 1]
    nn[3 * w + 2] = normals[3 * v + 2]
    q[2 * w] = uv[2 * v]
    q[2 * w + 1] = uv[2 * v + 1]
    w++
  }
  for (let i = 0; i < indices.length; i++) indices[i] = remap[indices[i]]
  return { positions: p, normals: nn, uv: q, indices }
}
