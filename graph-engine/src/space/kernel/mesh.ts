// Turns a sampled grid into a MeshMark's arrays (K10, SP2):
// - a vertex with a non-finite coordinate removes every triangle touching it
//   (an honest hole; no zero is invented);
// - a degenerate triangle (collapsed where inner bounds meet, or at a pole)
//   is dropped;
// - S6 plan V8: a triangle that survives the hole cut but shares an edge with
//   one the cut removed — so it sits on the hole's boundary — is also
//   dropped when it is a sliver in parameter (u, v) space: its smallest
//   angle under 3 degrees, or its area under 1e-4 of the mesh's typical
//   (median) triangle area there. A hole rarely lands exactly on a grid
//   line, so the last sliver of a cut cell is otherwise a needle;
//   (u, v) is the domain's own space, so this does not depend on how a
//   parametric surface curves in world space (kernel/parametric.test.ts,
//   kernel/geometry/implicit.test.ts). A triangle away from any hole is
//   never touched by this rule, degenerate-at-a-pole ones included.
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

// V8: the smallest angle (degrees) and the area of triangle (a, b, c) in
// (u, v) space, from their uv coordinates.
function uvShape(uv: Float64Array, a: number, b: number, c: number): { minAngleDeg: number; area: number } {
  const ax = uv[2 * a]
  const ay = uv[2 * a + 1]
  const bx = uv[2 * b]
  const by = uv[2 * b + 1]
  const cx = uv[2 * c]
  const cy = uv[2 * c + 1]
  const angleAt = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy
    const cross = ux * vy - uy * vx
    return (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI
  }
  const angleA = angleAt(bx - ax, by - ay, cx - ax, cy - ay)
  const angleB = angleAt(ax - bx, ay - by, cx - bx, cy - by)
  const angleC = 180 - angleA - angleB
  const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2
  return { minAngleDeg: Math.min(angleA, angleB, angleC), area }
}

// A stable, order-independent key for the undirected edge (u, v). Vertex
// counts here are well under 2^20 (resolution budgets cap far lower).
function edgeKey(u: number, v: number): number {
  return u < v ? u * 2 ** 20 + v : v * 2 ** 20 + u
}

const SLIVER_MIN_ANGLE_DEG = 3
const SLIVER_MAX_AREA_REL = 1e-4

// `parameterized`: false for a mesh whose uv is a placeholder, not a real
// (u, v) domain (geometry/implicit.ts's marching-tetrahedra surfaces have no
// 2D parameterization) — V8's sliver check needs a real one, so it is
// skipped there; every other caller samples a genuine rectangular domain and
// leaves this at its default.
export function finishMesh(raw: RawMesh, orientUp: boolean, parameterized = true): FinishedMesh {
  const { positions, normals, uv } = raw
  const n = positions.length / 3
  const valid = new Uint8Array(n)
  for (let v = 0; v < n; v++) {
    valid[v] = Number.isFinite(positions[3 * v]) && Number.isFinite(positions[3 * v + 1]) && Number.isFinite(positions[3 * v + 2]) ? 1 : 0
  }

  // Pass 1: the hole cut and the existing (world-space) degenerate check.
  // Survivors are candidates for V8's sliver check below; a hole-cut
  // triangle's edges mark the hole's boundary, so V8 knows which survivors
  // sit on it.
  const candidates = new Uint32Array(raw.indices.length)
  let cn = 0
  const holeEdges = new Set<number>()
  const limit = DEGENERATE_REL * DEGENERATE_REL
  for (let t = 0; t < raw.indices.length; t += 3) {
    const a = raw.indices[t]
    let b = raw.indices[t + 1]
    let c = raw.indices[t + 2]
    if (!valid[a] || !valid[b] || !valid[c]) {
      holeEdges.add(edgeKey(a, b))
      holeEdges.add(edgeKey(b, c))
      holeEdges.add(edgeKey(c, a))
      continue
    }
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

  // Pass 2 (V8): drop a candidate sitting on the hole's boundary when it is
  // a parameter-space sliver. "A cell's" area is the mesh's own median
  // triangle area there — self-contained, so finishMesh needs no grid
  // resolution passed in — computed from the candidates once, before this
  // pass can remove any of them. Skipped entirely when uv is not a real
  // parameterization (parameterized = false): the mesh still keeps every
  // hole-cut candidate as before.
  let areaFloor = 0
  if (parameterized) {
    const areas = new Float64Array(cn / 3)
    for (let i = 0, t = 0; t < cn; i++, t += 3) areas[i] = uvShape(uv, candidates[t], candidates[t + 1], candidates[t + 2]).area
    const sorted = areas.slice().sort()
    const medianArea = sorted.length > 0 ? sorted[sorted.length >> 1] : 0
    areaFloor = SLIVER_MAX_AREA_REL * medianArea
  }

  const kept = new Uint32Array(cn)
  let k = 0
  for (let t = 0; t < cn; t += 3) {
    const a = candidates[t]
    const b = candidates[t + 1]
    const c = candidates[t + 2]
    if (parameterized) {
      const onHole = holeEdges.has(edgeKey(a, b)) || holeEdges.has(edgeKey(b, c)) || holeEdges.has(edgeKey(c, a))
      if (onHole) {
        const shape = uvShape(uv, a, b, c)
        if (shape.minAngleDeg < SLIVER_MIN_ANGLE_DEG || shape.area < areaFloor) continue
      }
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
