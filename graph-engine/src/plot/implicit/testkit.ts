// Test helpers for the contouring stages (calc P3, task 3): the whole pipeline of an implicit curve H = 0 as a test
// sees it (quadtree, contour, chains), and the measures the acceptance cases are held to. Not used outside tests.
import { compileScalar } from '../../math/compile'
import { gradient } from '../../math/diff'
import type { MathScope } from '../../math/scope'
import type { Chain, Bounds, Vec2 } from '../../scene/types'
import { expr, scopeOf } from '../sample/testkit'
import type { EvalCounter, PxScale } from '../sample/types'
import { buildChains, buildTouchCurves } from './chains'
import { type ContourResult, compileContour, contourLeaves } from './contour'
import { implicitClassifier, rootBox, subdivide } from './quadtree'
import { FULL, type ImplicitTuning } from './tuning'
import type { Box, Leaf } from './types'

// The default view of the corpus: [-10, 10]^2 at 800 px, 40 px per unit, so the root is [-15, 15]^2 and the origin is a
// corner of the grid.
export const VIEW: Bounds = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }
export const PX: PxScale = { x: 40, y: 40 }

export interface Traced {
  root: Box
  leaves: Leaf[]
  capped: boolean
  contour: ContourResult
  chains: Chain[]
  touch: { chains: Chain[]; points: Vec2[] }
  // the whole spend: the quadtree's twin evaluations, then the contour's points and twin evaluations
  counter: EvalCounter
  // the contour stage's own spend
  spent: EvalCounter
  px: PxScale
  // |H| / |grad H| in px at a point: the first-order distance of the point to the zero set
  distPx: (x: number, y: number) => number
}

// H = 0 for `h` (the text of F - G), through the quadtree at `tuning`'s leaf size, the contour and the chains.
export function trace(h: string, o: { tuning?: ImplicitTuning; view?: Bounds; px?: PxScale; scope?: MathScope; budget?: { points: number; intervals: number } } = {}): Traced {
  const tuning = o.tuning ?? FULL
  const view = o.view ?? VIEW
  const px = o.px ?? PX
  const scope = o.scope ?? scopeOf()
  const e = expr(h)
  const fns = compileContour(e, scope)
  const root = rootBox(view, tuning.overscan)
  const counter: EvalCounter = { points: 0, intervals: 0 }
  const sub = subdivide(implicitClassifier(fns.Hi), root, { x: tuning.leafPx, y: tuning.leafPx }, px, counter, tuning.budget)
  const before = { points: counter.points, intervals: counter.intervals }
  const contour = contourLeaves(sub.leaves, fns, { px, clip: root }, counter, o.budget)
  const spent = { points: counter.points - before.points, intervals: counter.intervals - before.intervals }
  const chains = buildChains(contour.segments, px)
  const touch = buildTouchCurves(contour.touches, contour.touchLinks, px)
  const H = compileScalar(e, ['x', 'y'], scope)
  const g = gradient(e, ['x', 'y'], scope).map((q) => compileScalar(q, ['x', 'y'], scope))
  const distPx = (x: number, y: number) => {
    const v = Math.abs(H(x, y))
    const d = Math.hypot(g[0](x, y) / px.x, g[1](x, y) / px.y)
    return v === 0 ? 0 : v / d
  }
  return { root, leaves: sub.leaves, capped: sub.capped, contour, chains, touch, counter, spent, px, distPx }
}

export function verticesOf(chain: Chain): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < chain.param.length; i++) out.push({ x: chain.xy[2 * i], y: chain.xy[2 * i + 1] })
  return out
}

export function allVertices(chains: readonly Chain[]): Vec2[] {
  return chains.flatMap(verticesOf)
}

// The most any vertex is off the zero set, in px.
export function worstPx(t: Traced, chains: readonly Chain[] = t.chains): number {
  let worst = 0
  for (const v of allVertices(chains)) worst = Math.max(worst, t.distPx(v.x, v.y))
  return worst
}

// How many arms of the drawn curve meet at `at`: a chain's vertex there is two arms if it is inside the chain (or the
// closing vertex of a closed chain), one if it is an end of an open chain.
export function arms(chains: readonly Chain[], at: Vec2, eps = 1e-9): number {
  let n = 0
  for (const c of chains) {
    const v = verticesOf(c)
    v.forEach((p, i) => {
      if (Math.hypot(p.x - at.x, p.y - at.y) > eps) return
      n += c.closed || (i > 0 && i < v.length - 1) ? 2 : 1
    })
  }
  return n
}

// The chain vertex nearest `at`.
export function nearestVertex(chains: readonly Chain[], at: Vec2, px: PxScale = PX): Vec2 {
  let best: Vec2 = { x: NaN, y: NaN }
  let bd = Infinity
  for (const v of allVertices(chains)) {
    const d = Math.hypot((v.x - at.x) * px.x, (v.y - at.y) * px.y)
    if (d < bd) {
      bd = d
      best = v
    }
  }
  return best
}

// The nearest chain vertex to `at`, in px.
export function nearestPx(chains: readonly Chain[], at: Vec2, px: PxScale = PX): number {
  let best = Infinity
  for (const v of allVertices(chains)) best = Math.min(best, Math.hypot((v.x - at.x) * px.x, (v.y - at.y) * px.y))
  return best
}

// The distance, in px, from `at` to the nearest point of the drawn curve (its polylines, not only its vertices).
export function curveDistPx(chains: readonly Chain[], at: Vec2, px: PxScale = PX): number {
  let best = Infinity
  for (const c of chains) {
    for (const [a, b] of segmentsOf(c)) {
      const ax = (a.x - at.x) * px.x
      const ay = (a.y - at.y) * px.y
      const dx = (b.x - a.x) * px.x
      const dy = (b.y - a.y) * px.y
      const len2 = dx * dx + dy * dy
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
    }
  }
  return best
}

// The polyline of a chain as segments (the closing one included for a closed chain).
export function segmentsOf(chain: Chain): [Vec2, Vec2][] {
  const v = verticesOf(chain)
  const out: [Vec2, Vec2][] = []
  for (let i = 0; i + 1 < v.length; i++) out.push([v[i], v[i + 1]])
  if (chain.closed && v.length > 2) out.push([v[v.length - 1], v[0]])
  return out
}

// Whether two segments cross properly: their interiors meet at one point that is not an end of either (segments that
// share an end, or lie along one another, do not cross).
export function cross(a: [Vec2, Vec2], b: [Vec2, Vec2]): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = o(a[0], a[1], b[0])
  const d2 = o(a[0], a[1], b[1])
  const d3 = o(b[0], b[1], a[0])
  const d4 = o(b[0], b[1], a[1])
  return d1 * d2 < 0 && d3 * d4 < 0
}

// Whether any two segments of the chains cross properly, found through a grid of buckets: the first pair is returned.
export function firstCrossing(chains: readonly Chain[], cell = 0.5): [[Vec2, Vec2], [Vec2, Vec2]] | null {
  const segs = chains.flatMap(segmentsOf)
  const buckets = new Map<string, number[]>()
  segs.forEach((s, k) => {
    const x0 = Math.floor(Math.min(s[0].x, s[1].x) / cell)
    const x1 = Math.floor(Math.max(s[0].x, s[1].x) / cell)
    const y0 = Math.floor(Math.min(s[0].y, s[1].y) / cell)
    const y1 = Math.floor(Math.max(s[0].y, s[1].y) / cell)
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const key = `${i},${j}`
        const list = buckets.get(key)
        if (list) list.push(k)
        else buckets.set(key, [k])
      }
    }
  })
  for (const list of buckets.values()) {
    for (let p = 0; p < list.length; p++) {
      for (let q = p + 1; q < list.length; q++) {
        if (cross(segs[list[p]], segs[list[q]])) return [segs[list[p]], segs[list[q]]]
      }
    }
  }
  return null
}

// A chain's arc length, in world units.
export function lengthOf(chain: Chain): number {
  const v = verticesOf(chain)
  let sum = 0
  for (let i = 0; i + 1 < v.length; i++) sum += Math.hypot(v[i + 1].x - v[i].x, v[i + 1].y - v[i].y)
  if (chain.closed && v.length > 2) sum += Math.hypot(v[0].x - v[v.length - 1].x, v[0].y - v[v.length - 1].y)
  return sum
}

// The signed area of a closed chain (positive counter-clockwise).
export function signedArea(chain: Chain): number {
  const v = verticesOf(chain)
  let a = 0
  for (let i = 0; i < v.length; i++) {
    const p = v[i]
    const q = v[(i + 1) % v.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}
