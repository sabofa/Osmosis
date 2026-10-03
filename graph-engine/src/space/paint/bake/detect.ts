// Where the strokes that need a WIDE view of the plan go (the baked painting, spec §14; plan Task 3): the scumble mask and the highlight dabs,
// found on the refined surfaces, in the world. The per-frame model finds them in the picture (model/roles.ts scumbleMask, dabStrokes: a
// chamfer distance and a window on the G-buffer); the bake finds them on the surface's own vertex graph, distances measured along it.
//
//   THE SCUMBLE MASK. A vertex of a side is `ok` where the plan's transition is wide and gentle: it is not bare table, the plan's `trans` is
//   over 0.16 (it is inside a zone's boundary), and the value's gradient (the largest of its incident triangles', per CSS px at the reference
//   scale) is under detect.scumbleGradient. A vertex is then masked unless it is at least detect.scumbleMinPx / 2 (× the reference world per
//   px) from every vertex that is not ok, by the graph distance (a multi-source Dijkstra over the canonical vertices, so a seam is no wall), and
//   from the mesh's open border (the model's mask is bad where no mesh is: the outline). A particle is scumbled when the vertex of its triangle
//   nearest to it is ok.
//
//   THE DABS. On a figure's side, a vertex whose value is over 0.8 and that is a strict maximum of `value + 0.01·key` (a hair of N·L breaks the
//   ties of a clipped highlight) over every vertex within detect.dabMinPx (× the reference world per px) of it along the graph is a candidate.
//   The top detect.dabTopFraction of the candidates (at least one) are kept, greedily from the best, at least dabMinPx apart.

import type { PaintParams } from '../params'
import { DAB_MIN_VALUE } from '../model/roles'
import type { SidePlan, WorldPlan } from './plan'
import type { RefinedSurface } from './surface'

// ---- a small binary heap of (distance, node) ----

class Heap {
  size = 0
  private d: Float64Array
  private n: Int32Array
  constructor(cap = 256) {
    this.d = new Float64Array(cap)
    this.n = new Int32Array(cap)
  }
  push(d: number, n: number): void {
    if (this.size === this.d.length) {
      const dd = new Float64Array(2 * this.size)
      const nn = new Int32Array(2 * this.size)
      dd.set(this.d)
      nn.set(this.n)
      this.d = dd
      this.n = nn
    }
    let i = this.size++
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.d[p] <= d) break
      this.d[i] = this.d[p]
      this.n[i] = this.n[p]
      i = p
    }
    this.d[i] = d
    this.n[i] = n
  }
  // The smallest into (top.d, top.node).
  pop(top: { d: number; node: number }): void {
    top.d = this.d[0]
    top.node = this.n[0]
    const last = --this.size
    if (last === 0) return
    const d = this.d[last]
    const n = this.n[last]
    let i = 0
    for (;;) {
      let c = 2 * i + 1
      if (c >= last) break
      if (c + 1 < last && this.d[c + 1] < this.d[c]) c++
      if (this.d[c] >= d) break
      this.d[i] = this.d[c]
      this.n[i] = this.n[c]
      i = c
    }
    this.d[i] = d
    this.n[i] = n
  }
}

// ---- the canonical vertex graph of a surface ----

export interface VertexGraph {
  // CSR over canonical vertices.
  start: Int32Array
  nbr: Int32Array
  // The world position of each canonical vertex.
  cpos: Float64Array
  // The first vertex of each canonical vertex (its representative), and a triangle with that vertex: (triangle, corner 0..2).
  rep: Int32Array
  triOf: Int32Array
  cornerOf: Uint8Array
  // Canonical vertices that lie on an open border edge.
  border: Uint8Array
  nCanon: number
}

const graphs = new WeakMap<RefinedSurface, VertexGraph>()

export function vertexGraph(s: RefinedSurface): VertexGraph {
  const have = graphs.get(s)
  if (have) return have
  const nv = s.positions.length / 3
  const nt = s.indices.length / 3
  let nc = 0
  for (let v = 0; v < nv; v++) nc = Math.max(nc, s.canon[v] + 1)
  const rep = new Int32Array(nc).fill(-1)
  const cpos = new Float64Array(3 * nc)
  for (let v = 0; v < nv; v++) {
    const c = s.canon[v]
    if (rep[c] >= 0) continue
    rep[c] = v
    for (let k = 0; k < 3; k++) cpos[3 * c + k] = s.positions[3 * v + k]
  }
  const triOf = new Int32Array(nc).fill(-1)
  const cornerOf = new Uint8Array(nc)
  const border = new Uint8Array(nc)
  const deg = new Int32Array(nc + 1)
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const c = s.canon[s.indices[3 * t + k]]
      if (triOf[c] < 0) {
        triOf[c] = t
        cornerOf[c] = k
      }
      deg[c + 1] += 2
      if (s.adj[3 * t + k] < 0) {
        // the edge (k, k + 1) is a border edge: both its ends are on the border
        border[c] = 1
        border[s.canon[s.indices[3 * t + ((k + 1) % 3)]]] = 1
      }
    }
  }
  for (let c = 0; c < nc; c++) deg[c + 1] += deg[c]
  const fill = deg.slice(0, nc)
  const nbr = new Int32Array(deg[nc])
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const a = s.canon[s.indices[3 * t + k]]
      const b = s.canon[s.indices[3 * t + ((k + 1) % 3)]]
      nbr[fill[a]++] = b
      nbr[fill[b]++] = a
    }
  }
  const g: VertexGraph = { start: deg, nbr, cpos, rep, triOf, cornerOf, border, nCanon: nc }
  graphs.set(s, g)
  return g
}

// ---- the scumble mask ----

// The scumble mask per vertex (1 = ok) of one side of a figure's surface: see the header. `value` of the plan, the triangle gradients.
export function scumbleMaskOf(s: RefinedSurface, sp: SidePlan, perPx: number, params: PaintParams): Uint8Array {
  const d = params.detect
  const nv = s.positions.length / 3
  const nt = s.indices.length / 3
  const g = vertexGraph(s)
  // the largest gradient of a vertex's incident triangles
  const grad = new Float32Array(nv)
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const v = s.indices[3 * t + k]
      if (sp.grad[t] > grad[v]) grad[v] = sp.grad[t]
    }
  }
  const own = new Uint8Array(nv)
  const bad = new Uint8Array(g.nCanon)
  for (let v = 0; v < nv; v++) {
    own[v] = sp.trans[v] > 0.16 && grad[v] < d.scumbleGradient ? 1 : 0
    if (!own[v]) bad[s.canon[v]] = 1
  }
  for (let c = 0; c < g.nCanon; c++) if (g.border[c]) bad[c] = 1
  const need = Math.max(0.5 * perPx, (d.scumbleMinPx / 2) * perPx)
  // the graph distance to the nearest bad vertex, up to `need` (a vertex that is not reached within it is far enough)
  const dist = new Float64Array(g.nCanon).fill(Infinity)
  const heap = new Heap()
  for (let c = 0; c < g.nCanon; c++) {
    if (bad[c]) {
      dist[c] = 0
      heap.push(0, c)
    }
  }
  const top = { d: 0, node: 0 }
  while (heap.size > 0) {
    heap.pop(top)
    const u = top.node
    if (top.d > dist[u]) continue
    for (let q = g.start[u]; q < g.start[u + 1]; q++) {
      const w = g.nbr[q]
      const nd = top.d + Math.hypot(g.cpos[3 * u] - g.cpos[3 * w], g.cpos[3 * u + 1] - g.cpos[3 * w + 1], g.cpos[3 * u + 2] - g.cpos[3 * w + 2])
      if (nd < need && nd < dist[w]) {
        dist[w] = nd
        heap.push(nd, w)
      }
    }
  }
  const ok = new Uint8Array(nv)
  for (let v = 0; v < nv; v++) ok[v] = own[v] === 1 && dist[s.canon[v]] >= need ? 1 : 0
  return ok
}

// ---- the dabs ----

export interface DabSite {
  // The vertex (a representative of its canonical vertex) and a triangle with it as a corner: the surface point is exactly the vertex.
  vertex: number
  tri: number
  b1: number
  b2: number
  score: number
}

// The dab sites of one side of a figure's surface, best first, in the order they are kept.
export function dabSitesOf(s: RefinedSurface, sp: SidePlan, perPx: number, params: PaintParams): DabSite[] {
  const d = params.detect
  const g = vertexGraph(s)
  const radius = d.dabMinPx * perPx
  const score = (c: number): number => sp.value[g.rep[c]] + 0.01 * sp.key[g.rep[c]]
  const cands: number[] = []
  const dist = new Float64Array(g.nCanon).fill(Infinity)
  const touched: number[] = []
  const heap = new Heap(64)
  const top = { d: 0, node: 0 }
  for (let c = 0; c < g.nCanon; c++) {
    if (g.triOf[c] < 0 || sp.value[g.rep[c]] < DAB_MIN_VALUE) continue
    const sc = score(c)
    // a bounded Dijkstra from c: is any other vertex within `radius` at least as high?
    let isTop = true
    dist[c] = 0
    touched.push(c)
    heap.push(0, c)
    while (heap.size > 0 && isTop) {
      heap.pop(top)
      const u = top.node
      if (top.d > dist[u]) continue
      if (u !== c && score(u) >= sc) {
        isTop = false
        break
      }
      for (let q = g.start[u]; q < g.start[u + 1]; q++) {
        const w = g.nbr[q]
        const nd = top.d + Math.hypot(g.cpos[3 * u] - g.cpos[3 * w], g.cpos[3 * u + 1] - g.cpos[3 * w + 1], g.cpos[3 * u + 2] - g.cpos[3 * w + 2])
        if (nd <= radius && nd < dist[w]) {
          if (dist[w] === Infinity) touched.push(w)
          dist[w] = nd
          heap.push(nd, w)
        }
      }
    }
    heap.size = 0
    for (const t of touched) dist[t] = Infinity
    touched.length = 0
    if (isTop) cands.push(c)
  }
  if (cands.length === 0) return []
  cands.sort((a, b) => score(b) - score(a) || a - b)
  const keep = Math.max(1, Math.ceil(d.dabTopFraction * cands.length))
  const out: DabSite[] = []
  const spacing = radius
  for (const c of cands.slice(0, keep)) {
    let ok = true
    for (const o of out) {
      const oc = s.canon[o.vertex]
      if (Math.hypot(g.cpos[3 * c] - g.cpos[3 * oc], g.cpos[3 * c + 1] - g.cpos[3 * oc + 1], g.cpos[3 * c + 2] - g.cpos[3 * oc + 2]) < spacing) {
        ok = false
        break
      }
    }
    if (!ok) continue
    const k = g.cornerOf[c]
    out.push({ vertex: g.rep[c], tri: g.triOf[c], b1: k === 1 ? 1 : 0, b2: k === 2 ? 1 : 0, score: score(c) })
  }
  return out
}

// ---- the nearest particle of a mark ----

// A hash grid over a mark's particles: the nearest particle of the mark to a world point.
export class ParticleGrid {
  private readonly cell: number
  private readonly head: Map<number, number[]> = new Map()
  private readonly pos: Float32Array

  constructor(pos: Float32Array, ids: number[], cell: number) {
    this.pos = pos
    // (a cell is no smaller than 1/2000 of the particles' extent: the cell keys count 4096 cells either side of the origin)
    let extent = 0
    for (const i of ids) for (let k = 0; k < 3; k++) extent = Math.max(extent, Math.abs(pos[3 * i + k]))
    this.cell = Math.max(1e-9, cell, extent / 2000)
    for (const i of ids) {
      const key = this.keyOf(Math.floor(pos[3 * i] / this.cell), Math.floor(pos[3 * i + 1] / this.cell), Math.floor(pos[3 * i + 2] / this.cell))
      const bucket = this.head.get(key)
      if (bucket) bucket.push(i)
      else this.head.set(key, [i])
    }
  }

  private keyOf(a: number, b: number, c: number): number {
    return ((a + 4096) * 8192 + (b + 4096)) * 8192 + (c + 4096)
  }

  // The nearest particle to (x, y, z), or -1 when the mark has none. Ties go to the lowest index.
  nearest(x: number, y: number, z: number): number {
    if (this.head.size === 0) return -1
    const ci = Math.floor(x / this.cell)
    const cj = Math.floor(y / this.cell)
    const ck = Math.floor(z / this.cell)
    let best = -1
    let bd = Infinity
    for (let r = 0; r < 64; r++) {
      for (let a = ci - r; a <= ci + r; a++) {
        for (let b = cj - r; b <= cj + r; b++) {
          for (let c = ck - r; c <= ck + r; c++) {
            // only the shell of the cube at this radius
            if (Math.max(Math.abs(a - ci), Math.abs(b - cj), Math.abs(c - ck)) !== r) continue
            const bucket = this.head.get(this.keyOf(a, b, c))
            if (!bucket) continue
            for (const i of bucket) {
              const dd = (this.pos[3 * i] - x) ** 2 + (this.pos[3 * i + 1] - y) ** 2 + (this.pos[3 * i + 2] - z) ** 2
              if (dd < bd || (dd === bd && i < best)) {
                bd = dd
                best = i
              }
            }
          }
        }
      }
      // a particle in a shell at distance r·cell is no nearer than (r - 1)·cell: once the best is nearer than the next shell can be, stop
      if (best >= 0 && Math.sqrt(bd) <= r * this.cell) break
    }
    if (best >= 0) return best
    // (a point far from every particle: the plain scan, once)
    for (const bucket of this.head.values()) {
      for (const i of bucket) {
        const dd = (this.pos[3 * i] - x) ** 2 + (this.pos[3 * i + 1] - y) ** 2 + (this.pos[3 * i + 2] - z) ** 2
        if (dd < bd || (dd === bd && i < best)) {
          bd = dd
          best = i
        }
      }
    }
    return best
  }
}

export const planOf = (plan: WorldPlan, mark: number, sideIndex: 0 | 1): SidePlan | null => (sideIndex === 0 ? plan.front[mark] : plan.back[mark])
