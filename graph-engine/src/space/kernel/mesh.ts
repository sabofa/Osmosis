// Turns a sampled grid into a MeshMark's arrays (K10, SP2):
// - a vertex with a non-finite coordinate removes every triangle touching it
//   (an honest hole; no zero is invented);
// - a degenerate triangle (collapsed where inner bounds meet, or at a pole)
//   is dropped;
// - S6 plan V8: a triangle that survives the hole cut but shares an edge with
//   one the cut removed — so it sits on the hole's boundary — is also
//   dropped when it is a sliver: its smallest angle under 3 degrees, or its
//   area under 1e-4 of the mesh's typical (median) triangle area there. A
//   hole rarely lands exactly on a grid line, so the last sliver of a cut
//   cell is otherwise a needle. S6 fix round 3: measured in grid-index
//   (i, j) space (rowWidthOf), not parameter (u, v) — (i, j) is a uniform
//   integer lattice by construction, so this does not depend on how a
//   domain curves in (u, v) or world space either (a polar or "type I"
//   region can put a tiny cross-term into what looks like one (u, v) axis's
//   pure step, which an earlier, (u, v)-based version of this normalised
//   by was liable to inflate 77x or more). A triangle away from any hole is
//   never touched by this rule, degenerate-at-a-pole ones included.
// - on a graph z = f, every triangle is wound counter-clockwise seen from
//   above, the side its analytic normal points to;
// - normals are normalised, with the face fallback where the analytic one is
//   missing (normals.ts);
// - vertices no triangle uses are compacted away, keeping their order.

import { DEGENERATE_REL } from '../../math/tolerance'
import { fallbackNormals, normalizeAt } from './normals'

// For tests: how many times finishMesh's pass 2 (the hole/sliver filter,
// past its own early return) actually ran its body, not just whether the
// early return's early-return-value happens to match. mesh.test.ts's "no
// hole" test reads this, not just finishMesh's output — see the S6 fix
// round 2, item 5b comment at the early return, below.
export const pass2Runs = { count: 0 }

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

// S6 fix round 3: the smallest angle (degrees) and the area of a triangle
// from any (x, y) coordinate pair per vertex — grid-index (i, j) integers
// when rowWidthOf below can find them, raw (u, v) otherwise. No su/sv scale
// factor: round 1 and round 2 each tried to normalise raw (u, v) units by
// an estimated grid step (a global median of every candidate's edges, then
// a single first-cell sample) so a nice square cell would not be misread as
// a sliver just because the domain's own u and v spans differ — both
// estimates read genuine (u, v) deltas, which is exactly where a domain
// that is not a plain rectangle (polar; a "type I" region whose y-span
// closes to nothing at one x) puts a tiny cross-term into what looks like
// one axis's pure step, inflating its scale 77x or more and dropping good
// triangles at the hole's edge. Grid-index space sidesteps this rather than
// estimating it away: (i, j) is a uniform integer lattice by construction,
// so its own shape never depends on how the domain curves.
function triangleArea(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2
}

function triangleShape(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): { minAngleDeg: number; area: number } {
  const angleAt = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy
    const cross = ux * vy - uy * vx
    return (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI
  }
  const angleA = angleAt(bx - ax, by - ay, cx - ax, cy - ay)
  const angleB = angleAt(ax - bx, ay - by, cx - bx, cy - by)
  const angleC = 180 - angleA - angleB
  return { minAngleDeg: Math.min(angleA, angleB, angleC), area: triangleArea(ax, ay, bx, by, cx, cy) }
}

// S6 fix round 3: the grid's row width (i's own span, resU + 1), read from
// raw.indices' own topology — pure integer arithmetic on vertex indices,
// never uv or position, so no cross-term can ever enter it. Every
// parameterized caller here meshes a grid via gridIndices' one convention
// (domain.ts's rectSamples/iteratedSamples share it too): cell (i, j)'s two
// triangles are [a, b, c] and [a, c, d] with a = j*rowWidth+i, b = a+1
// (the pure i-neighbour), d = a+rowWidth (the pure j-neighbour), c = d+1
// (the diagonal) — or the same with b and c swapped, reversedWinding's
// [a, c, b, a, d, c]. `a` is whichever vertex both triangles share
// (indices[0] and [3] agree); among the other four slots, the one
// appearing twice is the diagonal, and of the two singles, whichever
// equals a + 1 is b — the other is d, giving rowWidth = d - a directly.
// A mesh whose first two triangles do not fit this shape at all (a
// hand-built fixture, not a real gridIndices() grid; an inequality
// region's own re-triangulated boundary cells) returns null, and its
// candidates measure in raw (u, v) units instead — the filter's original
// form, before any grid-step normalisation existed.
function rowWidthOf(indices: Uint32Array): number | null {
  if (indices.length < 6) return null
  const a = indices[0]
  if (indices[3] !== a) return null
  const others = [indices[1], indices[2], indices[4], indices[5]]
  const counts = new Map<number, number>()
  for (const v of others) counts.set(v, (counts.get(v) ?? 0) + 1)
  let diagonal: number | null = null
  const singles: number[] = []
  for (const [v, count] of counts) {
    if (count === 2) diagonal = v
    else if (count === 1) singles.push(v)
  }
  if (diagonal === null || singles.length !== 2) return null
  const b = singles[0] === a + 1 ? singles[0] : singles[1] === a + 1 ? singles[1] : null
  if (b === null) return null
  const d = singles[0] === b ? singles[1] : singles[0]
  return d > a ? d - a : null
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

  // Pass 2 (V8; S6 fix round 1 I4). Drop a candidate sitting on the hole's
  // boundary when it is a parameter-space sliver. I4's cost fix: a mesh with
  // no hole at all (the overwhelming common case) has nothing for this pass
  // to do, so it returns the candidates unchanged rather than paying for a
  // median, a per-triangle Set lookup and a trig call on every one of them.
  // Skipped the same way when uv is not a real parameterization
  // (parameterized = false): the mesh keeps every hole-cut candidate as is.
  if (!parameterized || holeEdges.size === 0) {
    const indices = cn === candidates.length ? candidates : candidates.slice(0, cn)
    return compact(positions, normals, uv, indices, n)
  }
  // S6 fix round 2, item 5b: when holeEdges really is empty, pass 2's own
  // body below is a mathematical no-op regardless (onHole can never be
  // true with nothing in holeEdges to match), so a test comparing outputs
  // alone cannot tell "the early return fired" from "the filter ran and
  // dropped nothing" — it would pass either way, even with the early
  // return deleted. This counts every trip past it, for that test to read.
  pass2Runs.count++

  // S6 fix round 3: rowWidthOf, above, turns each vertex's flat index into
  // its own (i, j) — pure topology, computed once. `hasGrid`/`rw` fall back
  // to raw (u, v) when the topology does not fit (rowWidth null): the
  // filter's original, pre-normalisation form (mesh.base.ts) for whatever
  // does not look like a real parameterized grid. A flag and a plain
  // number, inlined at each read below, not a pair of closures: this is
  // read up to six times per candidate (three vertices, x and y each), for
  // every triangle in the mesh, so a direct branch beats a function-call
  // indirection whose target varies per finishMesh call and so cannot be
  // inlined the way a fixed one could.
  const rowWidth = rowWidthOf(raw.indices)
  const hasGrid = rowWidth !== null
  const rw = rowWidth ?? 1

  // The median from area alone — triangleArea(), not the full
  // triangleShape() (whose angle needs atan2 per edge) — for every
  // candidate; triangleShape itself runs only below, for the ones actually
  // on the hole's boundary.
  const areas = new Float64Array(cn / 3)
  for (let i = 0, t = 0; t < cn; i++, t += 3) {
    const a = candidates[t]
    const b = candidates[t + 1]
    const c = candidates[t + 2]
    const ax = hasGrid ? a % rw : uv[2 * a]
    const ay = hasGrid ? Math.floor(a / rw) : uv[2 * a + 1]
    const bx = hasGrid ? b % rw : uv[2 * b]
    const by = hasGrid ? Math.floor(b / rw) : uv[2 * b + 1]
    const cx = hasGrid ? c % rw : uv[2 * c]
    const cy = hasGrid ? Math.floor(c / rw) : uv[2 * c + 1]
    areas[i] = triangleArea(ax, ay, bx, by, cx, cy)
  }
  const sorted = areas.slice().sort()
  const medianArea = sorted.length > 0 ? sorted[sorted.length >> 1] : 0
  const areaFloor = SLIVER_MAX_AREA_REL * medianArea

  const kept = new Uint32Array(cn)
  let k = 0
  for (let t = 0; t < cn; t += 3) {
    const a = candidates[t]
    const b = candidates[t + 1]
    const c = candidates[t + 2]
    const onHole = holeEdges.has(edgeKey(a, b)) || holeEdges.has(edgeKey(b, c)) || holeEdges.has(edgeKey(c, a))
    if (onHole) {
      const ax = hasGrid ? a % rw : uv[2 * a]
      const ay = hasGrid ? Math.floor(a / rw) : uv[2 * a + 1]
      const bx = hasGrid ? b % rw : uv[2 * b]
      const by = hasGrid ? Math.floor(b / rw) : uv[2 * b + 1]
      const cx = hasGrid ? c % rw : uv[2 * c]
      const cy = hasGrid ? Math.floor(c / rw) : uv[2 * c + 1]
      const shape = triangleShape(ax, ay, bx, by, cx, cy)
      if (shape.minAngleDeg < SLIVER_MIN_ANGLE_DEG || shape.area < areaFloor) continue
    }
    kept[k++] = a
    kept[k++] = b
    kept[k++] = c
  }
  const indices = k === kept.length ? kept : kept.slice(0, k)
  return compact(positions, normals, uv, indices, n)
}

// The tail shared by every path through finishMesh, whatever pass 2 did (or
// skipped, I4): fill in a missing normal at a surviving vertex, then compact
// away any vertex no kept triangle uses.
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
