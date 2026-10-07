// Contouring a leaf (calc P3, task 3): where the zero set of H = F - G crosses each leaf of the quadtree, as
// straight pieces whose ends lie ON the zero set, so that the chains built from them (chains.ts) are certified.
//
//   const fns = compileContour(h, scope)                       // H, its twin, its gradient
//   const { segments, touches, touchLinks, stats, capped } = contourLeaves(leaves, fns, { px, clip }, counter, budget?)
//   const chains = buildChains(segments, px)                    // chains.ts
//   const { chains: touchChains, points } = buildTouchCurves(touches, touchLinks, px)
//
// RULE 1 holds here: nothing is connected unless it is certified. A piece joins two points that are each a
// zero of H found on a leaf edge, or a corner where H is exactly zero, or the saddle point of a crossing, and a
// piece is never drawn across a pole, a jump or an undefined corner.
//
// CORNERS. H is the scalar compile, evaluated once at each distinct corner (cached by its exact coordinates).
// A corner is + when H >= 0 (an exact zero, signed or not, counts as +), - when H < 0, and undefined when H is NaN.
// A leaf with an undefined corner is skipped (an undefined cell is never connected across), and counted.
//
// CROSSINGS. A sign change along a leaf edge is a crossing; it is located by BISECTION on H along the edge, never by
// interpolation, to 2^-12 px (CONTOUR.bisectPx), and kept in a cache by the edge's end coordinates, so the leaf on
// the other side of the edge is handed the very same point (Crossings, below; the region stage reuses it for each of a
// condition's comparisons). Where the + end of the edge is exactly zero the crossing IS that corner: no bisection, and
// the point is shared by every edge that meets the corner.
//
// POLES AND JUMPS. A sign change is not a root if H blows up or jumps across it (y - tan x changes sign at every
// pole). A leaf whose twin verdict is CONTINUOUS needs no check. For the rest, the twin is asked about the bracket
// the bisection ended with: CONTINUOUS, a root. Otherwise the bisection goes on to machine width, asking again as it
// goes: a bracket that is still PARTIAL with an infinite bound there holds a pole and the crossing is rejected; one
// whose twin says nothing (DEFINED: floor, mod, a seam; PARTIAL with finite bounds) is a root only if |H(hi) - H(lo)|
// has shrunk with the bracket (CONTOUR.jumpShrink), which a jump's does not. A UNKNOWN twin (an integral) says
// nothing, and the scalar sign change stands. A rejected crossing stops its leaf (nothing is drawn in it), and the
// edge stays rejected for the leaf on its other side.
//
// PIECES. Two crossings make one piece. The sign pattern of the corners says which: the piece cuts off the + run's
// corners. Where that run is all exact zeros (xy = 0: the corners round the origin) the piece follows the edges between
// them. An edge whose two ends are exact zeros is a piece whatever the signs of the leaf (the axes of xy = 0, the double
// line y^2 = 0 on a grid line), unless all four corners are zero (a plateau). Where a curve meets such a zero edge (a T:
// the run is a zero edge and one strict + corner) the curve is joined to the end of the edge nearer where it leaves it.
// Otherwise the piece is the chord between the two crossings. Four crossings (the corners alternate) are paired by the
// ASYMPTOTIC DECIDER: the bilinear interpolant's value at its saddle point says whether the + corners are joined (then
// the pieces cut off the - corners) or the - ones. When that value is within CONTOUR.crossRel of the largest corner value
// the leaf holds an X (two curves crossing: xy = 0, sin x sin y = 0 at its nodes), and four pieces run from the
// crossings to the saddle point.
//
// TOUCH POINTS. A leaf that drew nothing (the corners show no sign change, or every piece was a point) may still
// hold a zero H touches without crossing ((x - y)^2 = 0, x^2 + y^2 = 0). Its centre is moved by Newton steps along
// the gradient (the symbolic one from math/diff, compiled) toward H = 0, held in the leaf; where |H| / |grad H| ends
// under half a px, and |H| has come down with it (the estimate is small near a pole too, where it does not), it is a
// touch point. A leaf that shares a corner with a leaf that drew is not searched: the contour speaks for it (a dot
// beside a curve, at its cusp, at a singular point the corners cannot see, would be wrong). Nor is a leaf on the edge of
// the clip box (the overscan, out of view: a curve that only grazes the box leaves such leaves with a zero beyond it). The
// touch points, and which are next to which (leaves that share a corner), are returned for chains.ts to join.
//
// KNOWN LIMITS, all of a leaf's size (1.2 px at FULL, 4.7 at COARSE) and none of them a false connection:
//  - what the corners cannot show. Two crossings on one edge cancel, so a node where two curves cross along the diagonals of
//    the leaves (sin x = cos y) has no leaf with four crossings, and the chord that cuts its corner misses the node by up
//    to half a leaf; the lattice is drawn as the boundary of its cells, not as straight lines through the nodes.
//  - a leaf that holds a pole, a jump or an undefined point, or has an undefined corner, is left blank, so a curve that
//    ends there (the plateaus of floor(x) = y, the start of y = sqrt(x) when the origin is inside a leaf) stops a leaf short.
//  - a T where a curve meets a zero edge is joined at a corner of the edge, not at the point where it meets it.
//
// COST. Every evaluation is counted on the caller's counter: points for the scalar (H, and each gradient component),
// intervals for the twin. A leaf costs one corner evaluation (corners are shared by four leaves), about 15 for each
// crossing on it, a twin evaluation if its verdict is not CONTINUOUS, and for a pole the chase, about 40 more. The
// optional budget is a spend counted from the call's start, checked before each leaf: past it the remaining leaves
// are left alone and the result says it was capped.
import { type CompiledFn, compileScalar } from '../../math/compile'
import { gradient } from '../../math/diff'
import { CompileError } from '../../math/errors'
import { CONTINUOUS, type CompiledInterval, compileInterval, type Iv, iv, PARTIAL, UNKNOWN } from '../../math/interval'
import type { MathScope } from '../../math/scope'
import type { Expr } from '../../parser/types'
import type { Vec2 } from '../../scene/types'
import type { EvalCounter, PxScale } from '../sample/types'
import { CONTOUR, TOUCH } from './tuning'
import type { Box, Leaf, Segment } from './types'

// What the contouring evaluates: H, its twin over a box (the twin's contract: both boxes are passed), and the two
// partials of H, or null when the kernel has no rule for one of them (gamma, choose, perm: a CompileError), in which
// case touch points cannot be told and are not looked for (stats.touchUnchecked says how many leaves were left).
export interface ContourFns {
  H: CompiledFn
  Hi: CompiledInterval
  grad: readonly [CompiledFn, CompiledFn] | null
}

export function compileContour(h: Expr, scope: MathScope): ContourFns {
  const H = compileScalar(h, ['x', 'y'], scope)
  const Hi = compileInterval(h, ['x', 'y'], scope)
  let grad: readonly [CompiledFn, CompiledFn] | null = null
  try {
    const [gx, gy] = gradient(h, ['x', 'y'], scope)
    grad = [compileScalar(gx, ['x', 'y'], scope), compileScalar(gy, ['x', 'y'], scope)]
  } catch (err) {
    if (!(err instanceof CompileError)) throw err
  }
  return { H, Hi, grad }
}

// What a contouring did, for the caller's notes and the corpus. `crossings` counts roots located by bisection (an edge
// is located once, whichever leaf asks); `poles`, `jumps` and `undefinedEdges` the sign changes that were rejected;
// `saddles` the leaves whose four edges all crossed and `crosses` those drawn as an X.
export interface ContourStats {
  leaves: number
  corners: number
  definedCorners: number
  undefinedLeaves: number
  crossings: number
  poles: number
  jumps: number
  undefinedEdges: number
  saddles: number
  crosses: number
  touchCandidates: number
  touchPoints: number
  touchUnchecked: number
}

export function newStats(): ContourStats {
  return { leaves: 0, corners: 0, definedCorners: 0, undefinedLeaves: 0, crossings: 0, poles: 0, jumps: 0, undefinedEdges: 0, saddles: 0, crosses: 0, touchCandidates: 0, touchPoints: 0, touchUnchecked: 0 }
}

// A corner of the grid with the value of H there, and the point it is (kept, so that pieces that end at an exact zero
// share one object).
export interface Corner {
  x: number
  y: number
  v: number
  key: string
  pt: Vec2
}

// A located crossing, or why a sign change was not one. 'pole': H blows up across it. 'jump': H is discontinuous
// across it. 'undefined': H is undefined at a point of the edge.
export type CrossingResult = { ok: true; x: number; y: number } | { ok: false; why: 'pole' | 'jump' | 'undefined' }

// The crossings of H along leaf edges, cached by the edge. One per condition: the contouring of a curve makes one, and
// the region stage makes one for each comparison of its condition.
export class Crossings {
  private readonly corners = new Map<string, Corner>()
  private readonly edges = new Map<string, CrossingResult>()
  private readonly out: Iv = iv()
  private readonly fns: Pick<ContourFns, 'H' | 'Hi'>
  private readonly px: PxScale
  private readonly counter: EvalCounter
  readonly stats: ContourStats

  constructor(fns: Pick<ContourFns, 'H' | 'Hi'>, px: PxScale, counter: EvalCounter, stats: ContourStats = newStats()) {
    this.fns = fns
    this.px = px
    this.counter = counter
    this.stats = stats
  }

  // H at (x, y), evaluated once however many leaves ask.
  corner(x: number, y: number): Corner {
    const key = `${x},${y}`
    const known = this.corners.get(key)
    if (known) return known
    const v = this.fns.H(x, y)
    this.counter.points++
    this.stats.corners++
    if (v === v) this.stats.definedCorners++
    const c: Corner = { x, y, v, key, pt: { x, y } }
    this.corners.set(key, c)
    return c
  }

  // The crossing on the edge between two corners that share a coordinate, or null when there is no sign change (the
  // same sign at both ends, or a NaN). `continuous` says the twin has proved H continuous over the edge (a leaf of
  // the edge has verdict CONTINUOUS), so there is no pole or jump to look for. The answer is the same object whichever
  // way the edge is given, and whichever leaf asks first.
  crossing(a: Corner, b: Corner, continuous: boolean): CrossingResult | null {
    const sameSide = a.v >= 0 === b.v >= 0
    if (!(a.v === a.v && b.v === b.v) || sameSide) return null
    const swap = a.x > b.x || (a.x === b.x && a.y > b.y)
    const p = swap ? b : a
    const q = swap ? a : b
    const key = `${p.key}|${q.key}`
    const known = this.edges.get(key)
    if (known) return known
    const made = this.locate(p, q, continuous)
    this.edges.set(key, made)
    return made
  }

  private enclose(horizontal: boolean, fixed: number, lo: number, hi: number): Iv {
    this.counter.intervals++
    if (horizontal) this.fns.Hi(this.out, lo, hi, fixed, fixed)
    else this.fns.Hi(this.out, fixed, fixed, lo, hi)
    return this.out
  }

  // p is the end with the smaller (x, y); the signs at the ends differ and neither is NaN.
  private locate(p: Corner, q: Corner, continuous: boolean): CrossingResult {
    const plus = p.v >= 0 ? p : q
    // an exact zero at the + end is the crossing: the zero set meets the edge there
    if (plus.v === 0) return { ok: true, x: plus.x, y: plus.y }
    const { H } = this.fns
    const horizontal = p.y === q.y
    const fixed = horizontal ? p.y : p.x
    const plusLo = p.v >= 0
    let lo = horizontal ? p.x : p.y
    let hi = horizontal ? q.x : q.y
    let vlo = p.v
    let vhi = q.v
    const lenPx = (hi - lo) * (horizontal ? this.px.x : this.px.y)

    // The bracket [lo, hi] keeps the sign change. 'undefined': H is NaN at a midpoint. 'narrow': the doubles can not halve
    // it again.
    const bisect = (steps: number): 'ok' | 'undefined' | 'narrow' => {
      for (let i = 0; i < steps; i++) {
        const mid = (lo + hi) / 2
        if (!(mid > lo && mid < hi)) return 'narrow'
        const vm = horizontal ? H(mid, fixed) : H(fixed, mid)
        this.counter.points++
        if (vm !== vm) return 'undefined'
        const sameAsLo = vm >= 0 === plusLo
        if (sameAsLo) {
          lo = mid
          vlo = vm
        } else {
          hi = mid
          vhi = vm
        }
      }
      return 'ok'
    }
    const root = (): CrossingResult => {
      // an exact zero found on the way is the root; else the middle of the bracket
      const r = vhi === 0 ? hi : vlo === 0 ? lo : (lo + hi) / 2
      this.stats.crossings++
      return horizontal ? { ok: true, x: r, y: fixed } : { ok: true, x: fixed, y: r }
    }
    const reject = (why: 'pole' | 'jump' | 'undefined'): CrossingResult => {
      if (why === 'pole') this.stats.poles++
      else if (why === 'jump') this.stats.jumps++
      else this.stats.undefinedEdges++
      return { ok: false, why }
    }

    const steps = Math.min(CONTOUR.maxBisect, Math.max(1, Math.ceil(Math.log2(lenPx / CONTOUR.bisectPx))))
    let status = bisect(steps)
    if (status === 'undefined') return reject('undefined')
    if (continuous) return root()

    // not proved continuous: ask the twin about the bracket
    const first = this.enclose(horizontal, fixed, lo, hi)
    if (first.v === CONTINUOUS || first.v === UNKNOWN) return root()
    // The chase: the bracket narrows to machine width, the twin asked again every chaseCheck steps. A root is let go the
    // moment the twin proves its bracket continuous.
    const j0 = Math.abs(vhi - vlo)
    let left = CONTOUR.maxChase
    let last = first
    while (left > 0 && status !== 'narrow') {
      const n = Math.min(CONTOUR.chaseCheck, left)
      status = bisect(n)
      if (status === 'undefined') return reject('undefined')
      left -= n
      last = this.enclose(horizontal, fixed, lo, hi)
      if (last.v === CONTINUOUS) return root()
    }
    if (last.v === PARTIAL && (last.lo === -Infinity || last.hi === Infinity)) return reject('pole')
    // the twin proves nothing (a seam, a loose enclosure of a dip): H must be continuous across the bracket
    const j1 = Math.abs(vhi - vlo)
    if (!(j1 <= CONTOUR.jumpShrink * j0)) return reject('jump')
    return root()
  }
}

// A point where the zero set touches a leaf without a sign change: the point, and |H| / |grad H| there in px.
export interface TouchPoint {
  x: number
  y: number
  est: number
}

export interface ContourView {
  px: PxScale
  // the overscan box: pieces are clipped to it (the leaves of a quadtree lie inside it already)
  clip: Box
}

// The most a contouring may spend, counted from where the counter stood when the call began.
export interface ContourBudget {
  points: number
  intervals: number
}

export interface ContourResult {
  segments: Segment[]
  touches: TouchPoint[]
  // pairs of indices into `touches`: the leaves of the two touch points share a corner
  touchLinks: [number, number][]
  stats: ContourStats
  // the budget ran out: the leaves not reached are missing from the contour
  capped: boolean
}

type LeafKind = 'drew' | 'candidate' | 'none'

function inside(p: Vec2, c: Box): boolean {
  return p.x >= c.x0 && p.x <= c.x1 && p.y >= c.y0 && p.y <= c.y1
}

// The part of the segment inside the box (Liang-Barsky), or null.
function clipSegment(a: Vec2, b: Vec2, c: Box): [Vec2, Vec2] | null {
  if (inside(a, c) && inside(b, c)) return [a, b]
  const dx = b.x - a.x
  const dy = b.y - a.y
  let t0 = 0
  let t1 = 1
  const ps = [-dx, dx, -dy, dy]
  const qs = [a.x - c.x0, c.x1 - a.x, a.y - c.y0, c.y1 - a.y]
  for (let i = 0; i < 4; i++) {
    if (ps[i] === 0) {
      if (qs[i] < 0) return null
    } else {
      const t = qs[i] / ps[i]
      if (ps[i] < 0) t0 = Math.max(t0, t)
      else t1 = Math.min(t1, t)
    }
  }
  if (!(t0 < t1)) return null
  return [t0 === 0 ? a : { x: a.x + t0 * dx, y: a.y + t0 * dy }, t1 === 1 ? b : { x: a.x + t1 * dx, y: a.y + t1 * dy }]
}

// The pieces of the zero set in `leaves`, and the touch points. The leaves are those of subdivide: one size, meeting
// edge to edge on equal coordinates.
export function contourLeaves(leaves: readonly Leaf[], fns: ContourFns, view: ContourView, counter: EvalCounter, budget?: ContourBudget): ContourResult {
  const stats = newStats()
  const cr = new Crossings(fns, view.px, counter, stats)
  const segments: Segment[] = []
  const seen = new Set<string>()
  const startPoints = counter.points
  const startIntervals = counter.intervals
  const over = () => budget !== undefined && (counter.points - startPoints >= budget.points || counter.intervals - startIntervals >= budget.intervals)

  // A piece from a to b, clipped, once however many leaves hold it. True when it is a piece (not a point).
  const emit = (a: Vec2, b: Vec2): boolean => {
    if (a.x === b.x && a.y === b.y) return false
    const clipped = clipSegment(a, b, view.clip)
    if (!clipped) return true
    const [p, q] = clipped
    if (!(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(q.x) && Number.isFinite(q.y))) return true
    const forward = p.x < q.x || (p.x === q.x && p.y < q.y)
    const key = forward ? `${p.x},${p.y}|${q.x},${q.y}` : `${q.x},${q.y}|${p.x},${p.y}`
    if (seen.has(key)) return true
    seen.add(key)
    segments.push({ a: p, b: q })
    return true
  }

  const kinds = new Uint8Array(leaves.length) // 0 none, 1 drew, 2 candidate
  let capped = false
  for (let i = 0; i < leaves.length; i++) {
    if (over()) {
      capped = true
      break
    }
    stats.leaves++
    const k = contourLeaf(leaves[i], cr, stats, emit)
    kinds[i] = k === 'drew' ? 1 : k === 'candidate' ? 2 : 0
  }

  const touches: TouchPoint[] = []
  const touchLinks: [number, number][] = []
  let candidates = 0
  for (let i = 0; i < kinds.length; i++) if (kinds[i] === 2) candidates++
  stats.touchCandidates = candidates
  if (candidates > 0) {
    if (!fns.grad) {
      stats.touchUnchecked = candidates
    } else if (touchStage(leaves, kinds, fns.H, fns.grad, view.px, view.clip, counter, touches, touchLinks, over)) {
      capped = true
    }
  }
  stats.touchPoints = touches.length
  return { segments, touches, touchLinks, stats, capped }
}

// The leaves of the contour that meet each corner: the grid's own adjacency, exact because the leaves share coordinates.
function cornerIndex(leaves: readonly Leaf[]): Map<string, number[]> {
  const map = new Map<string, number[]>()
  const add = (key: string, i: number) => {
    const list = map.get(key)
    if (list) list.push(i)
    else map.set(key, [i])
  }
  leaves.forEach((l, i) => {
    add(`${l.x0},${l.y0}`, i)
    add(`${l.x1},${l.y0}`, i)
    add(`${l.x1},${l.y1}`, i)
    add(`${l.x0},${l.y1}`, i)
  })
  return map
}

function cornerKeysOf(l: Leaf): string[] {
  return [`${l.x0},${l.y0}`, `${l.x1},${l.y0}`, `${l.x1},${l.y1}`, `${l.x0},${l.y1}`]
}

function touchStage(
  leaves: readonly Leaf[],
  kinds: Uint8Array,
  H: CompiledFn,
  grad: readonly [CompiledFn, CompiledFn],
  px: PxScale,
  clip: Box,
  counter: EvalCounter,
  touches: TouchPoint[],
  links: [number, number][],
  over: () => boolean,
): boolean {
  const index = cornerIndex(leaves)
  const touchOf = new Map<number, number>()
  let cut = false
  for (let i = 0; i < leaves.length; i++) {
    if (kinds[i] !== 2) continue
    // A leaf on the edge of the clip box is not searched: a curve that only grazes the box (the tip of an ellipse a px
    // inside it, the cap of which is outside) leaves its nearest leaves with no sign change and no drawn neighbour, and
    // the zero set the iterate runs to is beyond the box. The box is the overscan: nothing there is in view.
    const l = leaves[i]
    if (l.x0 <= clip.x0 || l.x1 >= clip.x1 || l.y0 <= clip.y0 || l.y1 >= clip.y1) continue
    // the contour speaks for a leaf that shares a corner with a leaf that drew
    if (cornerKeysOf(l).some((key) => (index.get(key) ?? []).some((j) => kinds[j] === 1))) continue
    if (over()) {
      cut = true
      break
    }
    const t = touchPoint(leaves[i], H, grad, px, counter)
    if (!t) continue
    touchOf.set(i, touches.length)
    touches.push(t)
  }
  // two leaves that share an edge share two corners: one link
  const linked = new Set<string>()
  for (const [i, ti] of touchOf) {
    for (const key of cornerKeysOf(leaves[i])) {
      for (const j of index.get(key) ?? []) {
        const tj = touchOf.get(j)
        if (tj === undefined || tj <= ti || linked.has(`${ti}:${tj}`)) continue
        linked.add(`${ti}:${tj}`)
        links.push([ti, tj])
      }
    }
  }
  return cut
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

// Newton steps from the leaf centre toward H = 0 along the gradient, held in the leaf. |H| / |grad H| (per px) at the
// last iterate is the first-order distance to the zero set: under TOUCH.maxPx, the leaf touches it.
function touchPoint(leaf: Leaf, H: CompiledFn, grad: readonly [CompiledFn, CompiledFn], px: PxScale, counter: EvalCounter): TouchPoint | null {
  let x = (leaf.x0 + leaf.x1) / 2
  let y = (leaf.y0 + leaf.y1) / 2
  let est = Infinity
  let first = 0
  let last = 0
  for (let step = 0; ; step++) {
    const h = H(x, y)
    const gx = grad[0](x, y)
    const gy = grad[1](x, y)
    counter.points += 3
    if (!Number.isFinite(h)) return null
    // an exact zero is a point of the zero set whatever the gradient there (a singular point has none)
    if (h === 0) return { x, y, est: 0 }
    const gn = Math.hypot(gx / px.x, gy / px.y)
    if (!(gn > 0 && gn < Infinity)) return null
    est = Math.abs(h) / gn
    if (step === 0) first = Math.abs(h)
    last = Math.abs(h)
    if (est <= TOUCH.convergedPx || step === TOUCH.steps) break
    const g2 = gx * gx + gy * gy
    const nx = clamp(x - (h * gx) / g2, leaf.x0, leaf.x1)
    const ny = clamp(y - (h * gy) / g2, leaf.y0, leaf.y1)
    if (nx === x && ny === y) break
    x = nx
    y = ny
  }
  // |H| / |grad H| is small near a pole too (H is large and its gradient larger): the iterates of a zero make |H| fall
  if (!(est < TOUCH.maxPx && (est <= TOUCH.convergedPx || last <= TOUCH.descent * first))) return null
  return { x, y, est }
}

// One leaf. The corners c0..c3 run counter-clockwise from (x0, y0); edge k joins corner k to corner k + 1.
function contourLeaf(leaf: Leaf, cr: Crossings, stats: ContourStats, emit: (a: Vec2, b: Vec2) => boolean): LeafKind {
  const c = [cr.corner(leaf.x0, leaf.y0), cr.corner(leaf.x1, leaf.y0), cr.corner(leaf.x1, leaf.y1), cr.corner(leaf.x0, leaf.y1)]
  for (const k of c) {
    if (k.v !== k.v) {
      stats.undefinedLeaves++
      return 'none'
    }
  }
  let drew = false
  const piece = (a: Vec2, b: Vec2) => {
    if (emit(a, b)) drew = true
  }
  // An edge whose two ends are exact zeros is on the zero set (H is linear between them in the interpolant, and zero at
  // both): it is a piece, whichever signs the leaf has (the axis of xy = 0 beside a leaf that is positive all through,
  // the double line y^2 = 0). A leaf of zeros throughout is a plateau, not a curve, and has no edges of its own.
  if (!c.every((k) => k.v === 0)) {
    for (let k = 0; k < 4; k++) if (c[k].v === 0 && c[(k + 1) % 4].v === 0) piece(c[k].pt, c[(k + 1) % 4].pt)
  }

  const s = [c[0].v >= 0, c[1].v >= 0, c[2].v >= 0, c[3].v >= 0]
  if (s[0] === s[1] && s[1] === s[2] && s[2] === s[3]) return drew ? 'drew' : 'candidate'

  const continuous = leaf.verdict === CONTINUOUS
  const x: (Vec2 | null)[] = [null, null, null, null]
  let n = 0
  for (let k = 0; k < 4; k++) {
    const next = (k + 1) % 4
    if (s[k] === s[next]) continue
    const r = cr.crossing(c[k], c[next], continuous)
    // a pole, a jump or an undefined point on an edge: nothing more is drawn in this leaf
    if (!r || !r.ok) return drew ? 'drew' : 'none'
    x[k] = r
    n++
  }

  if (n === 2) {
    const edges = [0, 1, 2, 3].filter((k) => x[k] !== null)
    const [a, b] = edges
    // the corners a + 1 .. b and b + 1 .. a (cyclic) are the two runs; the + run is cut off by the piece
    const first = s[(a + 1) % 4] ? a + 1 : b + 1
    const before = s[(a + 1) % 4] ? a : b
    const after = s[(a + 1) % 4] ? b : a
    const length = s[(a + 1) % 4] ? b - a : a + 4 - b
    const run: Corner[] = []
    for (let i = 0; i < length; i++) run.push(c[(first + i) % 4])
    let path: Vec2[] = [x[before] as Vec2, x[after] as Vec2]
    if (run.every((k) => k.v === 0)) {
      // where every corner of the run is an exact zero the zero set follows the edges between them
      path = [x[before] as Vec2, ...run.map((k) => k.pt), x[after] as Vec2]
    } else if (run.length === 3 && run[1].v === 0 && (run[0].v === 0) !== (run[2].v === 0)) {
      // A zero edge (z1, z2) and a strict + corner s at one end of the run: a curve that meets the zero edge, a T. The
      // zero edge is a piece of its own (above); the curve is joined to the end of it nearer where it leaves it, the
      // strict corner's end if the crossing on the edge s - m is in the half nearer s.
      const sFirst = run[0].v !== 0
      const strict = sFirst ? run[0] : run[2]
      const m = c[(first + 3) % 4]
      const cross = (sFirst ? x[before] : x[after]) as Vec2
      const t = Math.hypot(cross.x - strict.x, cross.y - strict.y) / Math.hypot(m.x - strict.x, m.y - strict.y)
      // run[1] is the zero corner next to the strict one
      const end = t < 0.5 ? run[1] : sFirst ? run[2] : run[0]
      path = sFirst ? [cross, end.pt] : [end.pt, cross]
    }
    for (let i = 0; i + 1 < path.length; i++) piece(path[i], path[i + 1])
  } else {
    stats.saddles++
    const f = c.map((k) => k.v)
    let cross = false
    let saddleInPlus = false
    let sx = 0
    let sy = 0
    if (f.every((v) => Number.isFinite(v))) {
      const m = Math.max(...f.map(Math.abs))
      const [g0, g1, g2, g3] = f.map((v) => v / m)
      const d = g0 - g1 + g2 - g3
      const saddle = (g0 * g2 - g1 * g3) / d
      if (Math.abs(saddle) <= CONTOUR.crossRel) {
        cross = true
        sx = leaf.x0 + clamp((g0 - g3) / d, 0, 1) * (leaf.x1 - leaf.x0)
        sy = leaf.y0 + clamp((g0 - g1) / d, 0, 1) * (leaf.y1 - leaf.y0)
      } else saddleInPlus = saddle > 0
    }
    if (cross) {
      stats.crosses++
      const centre: Vec2 = { x: sx, y: sy }
      for (let k = 0; k < 4; k++) piece(x[k] as Vec2, centre)
    } else {
      // the region the saddle point lies in is the one that is joined; the pieces cut off the corners of the other
      for (let i = 0; i < 4; i++) {
        if (s[i] === saddleInPlus) continue
        piece(x[(i + 3) % 4] as Vec2, x[i] as Vec2)
      }
    }
  }
  return drew ? 'drew' : 'candidate'
}
