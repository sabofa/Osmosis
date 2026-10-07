// Chains (calc P3, task 3): the pieces of contour.ts joined into the scene contract's runs of connected vertices.
//
//   buildChains(segments, px)                       the contour's pieces -> open and closed chains
//   buildTouchCurves(touches, touchLinks, px)       the touch points -> chains, and isolated points
//
// JOINING. Pieces meet on exactly equal coordinates (a crossing is made once per leaf edge and both leaves hold the
// same point), so a chain is followed from piece to piece by the point they share, and a crack cannot open between
// leaves. A point where two pieces meet is passed through. A point where more meet (the origin of xy = 0 and of the
// lemniscate, a crossing of two curves, a T) pairs its arms by direction, the most opposite first, so that a curve
// continues straight through a crossing: xy = 0 is two chains, the lemniscate one closed chain that passes the origin
// twice. An arm left over (the odd one of a T) ends its chain there. Directions are taken on the screen (the px scale),
// where "straight" is judged. Duplicate pieces, and pieces of no length, are dropped.
//
// ORDER AND PARAMETER ("Decided before P3"). `param` is the cumulative arc length in world units from the first
// vertex (a closed chain's closing stretch is not counted: the last vertex joins back to the first, which is not
// repeated). An open chain starts at its end with the smaller x, then y (if both ends are one point, the way whose
// second vertex is the smaller); a closed chain starts at its vertex with the smaller x, then y and runs
// counter-clockwise (a figure eight, whose signed area is nothing, runs toward the smaller y first). Chains are
// listed by their first vertex. All of it depends on the pieces and not on the order they came in. This start is not
// stable under pan; it is settled together with the ordinal mark ids before goal 2.
//
// TOUCH CURVES. Touch points are single points where the zero set touches a leaf (contour.ts), so what joins them is
// their leaves being next to each other. Points within TOUCH.mergePx of each other are one (the leaves either side of a
// double line, the four round a point that sits on a corner). A set of linked points no more than TOUCH.pointPx across
// is one isolated point, at the middle of them. A longer one is a curve: the links are cut to a minimum spanning tree
// (the closest neighbours), and its longest path is the chain, closed if it comes back to where it began. A branch
// shorter than a mark is dropped, a longer one is a chain of its own.
import { chainOf } from '../../scene/chains'
import type { Chain, Vec2 } from '../../scene/types'
import type { PxScale } from '../sample/types'
import type { TouchPoint } from './contour'
import { TOUCH } from './tuning'
import type { Segment } from './types'

function compare(a: Vec2, b: Vec2): number {
  return a.x !== b.x ? (a.x < b.x ? -1 : 1) : a.y !== b.y ? (a.y < b.y ? -1 : 1) : 0
}

// The order a closed chain with no area to say it runs: toward the smaller y, then x, from its start.
function compareYX(a: Vec2, b: Vec2): number {
  return a.y !== b.y ? (a.y < b.y ? -1 : 1) : a.x !== b.x ? (a.x < b.x ? -1 : 1) : 0
}

function compareSeq(a: readonly Vec2[], b: readonly Vec2[]): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const c = compare(a[i], b[i])
    if (c !== 0) return c
  }
  return a.length - b.length
}

function signedArea(p: readonly Vec2[]): number {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length]
    a += p[i].x * q.y - q.x * p[i].y
  }
  return a / 2
}

function perimeter(p: readonly Vec2[]): number {
  let sum = 0
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length]
    sum += Math.hypot(q.x - p[i].x, q.y - p[i].y)
  }
  return sum
}

// An open run of vertices, started at its end with the smaller (x, y).
function orientOpen(p: Vec2[]): Vec2[] {
  const n = p.length
  const c = compare(p[0], p[n - 1])
  const reverse = c > 0 || (c === 0 && n > 2 && compare(p[1], p[n - 2]) > 0)
  return reverse ? [...p].reverse() : p
}

// A closed run of vertices (the first not repeated), from its smallest (x, y), counter-clockwise.
function orientClosed(p: Vec2[]): Vec2[] {
  const n = p.length
  const area = signedArea(p)
  const per = perimeter(p)
  const flat = Math.abs(area) <= 1e-12 * per * per
  let best: Vec2[] | null = null
  let min = p[0]
  for (const v of p) if (compare(v, min) < 0) min = v
  for (let i = 0; i < n; i++) {
    if (compare(p[i], min) !== 0) continue
    const forward = p[(i + 1) % n]
    const backward = p[(i + n - 1) % n]
    const ccw = flat ? compareYX(forward, backward) <= 0 : area > 0
    const seq: Vec2[] = []
    for (let k = 0; k < n; k++) seq.push(p[(i + (ccw ? k : n - k) + n) % n])
    if (best === null || compareSeq(seq, best) < 0) best = seq
  }
  return best as Vec2[]
}

function finish(points: Vec2[], closed: boolean): { points: Vec2[]; closed: boolean } {
  return { points: closed ? orientClosed(points) : orientOpen(points), closed }
}

function toChain(r: { points: Vec2[]; closed: boolean }): Chain {
  const param: number[] = [0]
  for (let i = 1; i < r.points.length; i++) param.push(param[i - 1] + Math.hypot(r.points[i].x - r.points[i - 1].x, r.points[i].y - r.points[i - 1].y))
  return chainOf(r.points, param, r.closed)
}

function sortRuns(runs: { points: Vec2[]; closed: boolean }[]): Chain[] {
  runs.sort((a, b) => compareSeq(a.points, b.points))
  return runs.map(toChain)
}

export function buildChains(segments: readonly Segment[], px: PxScale): Chain[] {
  const id = new Map<string, number>()
  const pos: Vec2[] = []
  const nodeOf = (p: Vec2): number => {
    const key = `${p.x},${p.y}`
    let k = id.get(key)
    if (k === undefined) {
      k = pos.length
      id.set(key, k)
      pos.push({ x: p.x, y: p.y })
    }
    return k
  }
  const ea: number[] = []
  const eb: number[] = []
  const seen = new Set<string>()
  for (const s of segments) {
    const a = nodeOf(s.a)
    const b = nodeOf(s.b)
    if (a === b) continue
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    if (seen.has(key)) continue
    seen.add(key)
    ea.push(a)
    eb.push(b)
  }
  const edges = ea.length
  if (edges === 0) return []
  const inc: number[][] = pos.map(() => [])
  for (let e = 0; e < edges; e++) {
    inc[ea[e]].push(e)
    inc[eb[e]].push(e)
  }
  const other = (e: number, n: number) => (ea[e] === n ? eb[e] : ea[e])

  // mate[n][t]: the edge the t-th arm at node n continues into, or -1 for a chain end
  const mate: number[][] = inc.map((arms, n) => {
    const d = arms.length
    if (d === 1) return [-1]
    if (d === 2) return [arms[1], arms[0]]
    const far = arms.map((e) => pos[other(e, n)])
    const dir = far.map((f) => {
      const vx = (f.x - pos[n].x) * px.x
      const vy = (f.y - pos[n].y) * px.y
      const len = Math.hypot(vx, vy)
      return { x: vx / len, y: vy / len }
    })
    const out = new Array<number>(d).fill(-1)
    const free = new Set<number>(arms.map((_, t) => t))
    while (free.size >= 2) {
      let bi = -1
      let bj = -1
      let bd = Infinity
      const list = [...free]
      for (let a = 0; a < list.length; a++) {
        for (let b = a + 1; b < list.length; b++) {
          const i = list[a]
          const j = list[b]
          const dot = dir[i].x * dir[j].x + dir[i].y * dir[j].y
          // the most opposite pair; a tie goes to the pair whose far ends come first
          let better = dot < bd - 1e-12
          if (!better && dot <= bd + 1e-12 && bi >= 0) {
            const lo = compare(far[i], far[j]) <= 0 ? [far[i], far[j]] : [far[j], far[i]]
            const bl = compare(far[bi], far[bj]) <= 0 ? [far[bi], far[bj]] : [far[bj], far[bi]]
            better = compareSeq(lo, bl) < 0
          }
          if (better) {
            bd = Math.min(bd, dot)
            bi = i
            bj = j
          }
        }
      }
      out[bi] = arms[bj]
      out[bj] = arms[bi]
      free.delete(bi)
      free.delete(bj)
    }
    return out
  })
  const nextEdge = (n: number, e: number) => mate[n][inc[n].indexOf(e)]

  const visited = new Uint8Array(edges)
  const runs: { points: Vec2[]; closed: boolean }[] = []

  // open chains: from an arm that continues into nothing
  const order = pos.map((_, n) => n).sort((a, b) => compare(pos[a], pos[b]))
  for (const n of order) {
    for (let t = 0; t < inc[n].length; t++) {
      if (mate[n][t] !== -1 || visited[inc[n][t]]) continue
      let e = inc[n][t]
      let from = n
      const pts: Vec2[] = [pos[from]]
      for (;;) {
        visited[e] = 1
        const to = other(e, from)
        pts.push(pos[to])
        const m = nextEdge(to, e)
        if (m === -1) break
        e = m
        from = to
      }
      runs.push(finish(pts, false))
    }
  }
  // what is left is on loops
  for (let e0 = 0; e0 < edges; e0++) {
    if (visited[e0]) continue
    let e = e0
    let from = ea[e0]
    const pts: Vec2[] = []
    do {
      visited[e] = 1
      pts.push(pos[from])
      const to = other(e, from)
      e = nextEdge(to, e)
      from = to
    } while (e !== e0)
    runs.push(finish(pts, true))
  }
  return sortRuns(runs)
}

export function buildTouchCurves(touches: readonly TouchPoint[], links: readonly (readonly [number, number])[], px: PxScale): { chains: Chain[]; points: Vec2[] } {
  const n = touches.length
  if (n === 0) return { chains: [], points: [] }
  const dist = (a: Vec2, b: Vec2) => Math.hypot((a.x - b.x) * px.x, (a.y - b.y) * px.y)

  // merge the points that are one
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }
  const cell = TOUCH.mergePx
  const grid = new Map<string, number[]>()
  const cellOf = (t: TouchPoint): [number, number] => [Math.floor((t.x * px.x) / cell), Math.floor((t.y * px.y) / cell)]
  for (let i = 0; i < n; i++) {
    const [cx, cy] = cellOf(touches[i])
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (dist(touches[i], touches[j]) < cell) union(i, j)
      }
    }
    const key = `${cx},${cy}`
    const list = grid.get(key)
    if (list) list.push(i)
    else grid.set(key, [i])
  }
  const sum = new Map<number, { x: number; y: number; k: number }>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const s = sum.get(r)
    if (s) {
      s.x += touches[i].x
      s.y += touches[i].y
      s.k++
    } else sum.set(r, { x: touches[i].x, y: touches[i].y, k: 1 })
  }
  const nodes: Vec2[] = [...sum.values()].map((s) => ({ x: s.x / s.k, y: s.y / s.k })).sort(compare)
  const nodeIndex = new Map(nodes.map((p, i) => [`${p.x},${p.y}`, i]))
  const rootNode = new Map<number, number>()
  for (const [r, s] of sum) rootNode.set(r, nodeIndex.get(`${s.x / s.k},${s.y / s.k}`) as number)
  const nodeOfPoint = (i: number) => rootNode.get(find(i)) as number

  // links between nodes
  const m = nodes.length
  const nodeLinks: [number, number][] = []
  const linkSeen = new Set<string>()
  for (const [i, j] of links) {
    const a = nodeOfPoint(i)
    const b = nodeOfPoint(j)
    if (a === b) continue
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    const key = `${lo}:${hi}`
    if (linkSeen.has(key)) continue
    linkSeen.add(key)
    nodeLinks.push([lo, hi])
  }
  nodeLinks.sort((p, q) => p[0] - q[0] || p[1] - q[1])

  // clusters: the connected sets of nodes
  const cp = Array.from({ length: m }, (_, i) => i)
  const cfind = (i: number): number => {
    while (cp[i] !== i) {
      cp[i] = cp[cp[i]]
      i = cp[i]
    }
    return i
  }
  for (const [a, b] of nodeLinks) {
    const ra = cfind(a)
    const rb = cfind(b)
    if (ra !== rb) cp[Math.max(ra, rb)] = Math.min(ra, rb)
  }
  const clusters = new Map<number, number[]>()
  for (let i = 0; i < m; i++) {
    const r = cfind(i)
    const list = clusters.get(r)
    if (list) list.push(i)
    else clusters.set(r, [i])
  }

  const points: Vec2[] = []
  const runs: { points: Vec2[]; closed: boolean }[] = []
  for (const [root, members] of clusters) {
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (const i of members) {
      x0 = Math.min(x0, nodes[i].x)
      x1 = Math.max(x1, nodes[i].x)
      y0 = Math.min(y0, nodes[i].y)
      y1 = Math.max(y1, nodes[i].y)
    }
    if (Math.hypot((x1 - x0) * px.x, (y1 - y0) * px.y) < TOUCH.pointPx) {
      let sx = 0
      let sy = 0
      for (const i of members) {
        sx += nodes[i].x
        sy += nodes[i].y
      }
      points.push({ x: sx / members.length, y: sy / members.length })
      continue
    }
    const mine = nodeLinks.filter(([a]) => cfind(a) === root)
    runs.push(...pathsOf(members, mine, nodes, px))
  }
  points.sort(compare)
  return { chains: sortRuns(runs), points }
}

// The chains of one cluster: its minimum spanning tree, longest path first.
function pathsOf(members: number[], links: [number, number][], nodes: readonly Vec2[], px: PxScale): { points: Vec2[]; closed: boolean }[] {
  const dist = (a: number, b: number) => Math.hypot((nodes[a].x - nodes[b].x) * px.x, (nodes[a].y - nodes[b].y) * px.y)
  // Kruskal
  const sorted = [...links].sort((p, q) => dist(p[0], p[1]) - dist(q[0], q[1]) || p[0] - q[0] || p[1] - q[1])
  const tp = new Map<number, number>(members.map((i) => [i, i]))
  const tfind = (i: number): number => {
    let r = i
    while (tp.get(r) !== r) r = tp.get(r) as number
    return r
  }
  const adj = new Map<number, number[]>(members.map((i) => [i, []]))
  for (const [a, b] of sorted) {
    const ra = tfind(a)
    const rb = tfind(b)
    if (ra === rb) continue
    tp.set(Math.max(ra, rb), Math.min(ra, rb))
    ;(adj.get(a) as number[]).push(b)
    ;(adj.get(b) as number[]).push(a)
  }
  const linked = new Set(links.map(([a, b]) => `${a}:${b}`))
  const alive = new Set(members)

  // the nodes of the tree piece holding `start` among the alive ones, with their distance along the tree from it
  const farthest = (start: number) => {
    const from = new Map<number, number>([[start, -1]])
    const along = new Map<number, number>([[start, 0]])
    const queue = [start]
    let best = start
    for (let q = 0; q < queue.length; q++) {
      const u = queue[q]
      for (const v of adj.get(u) as number[]) {
        if (!alive.has(v) || from.has(v)) continue
        from.set(v, u)
        along.set(v, (along.get(u) as number) + dist(u, v))
        queue.push(v)
        const dv = along.get(v) as number
        const db = along.get(best) as number
        if (dv > db || (dv === db && v < best)) best = v
      }
    }
    return { best, from, count: queue.length }
  }

  const out: { points: Vec2[]; closed: boolean }[] = []
  let first = true
  while (alive.size > 0) {
    const start = Math.min(...alive)
    const a = farthest(start)
    if (a.count === 1) {
      alive.delete(start)
      continue
    }
    const b = farthest(a.best)
    const path: number[] = []
    for (let v = b.best; v !== -1; v = b.from.get(v) as number) path.push(v)
    const pts = path.map((i) => nodes[i])
    const extent = Math.hypot((Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x))) * px.x, (Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y))) * px.y)
    if (first || extent >= TOUCH.pointPx) {
      const lo = Math.min(path[0], path[path.length - 1])
      const hi = Math.max(path[0], path[path.length - 1])
      const closed = first && path.length >= 3 && path.length === members.length && linked.has(`${lo}:${hi}`)
      out.push(finish(pts, closed))
    }
    first = false
    for (const v of path) alive.delete(v)
  }
  return out
}
