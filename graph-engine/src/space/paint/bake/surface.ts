// The refined surface of one mesh mark (the baked painting, spec §14; plan Task 1).
//
// The bake paints the mesh itself, not a screen: its value plan, its underpainting and its shadow all live on a
// triangle mesh that is FINER than the scene's where the plan needs it (a cast shadow's edge on a table of two
// triangles, the terminator band on a coarse sphere). Refining never moves the surface: every new vertex is the
// midpoint of an edge, so the refined triangles lie exactly on the source triangles, and a point of the source
// (a particle) is found again on the refined mesh with no error beyond rounding.
//
//   REFINEMENT is longest-edge bisection (Rivara's LEPP): a triangle is split on its longest edge, but first its
//   neighbour across that edge is made to agree that this is ITS longest edge too, else the neighbour's longer edge
//   is split first. The result is conforming (every split edge is split in every triangle that has it: no
//   T-junctions) and keeps the triangles well shaped (a right-angle grid bisects into right-angle triangles).
//
//   CONFORMING ACROSS SEAMS. A parametric mesh repeats a vertex where its parameter wraps (a sphere's seam) and at a
//   pole. Topology is therefore kept on CANONICAL vertices (positions merged within CANON_EPS of the bounding-box
//   diagonal, as contours.ts canonOf does): an edge is the pair of its canonical ends, so the two sides of a seam are
//   one edge, refine together, and a mesh whose only borders are seams and poles is `closed`. A triangle with two
//   canonical-equal vertices (the fan at a pole) has no area and is dropped.
//
//   ATTRIBUTES are linear in the midpoint: position, normal, scalar. The unit normal a consumer reads is the linear
//   interpolant of the SOURCE vertex normals renormalised (the particles' own rule, particles.ts interpolatedNormal);
//   the refined vertex keeps the un-renormalised interpolant (`rawNormals`) so that refining again stays exactly
//   linear in the source triangle however deep it goes. Where the source normal is undefined (zero) the face
//   normal stands in.
//
// A BUDGET (maxTriangles) bounds the work: the surface is refined in levels (every edge at most a factor of √2
// shorter than the last), and a level that would pass the budget is not taken: the surface stays at the coarser
// level and says so (`budgetHit`).

import type { MeshMark } from '../../scene/types'
import { buildBvh, type Bvh } from '../../pick/bvh'

// Vertices closer than this fraction of the bounding-box diagonal are one canonical vertex.
export const CANON_EPS = 1e-5
// Edge keys are (low canonical id) × 2^26 + (high): exact in a double up to 2^26 canonical vertices.
const EDGE_RADIX = 67_108_864

export interface RefinedSurface {
  mark: number
  positions: Float64Array // 3 per vertex, world, exactly on the source mesh's triangles
  normals: Float64Array // 3 per vertex, unit (linear interpolation of the source vertex normals, renormalised; face normal where the source normal is zero)
  scalars: Float64Array | null // per vertex, linear (colormap)
  indices: Uint32Array
  canon: Uint32Array // canonical vertex id per vertex (coincident positions merged at 1e-5 of the bbox diagonal, as contours.ts canonOf)
  adj: Int32Array // 3 per triangle: the triangle across edge (v0v1, v1v2, v2v0), -1 on a border
  closed: boolean // no border edges
  area: Float64Array // per triangle, world
  // buildBvh over positions and indices. Built on first use (a surface that is only refined further never needs it).
  readonly bvh: Bvh
  // The linear interpolant of the source normals, not renormalised (3 per vertex): what refining again interpolates.
  rawNormals: Float64Array
  // True when the budget stopped the refinement short of what was asked.
  budgetHit: boolean
}

// ---- the working mesh ----

class Work {
  nv = 0
  nt = 0
  nc = 0
  capV: number
  capT: number
  capC: number
  pos: Float64Array
  raw: Float64Array
  scal: Float64Array | null
  canon: Uint32Array
  // The position of each canonical vertex (the first of its vertices): the length of an edge is the distance of its
  // canonical ends, one number for the edge whichever triangle asks.
  cpos: Float64Array
  tv: Int32Array
  adj: Int32Array
  // Per triangle, set when a refineWhere pass has split it (a child inherits it).
  done: Uint8Array
  private readonly chain: number[] = []

  constructor(nv: number, nt: number, nc: number, scalars: boolean) {
    this.capV = Math.max(16, nv)
    this.capT = Math.max(16, nt)
    this.capC = Math.max(16, nc)
    this.pos = new Float64Array(3 * this.capV)
    this.raw = new Float64Array(3 * this.capV)
    this.scal = scalars ? new Float64Array(this.capV) : null
    this.canon = new Uint32Array(this.capV)
    this.cpos = new Float64Array(3 * this.capC)
    this.tv = new Int32Array(3 * this.capT)
    this.adj = new Int32Array(3 * this.capT)
    this.done = new Uint8Array(this.capT)
  }

  // Room for `v` more vertices, `t` more triangles and `c` more canonical vertices.
  ensure(v: number, t: number, c: number): void {
    if (this.nv + v > this.capV) {
      this.capV = Math.max(2 * this.capV, this.nv + v)
      this.pos = grow(this.pos, 3 * this.capV)
      this.raw = grow(this.raw, 3 * this.capV)
      if (this.scal) this.scal = grow(this.scal, this.capV)
      this.canon = grow(this.canon, this.capV)
    }
    if (this.nt + t > this.capT) {
      this.capT = Math.max(2 * this.capT, this.nt + t)
      this.tv = grow(this.tv, 3 * this.capT)
      this.adj = grow(this.adj, 3 * this.capT)
      this.done = grow(this.done, this.capT)
    }
    if (this.nc + c > this.capC) {
      this.capC = Math.max(2 * this.capC, this.nc + c)
      this.cpos = grow(this.cpos, 3 * this.capC)
    }
  }

  // ---- edges ----

  elen(t: number, e: number): number {
    const a = this.canon[this.tv[3 * t + e]]
    const b = this.canon[this.tv[3 * t + (e === 2 ? 0 : e + 1)]]
    const dx = this.cpos[3 * a] - this.cpos[3 * b]
    const dy = this.cpos[3 * a + 1] - this.cpos[3 * b + 1]
    const dz = this.cpos[3 * a + 2] - this.cpos[3 * b + 2]
    return Math.sqrt(dx * dx + dy * dy + dz * dz)
  }

  ekey(t: number, e: number): number {
    const a = this.canon[this.tv[3 * t + e]]
    const b = this.canon[this.tv[3 * t + (e === 2 ? 0 : e + 1)]]
    return a < b ? a * EDGE_RADIX + b : b * EDGE_RADIX + a
  }

  // The local edge of triangle t that is the longest: by length, then by edge key, so that every triangle sharing an edge ranks it alike.
  longest(t: number): number {
    let best = 0
    let bl = this.elen(t, 0)
    let bk = this.ekey(t, 0)
    for (let e = 1; e < 3; e++) {
      const l = this.elen(t, e)
      if (l > bl || (l === bl && this.ekey(t, e) > bk)) {
        best = e
        bl = l
        bk = this.ekey(t, e)
      }
    }
    return best
  }

  longestLen(t: number): number {
    return this.elen(t, this.longest(t))
  }

  maxLen(): number {
    let m = 0
    for (let t = 0; t < this.nt; t++) m = Math.max(m, this.longestLen(t))
    return m
  }

  // The local edge of triangle u between canonical vertices ca and cb, or -1.
  edgeOf(u: number, ca: number, cb: number): number {
    for (let e = 0; e < 3; e++) {
      const x = this.canon[this.tv[3 * u + e]]
      const y = this.canon[this.tv[3 * u + (e === 2 ? 0 : e + 1)]]
      if ((x === ca && y === cb) || (x === cb && y === ca)) return e
    }
    return -1
  }

  // Triangle w's slot that pointed at `from` across the edge (ca, cb) points at `to`.
  relink(w: number, from: number, to: number, ca: number, cb: number): void {
    for (let s = 0; s < 3; s++) {
      if (this.adj[3 * w + s] !== from) continue
      const x = this.canon[this.tv[3 * w + s]]
      const y = this.canon[this.tv[3 * w + (s === 2 ? 0 : s + 1)]]
      if ((x === ca && y === cb) || (x === cb && y === ca)) {
        this.adj[3 * w + s] = to
        return
      }
    }
  }

  // ---- vertices ----

  // A vertex at the middle of a and b, in the canonical vertex `canonId` (a new one when negative).
  midVertex(a: number, b: number, canonId: number): number {
    const m = this.nv++
    for (let k = 0; k < 3; k++) {
      this.pos[3 * m + k] = 0.5 * (this.pos[3 * a + k] + this.pos[3 * b + k])
      this.raw[3 * m + k] = 0.5 * (this.raw[3 * a + k] + this.raw[3 * b + k])
    }
    if (this.scal) this.scal[m] = 0.5 * (this.scal[a] + this.scal[b])
    if (canonId < 0) {
      canonId = this.nc++
      for (let k = 0; k < 3; k++) this.cpos[3 * canonId + k] = this.pos[3 * m + k]
    }
    this.canon[m] = canonId
    return m
  }

  // ---- bisection ----

  // Split the edge e of triangle c, and across it the neighbour's, at their middle: each becomes two triangles (c keeps
  // its id for the first, the second is new). Every adjacency is kept; the caller has made room.
  splitEdge(c: number, e: number): void {
    const tv = this.tv
    const adj = this.adj
    const u = adj[3 * c + e]
    const e1 = e === 2 ? 0 : e + 1
    const e2 = e1 === 2 ? 0 : e1 + 1
    const a = tv[3 * c + e]
    const b = tv[3 * c + e1]
    const k = tv[3 * c + e2]
    const w1 = adj[3 * c + e1] // across (b, k)
    const w2 = adj[3 * c + e2] // across (k, a)
    const ca = this.canon[a]
    const cb = this.canon[b]
    const m = this.midVertex(a, b, -1)
    const c2 = this.nt++
    tv[3 * c] = a; tv[3 * c + 1] = m; tv[3 * c + 2] = k
    adj[3 * c + 1] = c2; adj[3 * c + 2] = w2
    tv[3 * c2] = m; tv[3 * c2 + 1] = b; tv[3 * c2 + 2] = k
    adj[3 * c2 + 1] = w1; adj[3 * c2 + 2] = c
    if (w1 >= 0) this.relink(w1, c, c2, this.canon[b], this.canon[k])
    this.done[c] = 1
    this.done[c2] = 1
    if (u < 0) {
      adj[3 * c] = -1
      adj[3 * c2] = -1
      return
    }
    const eu = this.edgeOf(u, ca, cb)
    const f1 = eu === 2 ? 0 : eu + 1
    const f2 = f1 === 2 ? 0 : f1 + 1
    const p = tv[3 * u + eu]
    const q = tv[3 * u + f1]
    const r = tv[3 * u + f2]
    const x1 = adj[3 * u + f1] // across (q, r)
    const x2 = adj[3 * u + f2] // across (r, p)
    // the neighbour shares the midpoint where it shares the edge's own vertices (it does not across a seam)
    const mu = (p === a && q === b) || (p === b && q === a) ? m : this.midVertex(p, q, this.canon[m])
    const u2 = this.nt++
    tv[3 * u] = p; tv[3 * u + 1] = mu; tv[3 * u + 2] = r
    adj[3 * u + 1] = u2; adj[3 * u + 2] = x2
    tv[3 * u2] = mu; tv[3 * u2 + 1] = q; tv[3 * u2 + 2] = r
    adj[3 * u2 + 1] = x1; adj[3 * u2 + 2] = u
    if (x1 >= 0) this.relink(x1, u, u2, this.canon[q], this.canon[r])
    this.done[u] = 1
    this.done[u2] = 1
    // across the split edge: the child of c at canonical a (c) meets the child of u at canonical a
    if (this.canon[p] === ca) {
      adj[3 * u] = c; adj[3 * c] = u
      adj[3 * u2] = c2; adj[3 * c2] = u2
    } else {
      adj[3 * u] = c2; adj[3 * c2] = u
      adj[3 * u2] = c; adj[3 * c] = u2
    }
  }

  // One step of the longest-edge propagation path from triangle t: walk to the neighbour that has a longer edge until two
  // triangles agree on a shared longest edge, and split it. False when the budget has no room for the split.
  lepp(t: number, maxTriangles: number): boolean {
    const chain = this.chain
    chain.length = 0
    chain.push(t)
    for (;;) {
      const c = chain[chain.length - 1]
      const e = this.longest(c)
      const u = this.adj[3 * c + e]
      let terminal = u < 0
      if (!terminal) {
        const eu = this.edgeOf(u, this.canon[this.tv[3 * c + e]], this.canon[this.tv[3 * c + (e === 2 ? 0 : e + 1)]])
        terminal = eu < 0 || this.longest(u) === eu || chain.length > 4096
      }
      if (terminal) {
        if (this.nt + (u < 0 ? 1 : 2) > maxTriangles) return false
        this.ensure(2, 2, 1)
        this.splitEdge(c, e)
        return true
      }
      chain.push(u)
    }
  }

  // Every triangle's longest edge at most `target`.
  refineTo(target: number, maxTriangles: number): boolean {
    for (let sweep = 0; sweep < 256; sweep++) {
      let changed = false
      for (let t = 0; t < this.nt; t++) {
        while (this.longestLen(t) > target) {
          if (!this.lepp(t, maxTriangles)) return false
          changed = true
        }
      }
      if (!changed) return true
    }
    return true
  }

  // ---- snapshots (a level that passes the budget is undone) ----

  snapshot(): Snapshot {
    return {
      nv: this.nv, nt: this.nt, nc: this.nc,
      pos: this.pos.slice(0, 3 * this.nv), raw: this.raw.slice(0, 3 * this.nv), scal: this.scal ? this.scal.slice(0, this.nv) : null,
      canon: this.canon.slice(0, this.nv), cpos: this.cpos.slice(0, 3 * this.nc), tv: this.tv.slice(0, 3 * this.nt), adj: this.adj.slice(0, 3 * this.nt),
    }
  }

  restore(s: Snapshot): void {
    this.nv = s.nv
    this.nt = s.nt
    this.nc = s.nc
    this.capV = s.nv
    this.capT = s.nt
    this.capC = s.nc
    this.pos = s.pos
    this.raw = s.raw
    this.scal = s.scal
    this.canon = s.canon
    this.cpos = s.cpos
    this.tv = s.tv
    this.adj = s.adj
    this.done = new Uint8Array(s.nt)
  }

  // ---- out ----

  toSurface(mark: number, closed: boolean, budgetHit: boolean): RefinedSurface {
    const { nv, nt } = this
    const positions = this.pos.slice(0, 3 * nv)
    const rawNormals = this.raw.slice(0, 3 * nv)
    const indices = Uint32Array.from(this.tv.subarray(0, 3 * nt))
    const normals = new Float64Array(3 * nv)
    const missing: number[] = []
    for (let i = 0; i < nv; i++) {
      const l = Math.hypot(rawNormals[3 * i], rawNormals[3 * i + 1], rawNormals[3 * i + 2])
      if (l > 1e-9) {
        normals[3 * i] = rawNormals[3 * i] / l
        normals[3 * i + 1] = rawNormals[3 * i + 1] / l
        normals[3 * i + 2] = rawNormals[3 * i + 2] / l
      } else missing.push(i)
    }
    const area = new Float64Array(nt)
    const stand = missing.length > 0 ? new Float64Array(3 * nv) : null
    for (let t = 0; t < nt; t++) {
      const a = 3 * indices[3 * t]
      const b = 3 * indices[3 * t + 1]
      const c = 3 * indices[3 * t + 2]
      const e1x = positions[b] - positions[a]
      const e1y = positions[b + 1] - positions[a + 1]
      const e1z = positions[b + 2] - positions[a + 2]
      const e2x = positions[c] - positions[a]
      const e2y = positions[c + 1] - positions[a + 1]
      const e2z = positions[c + 2] - positions[a + 2]
      const nx = e1y * e2z - e1z * e2y
      const ny = e1z * e2x - e1x * e2z
      const nz = e1x * e2y - e1y * e2x
      area[t] = 0.5 * Math.hypot(nx, ny, nz)
      if (stand) {
        for (const v of [a, b, c]) {
          stand[v] += nx
          stand[v + 1] += ny
          stand[v + 2] += nz
        }
      }
    }
    if (stand) {
      for (const i of missing) {
        const l = Math.hypot(stand[3 * i], stand[3 * i + 1], stand[3 * i + 2])
        if (l > 0) {
          normals[3 * i] = stand[3 * i] / l
          normals[3 * i + 1] = stand[3 * i + 1] / l
          normals[3 * i + 2] = stand[3 * i + 2] / l
        } else normals[3 * i + 2] = 1
      }
    }
    let bvh: Bvh | null = null
    return {
      mark,
      positions,
      normals,
      scalars: this.scal ? this.scal.slice(0, nv) : null,
      indices,
      canon: this.canon.slice(0, nv),
      adj: this.adj.slice(0, 3 * nt),
      closed,
      area,
      get bvh(): Bvh {
        bvh ??= buildBvh(positions, indices)
        return bvh
      },
      rawNormals,
      budgetHit,
    }
  }
}

interface Snapshot {
  nv: number
  nt: number
  nc: number
  pos: Float64Array
  raw: Float64Array
  scal: Float64Array | null
  canon: Uint32Array
  cpos: Float64Array
  tv: Int32Array
  adj: Int32Array
}

function grow<T extends Float64Array | Int32Array | Uint32Array | Uint8Array>(a: T, length: number): T {
  const out = new (a.constructor as new (n: number) => T)(length)
  out.set(a)
  return out
}

// ---- building the working mesh from a scene mesh ----

function fromMesh(mesh: MeshMark): { work: Work; closed: boolean } {
  const nvSrc = Math.floor(mesh.positions.length / 3)
  const finite = new Uint8Array(nvSrc)
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < nvSrc; i++) {
    const x = mesh.positions[3 * i]
    const y = mesh.positions[3 * i + 1]
    const z = mesh.positions[3 * i + 2]
    if (!Number.isFinite(x + y + z)) continue
    finite[i] = 1
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], mesh.positions[3 * i + k])
      hi[k] = Math.max(hi[k], mesh.positions[3 * i + k])
    }
  }
  const diag = Number.isFinite(lo[0]) ? Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) : 0
  const q = 1 / (CANON_EPS * (diag > 0 ? diag : 1))

  // canonical ids of the source vertices
  const canonSrc = new Uint32Array(nvSrc)
  const seen = new Map<string, number>()
  let nc = 0
  for (let i = 0; i < nvSrc; i++) {
    if (!finite[i]) continue
    const key = `${Math.round(mesh.positions[3 * i] * q)},${Math.round(mesh.positions[3 * i + 1] * q)},${Math.round(mesh.positions[3 * i + 2] * q)}`
    let c = seen.get(key)
    if (c === undefined) {
      c = nc++
      seen.set(key, c)
    }
    canonSrc[i] = c
  }

  // the triangles that have an area: three finite vertices that are three canonical ones
  const keep: number[] = []
  const used = new Uint8Array(nvSrc)
  const ntSrc = Math.floor(mesh.indices.length / 3)
  for (let t = 0; t < ntSrc; t++) {
    const a = mesh.indices[3 * t]
    const b = mesh.indices[3 * t + 1]
    const c = mesh.indices[3 * t + 2]
    if (a >= nvSrc || b >= nvSrc || c >= nvSrc || !finite[a] || !finite[b] || !finite[c]) continue
    if (canonSrc[a] === canonSrc[b] || canonSrc[b] === canonSrc[c] || canonSrc[c] === canonSrc[a]) continue
    keep.push(t)
    used[a] = 1
    used[b] = 1
    used[c] = 1
  }

  // compact the vertices in use, and the canonical ids with them
  const remap = new Int32Array(nvSrc).fill(-1)
  const remapC = new Int32Array(nc).fill(-1)
  let nv = 0
  let ncUsed = 0
  for (let i = 0; i < nvSrc; i++) {
    if (!used[i]) continue
    remap[i] = nv++
    if (remapC[canonSrc[i]] < 0) remapC[canonSrc[i]] = ncUsed++
  }
  const work = new Work(nv, keep.length, ncUsed, mesh.scalars !== null && mesh.scalars.length >= nvSrc)
  work.nv = nv
  work.nt = keep.length
  work.nc = ncUsed
  const haveNormals = Math.floor(mesh.normals.length / 3)
  for (let i = 0; i < nvSrc; i++) {
    const v = remap[i]
    if (v < 0) continue
    for (let k = 0; k < 3; k++) {
      work.pos[3 * v + k] = mesh.positions[3 * i + k]
      work.raw[3 * v + k] = i < haveNormals && Number.isFinite(mesh.normals[3 * i + k]) ? mesh.normals[3 * i + k] : 0
    }
    if (work.scal) work.scal[v] = mesh.scalars![i]
    work.canon[v] = remapC[canonSrc[i]]
  }
  // (a canonical vertex sits at the first of its vertices: set it exactly, in vertex order)
  const first = new Uint8Array(ncUsed)
  for (let v = 0; v < nv; v++) {
    const c = work.canon[v]
    if (first[c]) continue
    first[c] = 1
    for (let k = 0; k < 3; k++) work.cpos[3 * c + k] = work.pos[3 * v + k]
  }
  keep.forEach((t, j) => {
    for (let k = 0; k < 3; k++) work.tv[3 * j + k] = remap[mesh.indices[3 * t + k]]
  })

  const closed = linkTriangles(work)
  return { work, closed }
}

// Fill the adjacency of a working mesh by canonical edges; true when no edge has a single triangle. An edge with three
// or more triangles (a non-manifold fin) joins the first two and leaves the others free.
function linkTriangles(work: Work): boolean {
  const nt = work.nt
  let size = 16
  while (size < 6 * nt) size *= 2
  const mask = size - 1
  const keys = new Float64Array(size).fill(-1)
  const first = new Int32Array(size) // tri * 3 + edge + 1 of the first triangle on the edge (0 = unused)
  const count = new Uint8Array(size)
  work.adj.fill(-1, 0, 3 * nt)
  for (let t = 0; t < nt; t++) {
    for (let e = 0; e < 3; e++) {
      const key = work.ekey(t, e)
      let h = hashKey(key) & mask
      while (keys[h] !== -1 && keys[h] !== key) h = (h + 1) & mask
      if (keys[h] === -1) {
        keys[h] = key
        first[h] = 3 * t + e + 1
        count[h] = 1
        continue
      }
      if (count[h] === 1) {
        const o = first[h] - 1
        work.adj[3 * t + e] = Math.floor(o / 3)
        work.adj[o] = t
      }
      if (count[h] < 255) count[h]++
    }
  }
  for (let h = 0; h < size; h++) if (keys[h] !== -1 && count[h] === 1) return false
  return nt > 0
}

function hashKey(key: number): number {
  const lo = key % EDGE_RADIX
  const hi = Math.floor(key / EDGE_RADIX)
  return (Math.imul(hi, 0x9e3779b1) ^ Math.imul(lo + 0x7f4a7c15, 0x85ebca6b)) >>> 7
}

// A working mesh from a refined surface, to refine it further (the vertices and triangles keep their indices; new ones follow).
function fromSurface(s: RefinedSurface): Work {
  const nv = s.positions.length / 3
  const nt = s.indices.length / 3
  let nc = 0
  for (let i = 0; i < nv; i++) nc = Math.max(nc, s.canon[i] + 1)
  const work = new Work(nv, nt, nc, s.scalars !== null)
  work.nv = nv
  work.nt = nt
  work.nc = nc
  work.pos.set(s.positions)
  work.raw.set(s.rawNormals)
  if (work.scal && s.scalars) work.scal.set(s.scalars)
  work.canon.set(s.canon)
  work.tv.set(s.indices)
  work.adj.set(s.adj)
  const first = new Uint8Array(nc)
  for (let v = 0; v < nv; v++) {
    const c = s.canon[v]
    if (first[c]) continue
    first[c] = 1
    for (let k = 0; k < 3; k++) work.cpos[3 * c + k] = s.positions[3 * v + k]
  }
  return work
}

// ---- the two refinements ----

// The surface of a mesh mark with every edge at most `maxEdge` (world units), by longest-edge bisection, unless that would
// pass `maxTriangles`: then the surface stays at the last level that fit, and `budgetHit` says so. A surface with an
// edge already short enough is returned as it is (cleaned of degenerate triangles, and with its adjacency).
export function refineSurface(mesh: MeshMark, mark: number, maxEdge: number, maxTriangles: number): RefinedSurface {
  const { work, closed } = fromMesh(mesh)
  let budgetHit = false
  if (work.nt > 0 && Number.isFinite(maxEdge) && maxEdge > 0) {
    let target = work.maxLen()
    while (target > maxEdge) {
      target = Math.max(maxEdge, target / Math.SQRT2)
      // a level can roughly double the triangles: take a snapshot only where that could pass the budget
      const risky = work.nt * 2.2 > maxTriangles
      const before = risky ? work.snapshot() : null
      if (!work.refineTo(target, maxTriangles)) {
        if (before) work.restore(before)
        budgetHit = true
        break
      }
    }
  }
  return work.toSurface(mark, closed, budgetHit)
}

// A copy of `s` in which every triangle for which `needs(tri)` holds and whose longest edge is over `minEdge` has been
// bisected once (its neighbours as the conforming mesh asks; the vertices and triangles that were there keep their
// indices, the new ones follow). One pass: the caller recomputes what `needs` reads at the new vertices and asks again.
// Stops where `maxTriangles` would be passed, and says so (`budgetHit`). Returns `s` itself when nothing was split.
export function refineWhere(s: RefinedSurface, needs: (tri: number) => boolean, minEdge: number, maxTriangles: number): RefinedSurface {
  const work = fromSurface(s)
  const marked: number[] = []
  for (let t = 0; t < work.nt; t++) if (needs(t) && work.longestLen(t) > minEdge) marked.push(t)
  if (marked.length === 0) return s
  let budgetHit = s.budgetHit
  for (const t of marked) {
    if (work.done[t]) continue
    while (!work.done[t]) {
      if (!work.lepp(t, maxTriangles)) {
        budgetHit = true
        break
      }
    }
    if (budgetHit && !work.done[t]) break
  }
  if (work.nt === s.indices.length / 3) return s.budgetHit === budgetHit ? s : work.toSurface(s.mark, s.closed, budgetHit)
  return work.toSurface(s.mark, s.closed, budgetHit)
}

// ---- points on a surface ----

export interface SurfacePoint {
  tri: number
  // Barycentric weights of the triangle's second and third vertices (the first's is 1 - b1 - b2), as TriangleHit.
  b1: number
  b2: number
}

const HIT = { b1: 0, b2: 0, d2: 0 }

// The point of triangle (a, b, c) nearest to p, as barycentric weights of b and c, and its squared distance (Ericson, Real-Time
// Collision Detection 5.1.5). Written into `out`.
function closestOnTriangle(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
  out: { b1: number; b2: number; d2: number },
): void {
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const acx = cx - ax, acy = cy - ay, acz = cz - az
  const apx = px - ax, apy = py - ay, apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  let v = 0
  let w = 0
  const bpx = px - bx, bpy = py - by, bpz = pz - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  const vc = d1 * d4 - d3 * d2
  const vb = d5 * d2 - d1 * d6
  const va = d3 * d6 - d5 * d4
  if (d1 <= 0 && d2 <= 0) {
    // the vertex a
  } else if (d3 >= 0 && d4 <= d3) {
    v = 1
  } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    v = d1 / (d1 - d3)
  } else if (d6 >= 0 && d5 <= d6) {
    w = 1
  } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    w = d2 / (d2 - d6)
  } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    v = 1 - w
  } else {
    const den = 1 / (va + vb + vc)
    v = vb * den
    w = vc * den
  }
  const qx = ax + abx * v + acx * w - px
  const qy = ay + aby * v + acy * w - py
  const qz = az + abz * v + acz * w - pz
  out.b1 = v
  out.b2 = w
  out.d2 = qx * qx + qy * qy + qz * qz
}

// The point of the surface that is `p`, found again: the nearest point of any triangle within `reach` of (x, y, z). Where
// several triangles are as near (the point is on an edge or a vertex, or a self-touching sheet passes through it) the one
// whose normal there agrees best with (nx, ny, nz) wins. A particle's point is on the surface to rounding, so this is
// exact for it. False when nothing is within `reach`.
export function locate(s: RefinedSurface, x: number, y: number, z: number, nx: number, ny: number, nz: number, reach: number, out: SurfacePoint): boolean {
  const bvh = s.bvh
  if (bvh.left.length === 0 || !(reach >= 0)) return false
  const b = bvh.bounds
  // distances this close are equal (rounding; the vertex or edge two triangles share)
  const tol = 1e-6 * Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2])
  const pos = s.positions
  const idx = s.indices
  const r = s.rawNormals
  let bestD = Infinity
  let bestCos = -2
  let found = false
  const stack = [0]
  const hit = HIT
  while (stack.length > 0) {
    const node = stack.pop()!
    const dx = Math.max(b[6 * node] - x, 0, x - b[6 * node + 3])
    const dy = Math.max(b[6 * node + 1] - y, 0, y - b[6 * node + 4])
    const dz = Math.max(b[6 * node + 2] - z, 0, z - b[6 * node + 5])
    const lim = Math.min(reach, bestD) + tol
    if (dx * dx + dy * dy + dz * dz > lim * lim) continue
    if (bvh.left[node] >= 0) {
      stack.push(bvh.right[node], bvh.left[node])
      continue
    }
    for (let i = bvh.start[node]; i < bvh.start[node] + bvh.count[node]; i++) {
      const t = bvh.order[i]
      const ia = idx[3 * t]
      const ib = idx[3 * t + 1]
      const ic = idx[3 * t + 2]
      closestOnTriangle(x, y, z, pos[3 * ia], pos[3 * ia + 1], pos[3 * ia + 2], pos[3 * ib], pos[3 * ib + 1], pos[3 * ib + 2], pos[3 * ic], pos[3 * ic + 1], pos[3 * ic + 2], hit)
      const d = Math.sqrt(hit.d2)
      if (d > reach || d > bestD + tol) continue
      // how well the surface's normal there agrees with the one asked for
      const w0 = 1 - hit.b1 - hit.b2
      const gx = w0 * r[3 * ia] + hit.b1 * r[3 * ib] + hit.b2 * r[3 * ic]
      const gy = w0 * r[3 * ia + 1] + hit.b1 * r[3 * ib + 1] + hit.b2 * r[3 * ic + 1]
      const gz = w0 * r[3 * ia + 2] + hit.b1 * r[3 * ib + 2] + hit.b2 * r[3 * ic + 2]
      const gl = Math.hypot(gx, gy, gz)
      const cos = gl > 1e-12 ? (gx * nx + gy * ny + gz * nz) / gl : 0
      if (!found || d < bestD - tol || cos > bestCos + 1e-9) {
        out.tri = t
        out.b1 = hit.b1
        out.b2 = hit.b2
        bestCos = cos
        found = true
      }
      if (d < bestD) bestD = d
    }
  }
  return found
}

// The world position of a surface point.
export function pointOf(s: RefinedSurface, p: SurfacePoint, out: Float64Array | number[]): void {
  const a = 3 * s.indices[3 * p.tri]
  const b = 3 * s.indices[3 * p.tri + 1]
  const c = 3 * s.indices[3 * p.tri + 2]
  const w0 = 1 - p.b1 - p.b2
  for (let k = 0; k < 3; k++) out[k] = w0 * s.positions[a + k] + p.b1 * s.positions[b + k] + p.b2 * s.positions[c + k]
}

// The unit normal of a surface point, for `side` (+1 the normal as the mesh gives it, -1 the opposite): the source
// normals interpolated and renormalised, as the particles' are; the face normal where they cancel.
export function normalOf(s: RefinedSurface, p: SurfacePoint, side: 1 | -1, out: Float64Array | number[]): void {
  const ia = 3 * s.indices[3 * p.tri]
  const ib = 3 * s.indices[3 * p.tri + 1]
  const ic = 3 * s.indices[3 * p.tri + 2]
  const w0 = 1 - p.b1 - p.b2
  const r = s.rawNormals
  let x = w0 * r[ia] + p.b1 * r[ib] + p.b2 * r[ic]
  let y = w0 * r[ia + 1] + p.b1 * r[ib + 1] + p.b2 * r[ic + 1]
  let z = w0 * r[ia + 2] + p.b1 * r[ib + 2] + p.b2 * r[ic + 2]
  let l = Math.hypot(x, y, z)
  if (!(l > 1e-9)) {
    // the vertex normals' own stand-in (a face normal) interpolated, else the face's
    const n = s.normals
    x = w0 * n[ia] + p.b1 * n[ib] + p.b2 * n[ic]
    y = w0 * n[ia + 1] + p.b1 * n[ib + 1] + p.b2 * n[ic + 1]
    z = w0 * n[ia + 2] + p.b1 * n[ib + 2] + p.b2 * n[ic + 2]
    l = Math.hypot(x, y, z)
  }
  if (!(l > 1e-12)) {
    x = 0
    y = 0
    z = 1
    l = 1
  }
  out[0] = (side * x) / l
  out[1] = (side * y) / l
  out[2] = (side * z) / l
}
