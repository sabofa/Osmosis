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
//
// S6 fix round 4: plan V8 (a triangle on the hole's boundary also dropped
// when it read as a sliver — small angle or area — in whatever coordinates
// the pass had) is withdrawn. Three rounds each corrected a different way
// of measuring that "sliver": round 1 (I4) normalised raw (u, v) units by a
// sampled-and-sorted median grid step; round 2 (NB4) replaced that with one
// first-cell (u, v) delta for speed; round 3 replaced (u, v) with
// grid-index (i, j) integers read off the mesh's own topology, so no
// domain curvature could ever be read as a false skew. Round 4's re-review
// found grid-index measurement itself unsound on an inequality-clipped
// mesh (its re-triangulated boundary cells do not carry the topology the
// row-width reader assumed, misreading it as an enormous row width that
// collapsed every hole-edge triangle onto one row — "every triangle
// becomes collinear and is dropped") and, more fundamentally, that no
// coordinate system needed measuring at all: every candidate a
// rectangular or iterated grid ever hands this pass is one of gridIndices'
// own two canonical cell triangles, always exactly 45/45/90 in grid-index
// terms — there pass 2 could only ever misfire, never actually catch a
// real sliver. That does not hold for an inequality-clipped cell
// (`over ...`), which is re-triangulated and is not one of those two
// canonical shapes: there V8's original filter did drop one real, genuine
// clipped triangle, not only slivers (549 triangles fell to 548 under
// it) — at a real per-mesh cost too (~3.7 ms at 128^2 with a hole).
// Dropping a genuinely clipped boundary triangle also opens a gap in the
// surface, which no "sliver" reading is worth. The one artefact this
// filter ever addressed — "Limits along two paths" at the origin — is
// shading near a removed vertex (parked for track 5), not a needle this
// pass was catching.

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
// so an array is shared per resolution: the few most recently used are kept
// (a Map iterates in insertion order, so re-inserting on use makes it an LRU).
const GRIDS = new Map<number, Uint32Array>()
const GRIDS_KEPT = 4

export function gridIndices(n: number): Uint32Array {
  const cached = GRIDS.get(n)
  if (cached) {
    GRIDS.delete(n)
    GRIDS.set(n, cached)
    return cached
  }
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
  if (GRIDS.size > GRIDS_KEPT) GRIDS.delete(GRIDS.keys().next().value!)
  return indices
}

// The same triangles wound the other way (a copy; the grid is shared).
export function reversedWinding(indices: Uint32Array): Uint32Array {
  const out = indices.slice()
  for (let t = 0; t < out.length; t += 3) {
    out[t + 1] = indices[t + 2]
    out[t + 2] = indices[t + 1]
  }
  return out
}

export function finishMesh(raw: RawMesh, orientUp: boolean): FinishedMesh {
  const { positions, normals, uv } = raw
  const n = positions.length / 3
  const valid = new Uint8Array(n)
  for (let v = 0; v < n; v++) {
    valid[v] = Number.isFinite(positions[3 * v]) && Number.isFinite(positions[3 * v + 1]) && Number.isFinite(positions[3 * v + 2]) ? 1 : 0
  }

  // The hole cut (an invalid vertex removes every triangle touching it) and
  // the degenerate check (collapsed where inner bounds meet, or at a pole).
  // S6 fix round 4: this used to also record which edges the hole cut
  // exposed, for a second pass (V8) that dropped a further triangle on that
  // boundary when it read as a sliver — withdrawn (see the file header);
  // nothing downstream of this loop reads that bookkeeping any more.
  const candidates = new Uint32Array(raw.indices.length)
  let cn = 0
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
    candidates[cn++] = a
    candidates[cn++] = b
    candidates[cn++] = c
  }
  const indices = cn === candidates.length ? candidates : candidates.slice(0, cn)
  return compact(positions, normals, uv, indices, n)
}

// The tail shared by every finishMesh call: fill in a missing normal at a
// surviving vertex, then compact away any vertex no kept triangle uses.
function compact(positions: Float64Array, normals: Float64Array, uv: Float64Array, indices: Uint32Array, n: number): FinishedMesh {
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
