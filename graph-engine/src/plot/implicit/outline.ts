// The outline of a region (calc P3, task 4): the directed boundary edges of the pieces the region stage kept (whole cells and the
// cut leaves) put together into the even-odd rings the scene contract carries, and the stretches of them that lie on a comparison's
// zero set, which are that comparison's boundary curve.
//
//   const pool = new EdgePool()
//   pool.addBox(cell)                           a whole cell: its four edges, counter-clockwise
//   pool.add(a, b, [k])                         one directed edge of a kept piece (kept region on its left), made by comparison k
//   pool.zero(a, b, k)                          the leaf edge a-b lies on the zero set of comparison k
//   const { rings, boundary } = pool.finish()
//
// THE PIECES MEET VERTEX TO VERTEX. A cell kept whole is one rectangle, and the leaves it meets are a pixel across; the leaf's
// vertices (its corners, and the roots on its edges) lie on the cell's edge. finish() splits every axis-aligned edge at every vertex
// of the pool that lies on it (all the cells and leaves of a view lie on the dyadic grid, so every edge a piece shares with another is
// axis-aligned and the test is exact equality of one coordinate), which is the whole cell's edges split at leaf resolution: no
// T-junctions are left, and what two pieces share is the same edge between the same two vertices.
//
// CANCELLING. A kept piece's edges run counter-clockwise, so an edge two kept pieces share is in the pool twice, once each way. It is
// not on the outline: the two cancel, by the exact coordinates of their ends (the vertices are keyed `${x},${y}`: the roots on a
// leaf edge are one object, and a corner is the same double whichever leaf holds it). What is left is the outline: edges with the
// kept region on their left and the rest on their right.
//
// RINGS. The edges that are left link end to end (every vertex has as many edges in as out). At a vertex that has more than one way
// out (two kept pieces that touch at a point: the lemniscate's node, xy > 0 at the origin) the next edge is the sharpest left turn,
// which keeps the rings apart (two regions that meet at a point are two rings, not a figure eight). A ring is a closed chain: the
// outer boundary of a kept region runs counter-clockwise and a hole in it clockwise (the region is always on the left), the
// parameter is the arc length from the first vertex, and the first vertex is the smallest by (x, y). Vertices in the middle of a
// straight run (exactly collinear: the splits the pieces made, the hidden breakpoints of a leaf) are dropped from the ring; the edges
// themselves are not changed, so every boundary vertex lies on a ring's edge. Rings are listed by their first vertex.
//
// BOUNDARY. An edge made by comparison k (a chord of its zero set across a leaf) is k's. So is an edge along a leaf edge that lies on
// k's zero set (y >= 0 on the grid line y = 0: its corners are exact zeros and so is its middle: pool.zero says so), which the edges
// of a whole cell that borders it have too, so that the stretch of the outline on y = 0 is the boundary of y >= 0 and not a gap in
// it. An edge that was cancelled is not on the outline, and so is not on a boundary curve: a zero set the region lies on both sides
// of (an `or` of two comparisons that meet) is no boundary.
import type { Vec2 } from '../../scene/types'
import type { Box, Segment } from './types'

export interface OutlineResult {
  // closed rings of vertices, the kept region on the left of every edge
  rings: Vec2[][]
  // for each comparison that made a surviving edge, those edges as pieces (segments a-b, for the chain builder)
  boundary: Map<number, Segment[]>
  // what assembly did: the edges that went in, the pairs that cancelled, the edges left, the rings they made, and the runs of edges that
  // did not close (an edge with nothing to join: none, if every piece that went in was a closed one)
  stats: { edges: number; cancelled: number; outline: number; rings: number; broken: number }
}

interface Raw {
  a: number
  b: number
  cmps: readonly number[] | null
}

// Vertex ids are packed into one number with an edge's other end: a < 2^26 vertices.
const PACK = 2 ** 26

export class EdgePool {
  private readonly ids = new Map<string, number>()
  private readonly pts: Vec2[] = []
  private readonly raw: Raw[] = []
  // the segments known to lie on a zero set, by the line they are on ("h" + y, "v" + x): [lo, hi, k] along it
  private readonly zeros = new Map<string, [number, number, number][]>()

  private vertex(p: Vec2): number {
    const key = `${p.x},${p.y}`
    let id = this.ids.get(key)
    if (id === undefined) {
      id = this.pts.length
      if (id >= PACK) throw new RangeError('EdgePool: too many vertices')
      this.ids.set(key, id)
      // (+ 0 makes a -0 a 0: the key does not tell them apart, so neither may the vertex)
      this.pts.push({ x: p.x + 0, y: p.y + 0 })
    }
    return id
  }

  // A directed edge of a kept piece: the kept region is on its left. `cmps` are the comparisons whose zero set it lies on, if it is a
  // chord of one.
  add(a: Vec2, b: Vec2, cmps: readonly number[] | null = null): void {
    const ia = this.vertex(a)
    const ib = this.vertex(b)
    if (ia === ib) return
    this.raw.push({ a: ia, b: ib, cmps })
  }

  // A whole cell: the rectangle, counter-clockwise.
  addBox(c: Box): void {
    const p = [
      { x: c.x0, y: c.y0 },
      { x: c.x1, y: c.y0 },
      { x: c.x1, y: c.y1 },
      { x: c.x0, y: c.y1 },
    ]
    for (let i = 0; i < 4; i++) this.add(p[i], p[(i + 1) % 4])
  }

  // The segment a-b, along a leaf edge, lies on the zero set of comparison k. Its ends are vertices of the pool whether or not a piece
  // has them (a whole cell's edge along it is cut there).
  zero(a: Vec2, b: Vec2, k: number): void {
    this.vertex(a)
    this.vertex(b)
    const horizontal = a.y === b.y
    if (!horizontal && a.x !== b.x) return
    const key = horizontal ? `h${a.y}` : `v${a.x}`
    const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y)
    const hi = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y)
    const list = this.zeros.get(key)
    if (list) list.push([lo, hi, k])
    else this.zeros.set(key, [[lo, hi, k]])
  }

  finish(): OutlineResult {
    const pts = this.pts

    // --- split the axis-aligned edges at every vertex on them
    const rows = new Map<number, number[]>()
    const cols = new Map<number, number[]>()
    for (const p of pts) {
      const r = rows.get(p.y)
      if (r) r.push(p.x)
      else rows.set(p.y, [p.x])
      const c = cols.get(p.x)
      if (c) c.push(p.y)
      else cols.set(p.x, [p.y])
    }
    for (const m of [rows, cols]) {
      for (const [key, list] of m) {
        list.sort((s, t) => s - t)
        // (a dense line is a long list: the duplicates are dropped once)
        let w = 0
        for (let i = 0; i < list.length; i++) if (i === 0 || list[i] !== list[i - 1]) list[w++] = list[i]
        list.length = w
        m.set(key, list)
      }
    }
    // the first index of `list` whose value is above v
    const above = (list: number[], v: number): number => {
      let lo = 0
      let hi = list.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (list[mid] <= v) lo = mid + 1
        else hi = mid
      }
      return lo
    }
    const split: Raw[] = []
    for (const e of this.raw) {
      const p = pts[e.a]
      const q = pts[e.b]
      const horizontal = p.y === q.y
      const vertical = p.x === q.x
      if (horizontal === vertical) {
        split.push(e)
        continue
      }
      const list = (horizontal ? rows.get(p.y) : cols.get(p.x)) as number[]
      const from = horizontal ? p.x : p.y
      const to = horizontal ? q.x : q.y
      const lo = Math.min(from, to)
      const hi = Math.max(from, to)
      const inner: number[] = []
      for (let i = above(list, lo); i < list.length && list[i] < hi; i++) inner.push(list[i])
      if (inner.length === 0) {
        split.push(e)
        continue
      }
      if (from > to) inner.reverse()
      let prev = e.a
      for (const t of inner) {
        const id = this.vertex(horizontal ? { x: t, y: p.y } : { x: p.x, y: t })
        split.push({ a: prev, b: id, cmps: e.cmps })
        prev = id
      }
      split.push({ a: prev, b: e.b, cmps: e.cmps })
    }

    // --- cancel the edges two pieces share
    const live = new Map<number, Raw>()
    let cancelled = 0
    for (const e of split) {
      const reverse = e.b * PACK + e.a
      if (live.has(reverse)) {
        live.delete(reverse)
        cancelled++
        continue
      }
      const forward = e.a * PACK + e.b
      if (!live.has(forward)) live.set(forward, e)
    }
    const edges = [...live.values()]

    // --- the comparison each edge lies on
    const cover = this.zeroCover()
    const boundary = new Map<number, Segment[]>()
    for (const e of edges) {
      const p = pts[e.a]
      const q = pts[e.b]
      let ks: readonly number[] | null = e.cmps
      if (ks === null) {
        const horizontal = p.y === q.y
        if (horizontal || p.x === q.x) ks = coveredBy(cover, horizontal ? `h${p.y}` : `v${p.x}`, horizontal ? Math.min(p.x, q.x) : Math.min(p.y, q.y), horizontal ? Math.max(p.x, q.x) : Math.max(p.y, q.y))
      }
      if (ks === null) continue
      for (const k of ks) {
        const seg: Segment = { a: p, b: q }
        const list = boundary.get(k)
        if (list) list.push(seg)
        else boundary.set(k, [seg])
      }
    }

    // --- link the edges into rings
    const out = new Map<number, number[]>()
    edges.forEach((e, i) => {
      const list = out.get(e.a)
      if (list) list.push(i)
      else out.set(e.a, [i])
    })
    const used = new Uint8Array(edges.length)
    const rings: Vec2[][] = []
    let broken = 0
    const TAU = 2 * Math.PI
    for (let e0 = 0; e0 < edges.length; e0++) {
      if (used[e0]) continue
      const ring: number[] = []
      let e = e0
      used[e0] = 1
      for (;;) {
        ring.push(edges[e].a)
        const v = edges[e].b
        const here = out.get(v) ?? []
        const options: number[] = []
        for (const c of here) if (!used[c] || (c === e0 && v === edges[e0].a)) options.push(c)
        if (options.length === 0) break
        let next = options[0]
        if (options.length > 1) {
          // the sharpest left turn: the first edge met turning clockwise from the way back
          const back = Math.atan2(pts[edges[e].a].y - pts[v].y, pts[edges[e].a].x - pts[v].x)
          let best = Infinity
          for (const c of options) {
            const to = pts[edges[c].b]
            let turn = back - Math.atan2(to.y - pts[v].y, to.x - pts[v].x)
            while (turn <= 0) turn += TAU
            if (turn < best) {
              best = turn
              next = c
            }
          }
        }
        if (next === e0) break
        used[next] = 1
        e = next
      }
      if (edges[e].b !== edges[e0].a) {
        broken++
        continue
      }
      const simple = straighten(ring.map((id) => pts[id]))
      if (simple.length >= 3 && Math.abs(areaOf(simple)) > 0) rings.push(canonical(simple))
    }
    rings.sort(compareSeq)
    return { rings, boundary, stats: { edges: this.raw.length, cancelled, outline: edges.length, rings: rings.length, broken } }
  }

  // The zero segments of each line, per comparison, merged where they touch.
  private zeroCover(): Map<string, [number, number, number][]> {
    const merged = new Map<string, [number, number, number][]>()
    for (const [key, list] of this.zeros) {
      const sorted = [...list].sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1])
      const out: [number, number, number][] = []
      for (const s of sorted) {
        const last = out[out.length - 1]
        if (last && last[2] === s[2] && s[0] <= last[1]) last[1] = Math.max(last[1], s[1])
        else out.push([s[0], s[1], s[2]])
      }
      merged.set(key, out)
    }
    return merged
  }
}

// The comparisons whose merged zero segments on a line hold [lo, hi] whole, or null.
function coveredBy(cover: Map<string, [number, number, number][]>, key: string, lo: number, hi: number): number[] | null {
  const list = cover.get(key)
  if (!list) return null
  let ks: number[] | null = null
  for (const [a, b, k] of list) {
    if (a <= lo && hi <= b) {
      if (ks === null) ks = [k]
      else ks.push(k)
    }
  }
  return ks
}

function areaOf(p: readonly Vec2[]): number {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length]
    a += p[i].x * q.y - q.x * p[i].y
  }
  return a / 2
}

// The ring without the vertices in the middle of a straight run: where the way in and the way out are exactly collinear and in the
// same direction. Repeated until nothing more goes (a run of three collinear points is one edge).
function straighten(p: readonly Vec2[]): Vec2[] {
  let cur = [...p]
  for (let pass = 0; pass < 4; pass++) {
    const next: Vec2[] = []
    const m = cur.length
    for (let i = 0; i < m; i++) {
      const a = cur[(i + m - 1) % m]
      const b = cur[i]
      const c = cur[(i + 1) % m]
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
      const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)
      if (cross === 0 && dot > 0) continue
      next.push(b)
    }
    const done = next.length === cur.length
    cur = next
    if (done || cur.length < 3) break
  }
  return cur
}

function compare(a: Vec2, b: Vec2): number {
  return a.x !== b.x ? (a.x < b.x ? -1 : 1) : a.y !== b.y ? (a.y < b.y ? -1 : 1) : 0
}

function compareSeq(a: readonly Vec2[], b: readonly Vec2[]): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const c = compare(a[i], b[i])
    if (c !== 0) return c
  }
  return a.length - b.length
}

// The ring from its smallest vertex by (x, y) (the first such, by the sequence that follows, if the ring passes it twice).
function canonical(p: Vec2[]): Vec2[] {
  const n = p.length
  let min = p[0]
  for (const v of p) if (compare(v, min) < 0) min = v
  let best: Vec2[] | null = null
  for (let i = 0; i < n; i++) {
    if (compare(p[i], min) !== 0) continue
    const seq = [...p.slice(i), ...p.slice(0, i)]
    if (best === null || compareSeq(seq, best) < 0) best = seq
  }
  return best as Vec2[]
}
