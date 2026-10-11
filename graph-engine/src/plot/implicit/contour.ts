// Contouring a leaf (calc P3, task 3): where the zero set of H = F - G crosses each leaf of the quadtree, as
// straight pieces whose ends lie ON the zero set, so that the chains built from them (chains.ts) are certified.
//
//   const fns = compileContour(h, scope)                       // H, its twin, its gradient and Hessian
//   const { segments, touches, touchLinks, stats, capped, refused } = contourLeaves(leaves, fns, { px, clip }, counter, budget?)
//   const chains = buildChains(segments, px)                    // chains.ts
//   const { chains: touchChains, points } = buildTouchCurves(touches, touchLinks, px)
//
// RULE 1 holds here: nothing is connected unless it is certified. A piece joins two points that are each a zero of H
// found on a leaf edge, or a corner where H is exactly zero, or the certified centre of a crossing, and a piece is never
// drawn across a pole, a jump or an undefined stretch (below).
//
// CORNERS. H is the scalar compile, evaluated once at each distinct corner (cached by its exact coordinates). A corner is
// + when H >= 0 (an exact zero, signed or not, counts as +), - when H < 0, and undefined when H is NaN.
//
// EDGES (Crossings). Each leaf edge has the list of its roots, kept in a cache by the edge's end coordinates, so the leaf on
// the other side is handed the very same points (the region stage reuses the class for each of a condition's comparisons).
//  - A sign change between the ends is located by BISECTION on H along the edge, never by interpolation, to 2^-12 px
//    (CONTOUR.bisectPx). Where the + end is exactly zero the root IS that corner.
//  - A leaf whose twin verdict is CONTINUOUS needs no check. For the rest, the twin is asked about the bracket the bisection
//    ended with: CONTINUOUS, a root. Otherwise the bisection goes on to machine width, asking again as it goes: a bracket
//    still PARTIAL with an infinite bound there holds a pole; one whose twin says nothing (DEFINED: floor, mod, a seam)
//    is a root only if |H(hi) - H(lo)| has shrunk with the bracket (CONTOUR.jumpShrink), which a jump's does not. A UNKNOWN
//    twin (an integral) says nothing, and the scalar sign change stands. A pole or a jump is not a root: the edge has no
//    root there (and the leaf is not searched for touch points).
//  - An edge with an undefined end is cut at the domain edge, found by bisecting on whether H is defined, to machine width; the
//    defined part is tested as an ordinary edge (y = ln x reaches the bottom of the view beside x = 0).
//  - In a leaf not proven continuous, an edge that shows no sign change is asked of the twin once; if it is PARTIAL it is
//    subdivided by the twin down to CONTOUR.gapPx, which finds its poles and undefined points as gaps, and each stretch between
//    gaps is tested as an ordinary edge (a curve beside a pole in the same leaf: y = 1/x far from the origin, tan x at COARSE).
//    The twin's discard rule ends the subdivision where it can hold no zero (an enclosure above zero, below it or empty is a stretch with no
//    root, proved or not), and an edge that is infinite at both ends AND at its middle (it lies on a pole line, x = 0 for 1/x) is not looked
//    into at all (infinite at the ends alone is not a pole line: signed zero makes 1/(x - h) +infinity at x = h, so 1/x + 1/(x - h) - y has
//    a branch between two poles on adjacent grid lines whose edge is +inf at both ends).
//
//  - Where an edge is cut is kept for the region stage (EdgeInfo.stops): the last defined point of an edge with an undefined end, the
//    middle of the bracket of a pole or jump the bisection settled on, the middle of a gap the twin narrowed to a point. An edge the twin
//    calls PARTIAL whose enclosure excludes zero is not looked into, and says it holds something it did not locate (`lost`) unless the
//    only reason is a pole at an end of it (H is infinite there and the twin proves the rest defined: ln x - y along x = 0).
//
// PIECES. Two roots make one piece. In the classic configuration (every corner defined, a root on each edge whose ends differ)
// the sign pattern says which: the piece cuts off the + run's corners. An edge whose two ends are exact zeros and whose
// midpoint is exactly zero too is a piece whatever the signs of the leaf (the axes of xy = 0, the double line y^2 = 0 on a
// grid line), unless all four corners are zero (a plateau). Where a curve meets such a zero edge (a T) it is joined to the
// end of the edge nearer where it leaves it. Otherwise the piece is the chord between the two roots. Four roots are paired by
// the ASYMPTOTIC DECIDER: the bilinear interpolant's value at its saddle point says whether the + corners are joined (the
// pieces then cut off the - corners) or the - ones; when that value is within CONTOUR.crossRel of the largest corner value
// the leaf may hold an X, and draws it if it is certified. Where roots are not one to an edge (two arms of a crossing leave
// the leaf through the same edge, which shows no sign change) the four roots are paired by the sign of H at the leaf centre.
// In a leaf the twin did not prove DEFINED or CONTINUOUS, a piece is drawn only if the twin over its bounding box is not
// PARTIAL, so a chord never crosses an undefined strip. In a leaf whose twin is UNKNOWN (an integral in H: every enclosure says
// nothing) the twin cannot vouch for a box, and H must be defined at CONTOUR.chordSamples points along the piece.
//
// CRITICAL POINTS. Where two curves cross along the diagonals of the leaves the corners show no sign change at all (sin x =
// cos y has none to pair). A leaf where BOTH partials of H change sign over its corners (the partials are read at the corners,
// counted) holds a critical point: Newton's steps on grad H = 0 from the leaf centre, held in the leaf, find it, and it is
// a crossing if the Hessian is indefinite. Its arms run along the roots of the Hessian's quadratic form. It is certified by
// H at CRITICAL.probePx (half a px) from the centre along the bisector of each pair of adjacent arms: the four signs must
// alternate, which puts the centre within half a px of both curves (two branches that only pass near each other do not
// alternate). Each arm is then followed out of the leaf: bisection of H along the leaf boundary between the points where the
// adjacent bisectors leave it gives the root where the arm leaves. The roots are put in the edge cache before any leaf is
// contoured, so that when two arms leave through the same edge both are there, and the neighbour pairs its four roots (never
// the two arms of one crossing with each other). This pass is a leaf's first claim: a leaf whose critical point is certified
// draws its X from it. Every X, whether found this way or from the saddle of the corners, is certified; one that is not is
// drawn as the two arcs.
//  - A node that comes to rest on an edge or corner of the leaf (within CRITICAL.edgeTolPx: a crossing on a grid line, y = 0 in the
//    default view) is snapped onto it and solved ONCE, in the box of the 2 or 4 leaves that share it: the box is a leaf, bigger,
//    the arms leave by its boundary (the edges of its leaves), the roots are registered there, and the edges inside the box need no
//    root (an arm begins on one). Each leaf of the box draws the arms that leave by its own edges, from the one node object. A
//    box with a leaf missing, or of leaves of unlike size, or with a corner on its boundary where H is exactly zero (those are the
//    corners' own: the zero edges and the roots at corners), is left to the leaves one by one.
//
// TOUCH POINTS. A leaf that drew nothing (the corners show no sign change, or every piece was a point) may still hold a zero H
// touches without crossing ((x - y)^2 = 0, x^2 + y^2 = 0). Its centre is moved by Newton steps along the gradient (the symbolic
// one from math/diff, compiled) toward H = 0, held in the leaf; where |H| / |grad H| ends under half a px, and |H| has come
// down with it (the estimate is small near a pole too, where it does not), it is a touch point. A leaf that shares a corner
// with a leaf that drew is not searched: the contour speaks for it (a dot beside a curve, at its cusp, would be wrong). Nor is a
// leaf on the edge of the clip box (the overscan, out of view: a curve that only grazes the box leaves such leaves with a zero
// beyond it), or one with a pole or an undefined point on its edges. The touch points, and which are next to which (leaves that
// share a corner), are returned for chains.ts to join.
//
// LEAF SIZE. A leaf the quadtree stopped halving only because the budget ran out ('budget') and is wider than
// CONTOUR.maxBudgetLeafPx is not contoured: a chord across it is not the curve. `refused` is true when any leaf was left out.
//
// KNOWN LIMITS, all of a leaf's size (1.2 px at FULL, 4.7 at COARSE) and none of them a false connection:
//  - a leaf that holds a jump, or whose roots do not pair (an odd number: a curve that ends in the leaf at a jump or a domain
//    edge) draws nothing, so the plateaus of floor(x) = y and the start of y = sqrt(x) stop a leaf short.
//  - two arms that leave a leaf through one edge and the leaf beyond through one edge again (arms nearly parallel) are not followed
//    past the first leaf; two arms that arrive together and leave the leaf by no edge that shows are not joined to each other.
//  - a T where a curve meets a zero edge is joined at a corner of the edge, not at the point where it meets it.
//  - a crossing a hair outside the clip box joins its two lines by a U-turn at the box's edge, in the overscan; a crossing at a grid
//    corner where H is exactly zero on the box boundary (y^2 = x^2 at the origin, lines through the corners of the box) is the corners'
//    own, and so is one whose box is missing a leaf.
//  - H at the points along a piece is how a UNKNOWN leaf is checked: a strip narrower than the gap between them is not seen.
//  - a sign change is a pole only if the bisection settles on it: an edge with a pole and two roots on one side shows no sign change there.
//
// COST. Every evaluation is counted on the caller's counter: points for the scalar (H, each partial, each second partial),
// intervals for the twin. A leaf costs one corner evaluation and two for the partials there (corners are shared by four
// leaves), about 15 for each root on it, a twin evaluation if its verdict is not CONTINUOUS, and for a pole the chase, about
// 30 more. The optional budget is a spend counted from the call's start, checked before each leaf: past it the remaining
// leaves are left alone and the result says it was capped.
import { type CompiledFn, compileScalar } from '../../math/compile'
import { gradient } from '../../math/diff'
import { CompileError } from '../../math/errors'
import { CONTINUOUS, type CompiledInterval, compileInterval, DEFINED, type Iv, iv, PARTIAL, UNKNOWN, type Verdict } from '../../math/interval'
import type { MathScope } from '../../math/scope'
import type { Expr } from '../../parser/types'
import type { Vec2 } from '../../scene/types'
import type { EvalCounter, PxScale } from '../sample/types'
import { CONTOUR, CRITICAL, TOUCH } from './tuning'
import type { Box, Leaf, Segment } from './types'

// What the contouring evaluates: H, its twin over a box (the twin's contract: both boxes are passed), the two partials of H, and the
// three second partials (xx, xy, yy), each null when the kernel has no rule for one of them (gamma, choose, perm: a CompileError). With
// no partials touch points cannot be told and are not looked for (stats.touchUnchecked says how many leaves were left); with no second
// partials the critical points of crossings are not looked for, and the leaves draw crossings from the saddles of their corners.
export interface ContourFns {
  H: CompiledFn
  Hi: CompiledInterval
  grad: readonly [CompiledFn, CompiledFn] | null
  hess: readonly [CompiledFn, CompiledFn, CompiledFn] | null
}

export function compileContour(h: Expr, scope: MathScope): ContourFns {
  const H = compileScalar(h, ['x', 'y'], scope)
  const Hi = compileInterval(h, ['x', 'y'], scope)
  let grad: readonly [CompiledFn, CompiledFn] | null = null
  let hess: readonly [CompiledFn, CompiledFn, CompiledFn] | null = null
  try {
    const [gx, gy] = gradient(h, ['x', 'y'], scope)
    grad = [compileScalar(gx, ['x', 'y'], scope), compileScalar(gy, ['x', 'y'], scope)]
    try {
      const [hxx, hxy] = gradient(gx, ['x', 'y'], scope)
      const [, hyy] = gradient(gy, ['x', 'y'], scope)
      hess = [compileScalar(hxx, ['x', 'y'], scope), compileScalar(hxy, ['x', 'y'], scope), compileScalar(hyy, ['x', 'y'], scope)]
    } catch (err) {
      if (!(err instanceof CompileError)) throw err
    }
  } catch (err) {
    if (!(err instanceof CompileError)) throw err
  }
  return { H, Hi, grad, hess }
}

// What a contouring did, for the caller's notes and the corpus. `crossings` counts roots located by bisection (an edge is located once,
// whichever leaf asks); `poles`, `jumps` and `undefinedEdges` the sign changes that were rejected; `gaps` the edges that were cut at a
// domain edge or subdivided to find a pole; `saddles` the leaves with four arms and `crosses` those drawn as an X, `critical` of which
// were found from a critical point; `chordsRejected` the pieces the twin would not vouch for; `oversized` the 'budget' leaves left out.
export interface ContourStats {
  leaves: number
  corners: number
  definedCorners: number
  undefinedLeaves: number
  crossings: number
  poles: number
  jumps: number
  undefinedEdges: number
  gaps: number
  saddles: number
  crosses: number
  critical: number
  chordsRejected: number
  oversized: number
  touchCandidates: number
  touchPoints: number
  touchUnchecked: number
}

export function newStats(): ContourStats {
  return {
    leaves: 0,
    corners: 0,
    definedCorners: 0,
    undefinedLeaves: 0,
    crossings: 0,
    poles: 0,
    jumps: 0,
    undefinedEdges: 0,
    gaps: 0,
    saddles: 0,
    crosses: 0,
    critical: 0,
    chordsRejected: 0,
    oversized: 0,
    touchCandidates: 0,
    touchPoints: 0,
    touchUnchecked: 0,
  }
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
type Root = Extract<CrossingResult, { ok: true }>
type Rejected = Extract<CrossingResult, { ok: false }>

// The roots of one edge, in order from the end with the smaller (x, y) to the other; `fail` says a sign change that was not a root;
// `gap` that the edge holds a pole or an undefined stretch. `stops` are the places along the edge (its varying coordinate, in the
// same order as the roots) where H is cut: the domain edge (the last defined point of an edge with an undefined end), a pole the
// bisection settled on, a jump, a gap the twin narrowed to CONTOUR.gapPx: the region stage fills up to them. `lost` says the edge
// holds something undefined or unbounded that was NOT located (the twin said PARTIAL with an enclosure excluding zero, so the
// edge was not looked into, or a gap the subdivision gave up on was wider than a point): what is on the edge is not known to the
// leaf. (An edge ON a pole line, infinite all along, is neither: it is the pole.)
export interface EdgeInfo {
  roots: Root[]
  fail: Rejected | null
  gap: boolean
  stops: number[]
  lost: boolean
}

const NO_EDGE: EdgeInfo = { roots: [], fail: null, gap: false, stops: [], lost: false }

// The twin's discard rule (math/interval's contract): an enclosure above zero, below it, or empty holds no zero, whatever the verdict.
function excludesZero(z: Iv): boolean {
  return z.lo > 0 || z.hi < 0 || z.lo > z.hi
}

// The edges of the leaves, and the roots on them, cached by the edge. One per condition: the contouring of a curve makes one, and the
// region stage makes one for each comparison of its condition.
export class Crossings {
  private readonly corners = new Map<string, Corner>()
  private readonly edges = new Map<string, EdgeInfo>()
  private readonly zeros = new Map<string, boolean>()
  private readonly registered = new Set<string>()
  private readonly arms = new Set<object>()
  // the gaps (poles) found on recent edges, along x for the horizontal edges and along y for the vertical ones
  private readonly hintsX: [number, number][] = []
  private readonly hintsY: [number, number][] = []
  private readonly out: Iv = iv()
  private readonly fns: Pick<ContourFns, 'H' | 'Hi'>
  private readonly px: PxScale
  readonly counter: EvalCounter
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

  // H at a point that is not a corner: counted, not cached.
  value(x: number, y: number): number {
    this.counter.points++
    return this.fns.H(x, y)
  }

  // The verdict of the twin over a box: counted. An empty enclosure (undefined everywhere) is PARTIAL.
  verdictOver(x0: number, x1: number, y0: number, y1: number): Verdict {
    this.counter.intervals++
    this.fns.Hi(this.out, x0, x1, y0, y1)
    return this.out.v
  }

  private ends(a: Corner, b: Corner): { p: Corner; q: Corner; key: string; swapped: boolean } {
    const swapped = a.x > b.x || (a.x === b.x && a.y > b.y)
    const p = swapped ? b : a
    const q = swapped ? a : b
    return { p, q, key: `${p.key}|${q.key}`, swapped }
  }

  // Whether the edge may carry roots put there by register (a cheap test before building its key).
  maybeRegistered(a: Corner, b: Corner): boolean {
    return this.registered.size > 0 && this.registered.has(a.key) && this.registered.has(b.key)
  }

  // Whether the edge has been looked at or registered already.
  hasEdge(a: Corner, b: Corner): boolean {
    return this.edges.has(this.ends(a, b).key)
  }

  // Puts roots on an edge that has none yet (the arms of a crossing that leave a leaf by it: found there by the critical-point pass,
  // before any edge is looked at). `roots` runs from a to b. False if the edge is already known.
  register(a: Corner, b: Corner, roots: Root[]): boolean {
    const { key, swapped } = this.ends(a, b)
    if (this.edges.has(key)) return false
    this.edges.set(key, { roots: swapped ? [...roots].reverse() : roots, fail: null, gap: false, stops: [], lost: false })
    this.registered.add(a.key)
    this.registered.add(b.key)
    for (const r of roots) this.arms.add(r)
    return true
  }

  // Whether a root is the end of an arm of a crossing, put on its edge by register. Two arms of one crossing on one edge leave the leaf
  // beyond it by other edges: they are not to be joined to each other.
  isArm(r: Vec2): boolean {
    return this.arms.has(r)
  }

  // Whether the edge between two corners that are exact zeros is itself zero: H is zero at its midpoint too (the parabola
  // y = 1000 x (x - h) is zero at the two ends of [0, h] and nowhere between).
  zeroEdge(a: Corner, b: Corner): boolean {
    const { key } = this.ends(a, b)
    const known = this.zeros.get(key)
    if (known !== undefined) return known
    const ok = this.value((a.x + b.x) / 2, (a.y + b.y) / 2) === 0
    this.zeros.set(key, ok)
    return ok
  }

  // The roots on the edge between two corners that share a coordinate. `continuous` says the twin has proved H continuous over a leaf of
  // the edge (so over the edge: its closed box), so there is no pole or jump to look for. The answer is the same object whichever way
  // the edge is given, and whichever leaf asks first.
  edge(a: Corner, b: Corner, continuous: boolean): EdgeInfo {
    const { p, q, key } = this.ends(a, b)
    const known = this.edges.get(key)
    if (known) return known
    const made = this.analyse(p, q, continuous)
    // the stops of an edge are found as the walk finds them (a domain edge, then the roots' rejections): in order along the edge, as the roots are
    if (made.stops.length > 1) made.stops.sort((s, t) => s - t)
    this.edges.set(key, made)
    return made
  }

  // The root on an edge whose ends differ in sign (the first, if there is more than one), the reason it is not one, or null where there is
  // no sign change (the same sign at both ends, or a NaN).
  crossing(a: Corner, b: Corner, continuous: boolean): CrossingResult | null {
    const sameSide = a.v >= 0 === b.v >= 0
    if (!(a.v === a.v && b.v === b.v) || sameSide) return null
    const info = this.edge(a, b, continuous)
    if (info.roots.length > 0) return info.roots[0]
    return info.fail ?? { ok: false, why: 'pole' }
  }

  private enclose(horizontal: boolean, fixed: number, lo: number, hi: number): Iv {
    this.counter.intervals++
    if (horizontal) this.fns.Hi(this.out, lo, hi, fixed, fixed)
    else this.fns.Hi(this.out, fixed, fixed, lo, hi)
    return this.out
  }

  private at(horizontal: boolean, fixed: number, t: number): number {
    this.counter.points++
    return horizontal ? this.fns.H(t, fixed) : this.fns.H(fixed, t)
  }

  // A sign change that was not a root is a stop at the middle of the bracket the bisection ended with (locate says where).
  private stopAt: number | null = null

  private take(info: EdgeInfo, r: CrossingResult): void {
    if (r.ok) info.roots.push(r)
    else {
      info.fail = r
      info.gap = true
      if (this.stopAt !== null) info.stops.push(this.stopAt)
    }
    this.stopAt = null
  }

  // p is the end with the smaller (x, y).
  private analyse(p: Corner, q: Corner, continuous: boolean): EdgeInfo {
    const info: EdgeInfo = { roots: [], fail: null, gap: false, stops: [], lost: false }
    const horizontal = p.y === q.y
    const fixed = horizontal ? p.y : p.x
    const lo = horizontal ? p.x : p.y
    const hi = horizontal ? q.x : q.y
    const pn = p.v !== p.v
    const qn = q.v !== q.v
    if (!pn && !qn) {
      if (p.v >= 0 !== q.v >= 0) {
        // (A sign change that is a pole splits the edge there, and each side is tested, but the sides' ends agree: the bisection keeps the
        // ends' signs, so it can only settle on a pole that flips the sign the way the ends do, and then H at the pole's two sides has the
        // signs of the ends. A root beside it is a pair on its side, which no sign shows; the twin's subdivision, below, is for sign-less edges.)
        this.take(info, this.locate(horizontal, fixed, lo, hi, p.v, q.v, continuous))
        return info
      }
      if (continuous) return info
      // An edge infinite at both ends and at its middle lies on a pole line (x = 0 for 1/x - y): there is nothing on it, and the twin, which
      // takes a point box at a pole for [-inf, inf], would be asked down to the gap width at every level to say so. Infinite at its two ends is
      // not enough: signed zero makes 1/(x - h) +infinity AT x = h though it is -infinity just left of it, so an edge between two poles on
      // adjacent grid lines (1/x + 1/(x - h) - y) is +inf at both ends and changes sign between them. The middle is one counted scalar point.
      if (Math.abs(p.v) === Infinity && Math.abs(q.v) === Infinity && Math.abs(this.at(horizontal, fixed, (lo + hi) / 2)) === Infinity) {
        info.gap = true
        return info
      }
      // No sign change, and the twin has not proved the leaf continuous: a pole and a root beside it on this edge cancel in the
      // signs. The twin says whether there is anything to look for.
      const whole = this.enclose(horizontal, fixed, lo, hi)
      if (whole.v !== PARTIAL) return info
      // (a PARTIAL edge whose enclosure excludes zero has no root, and is not looked into: but it holds a pole or an undefined stretch,
      // which the leaf is told of, and told it was not located: `lost`)
      info.gap = true
      if (excludesZero(whole)) {
        info.lost = !this.poleAtEnds(horizontal, fixed, lo, hi, p.v, q.v)
        return info
      }
      this.spans(info, horizontal, fixed, lo, hi, p.v, q.v)
      return info
    }
    if (pn && qn) {
      const whole = this.enclose(horizontal, fixed, lo, hi)
      info.gap = true
      if (excludesZero(whole)) {
        info.lost = true
        return info
      }
      this.spans(info, horizontal, fixed, lo, hi, p.v, q.v)
      return info
    }
    this.cut(info, horizontal, fixed, lo, hi, p.v, q.v)
    return info
  }

  // Whether the only thing that makes the twin say PARTIAL of an edge is a pole AT an end of it: H is infinite at that end (ln x - y at x = 0,
  // 1/x - y: an infinity is a value, not an undefined point) and the twin proves what is left of the edge defined. Then there is no undefined
  // stretch inside the edge to locate, and an edge whose enclosure excludes zero is not `lost`: the corner at the pole is a leaf's own and
  // says nothing of a side (the pole on a grid line, x = 0 in the default view, is a corner of every leaf along it). The box is shrunk by
  // a relative epsilon at each infinite end, which takes the end out of it.
  private poleAtEnds(horizontal: boolean, fixed: number, lo: number, hi: number, vlo: number, vhi: number): boolean {
    const inLo = Math.abs(vlo) === Infinity
    const inHi = Math.abs(vhi) === Infinity
    if (!inLo && !inHi) return false
    const a = inLo ? lo + (lo === 0 ? Number.MIN_VALUE : Math.abs(lo) * Number.EPSILON) : lo
    const b = inHi ? hi - (hi === 0 ? Number.MIN_VALUE : Math.abs(hi) * Number.EPSILON) : hi
    if (!(a < b)) return false
    return this.enclose(horizontal, fixed, a, b).v >= DEFINED
  }

  // An edge with one undefined end: cut at the domain edge, found by bisecting on whether H is defined (to machine width: a curve
  // that runs along the domain edge, y = ln x, must be followed to the bottom of the view), and the defined part tested as an edge.
  private cut(info: EdgeInfo, horizontal: boolean, fixed: number, lo: number, hi: number, vlo: number, vhi: number): void {
    info.gap = true
    this.stats.gaps++
    const loDefined = vlo === vlo
    let d = loDefined ? lo : hi
    let u = loDefined ? hi : lo
    let vd = loDefined ? vlo : vhi
    for (let i = 0; i < CONTOUR.maxBisect; i++) {
      const m = (d + u) / 2
      if (!(m !== d && m !== u)) break
      const vm = this.at(horizontal, fixed, m)
      if (vm === vm) {
        d = m
        vd = vm
      } else u = m
    }
    const a = loDefined ? lo : d
    const b = loDefined ? d : hi
    const va = loDefined ? vlo : vd
    const vb = loDefined ? vd : vhi
    // the stop is the last defined point: the fill of a region ends on the defined side
    info.stops.push(d)
    if (a < b && va >= 0 !== vb >= 0) this.take(info, this.locate(horizontal, fixed, a, b, va, vb, false))
  }

  // An edge the twin finds PARTIAL where H shows no sign change between its ends, or whose ends are both undefined (and whose enclosure
  // holds zero): halved by the twin until each piece is proved (not PARTIAL) or is CONTOUR.gapPx wide, a gap. A piece whose enclosure
  // excludes zero (the discard rule: lo > 0, hi < 0, or empty) has no root, proved or not, and is not looked into any further. Each stretch
  // between gaps is tested as an edge, with H at its ends (the ends of a proved stretch are defined).
  private spans(info: EdgeInfo, horizontal: boolean, fixed: number, lo: number, hi: number, vlo: number, vhi: number): void {
    this.stats.gaps++
    const minWidth = CONTOUR.gapPx / (horizontal ? this.px.x : this.px.y)
    const runs: { a: number; b: number; v: Verdict }[] = []
    const gaps: [number, number][] = []
    let evals = 0
    const visit = (a: number, b: number, v: Verdict, excluded: boolean): void => {
      if (excluded) {
        // a stretch with no zero is not looked into, but one that is PARTIAL holds something undefined or unbounded that is not located
        if (v === PARTIAL) info.lost = true
        return
      }
      if (v !== PARTIAL) {
        const last = runs[runs.length - 1]
        if (last && last.b === a) {
          last.b = b
          if (v < last.v) last.v = v
        } else runs.push({ a, b, v })
        return
      }
      if (b - a <= minWidth || evals >= CONTOUR.gapEvals) {
        gaps.push([a, b])
        return
      }
      const m = (a + b) / 2
      if (!(m > a && m < b)) {
        info.lost = true
        return
      }
      for (const [s, e] of [
        [a, m],
        [m, b],
      ]) {
        const z = this.enclose(horizontal, fixed, s, e)
        evals++
        visit(s, e, z.v, excludesZero(z))
      }
    }
    // The edges of a column of leaves cross the same pole line (tan x at x = pi / 2 in every row): a gap found on one edge is the first
    // thing tried on the next. The gap and the stretches either side of it are each asked of the twin, so a pole that has moved is not
    // taken for the old one.
    const hints = horizontal ? this.hintsX : this.hintsY
    let known = false
    for (const [ga, gb] of hints) {
      if (!(lo < ga && gb < hi)) continue
      const inGap = this.enclose(horizontal, fixed, ga, gb).v === PARTIAL
      if (!inGap) continue
      const l = this.enclose(horizontal, fixed, lo, ga)
      const left = l.v
      const leftOut = excludesZero(l)
      if (left === PARTIAL) continue
      const r = this.enclose(horizontal, fixed, gb, hi)
      const right = r.v
      const rightOut = excludesZero(r)
      if (right === PARTIAL) continue
      if (!leftOut) runs.push({ a: lo, b: ga, v: left })
      if (!rightOut) runs.push({ a: gb, b: hi, v: right })
      gaps.push([ga, gb])
      known = true
      break
    }
    if (!known) {
      visit(lo, hi, PARTIAL, false)
      if (gaps.length === 1) {
        if (hints.length >= 64) hints.shift()
        hints.push(gaps[0])
      }
    }
    // The gaps are where the edge is cut. A gap of a point's width is a stop at its middle; one the subdivision gave up on (its budget
    // of evaluations ran out) is wider than a point, and where in it the edge is cut is not known.
    for (const [ga, gb] of gaps) {
      if (gb - ga <= 4 * minWidth) info.stops.push((ga + gb) / 2)
      else info.lost = true
    }
    for (const run of runs) {
      const va = run.a === lo ? vlo : this.at(horizontal, fixed, run.a)
      const vb = run.b === hi ? vhi : this.at(horizontal, fixed, run.b)
      if (!(va === va && vb === vb) || va >= 0 === vb >= 0) continue
      this.take(info, this.locate(horizontal, fixed, run.a, run.b, va, vb, run.v === CONTINUOUS))
    }
  }

  // A root between two points of an edge, given the values of H at them (their signs differ, neither is NaN).
  private locate(horizontal: boolean, fixed: number, lo0: number, hi0: number, vlo0: number, vhi0: number, continuous: boolean): CrossingResult {
    const plusLo = vlo0 >= 0
    const pointOf = (r: number): Root => (horizontal ? { ok: true, x: r, y: fixed } : { ok: true, x: fixed, y: r })
    // an exact zero at the + end is the root: the zero set meets the edge there
    if ((plusLo ? vlo0 : vhi0) === 0) return pointOf(plusLo ? lo0 : hi0)
    let lo = lo0
    let hi = hi0
    let vlo = vlo0
    let vhi = vhi0
    const lenPx = (hi - lo) * (horizontal ? this.px.x : this.px.y)

    // The bracket [lo, hi] keeps the sign change. 'undefined': H is NaN at a midpoint. 'narrow': the doubles can not halve
    // it again.
    const bisect = (steps: number): 'ok' | 'undefined' | 'narrow' => {
      for (let i = 0; i < steps; i++) {
        const mid = (lo + hi) / 2
        if (!(mid > lo && mid < hi)) return 'narrow'
        const vm = this.at(horizontal, fixed, mid)
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
      this.stats.crossings++
      return pointOf(vhi === 0 ? hi : vlo === 0 ? lo : (lo + hi) / 2)
    }
    const reject = (why: 'pole' | 'jump' | 'undefined'): CrossingResult => {
      if (why === 'pole') this.stats.poles++
      else if (why === 'jump') this.stats.jumps++
      else this.stats.undefinedEdges++
      // where the edge is cut: the middle of the bracket the bisection ended with (take records it)
      this.stopAt = (lo + hi) / 2
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
  // leaves the quadtree left too coarse to contour (stop 'budget', wider than CONTOUR.maxBudgetLeafPx) were left out: the curve is missing
  // there, and the statement is drawn coarsely (stats.oversized counts them)
  refused: boolean
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

// The crossing a critical point of H makes in a leaf: its centre, and the roots where its four arms leave the leaf.
interface CritX {
  p: Vec2
  exits: Root[]
}

interface Ctx {
  fns: ContourFns
  cr: Crossings
  stats: ContourStats
  px: PxScale
  emit: (a: Vec2, b: Vec2) => boolean
  crit: Map<number, CritX>
  // the corners of leaf i, counter-clockwise from (x0, y0): looked up once for the two passes
  corners: (i: number) => Corner[]
}

// The pieces of the zero set in `leaves`, and the touch points. The leaves are those of subdivide: one size, meeting
// edge to edge on equal coordinates.
export function contourLeaves(leaves: readonly Leaf[], fns: ContourFns, view: ContourView, counter: EvalCounter, budget?: ContourBudget, crossings?: Crossings): ContourResult {
  // A caller that wants the edges' roots for itself (the region stage reads them to cut a leaf) hands in the cache; its own stats then
  // count this contouring, and `ContourResult.stats` is that object.
  const cr = crossings ?? new Crossings(fns, view.px, counter, newStats())
  const stats = cr.stats
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

  // a leaf that the budget stopped halving, too wide to hold a chord
  const eligible = new Uint8Array(leaves.length)
  for (let i = 0; i < leaves.length; i++) {
    const l = leaves[i]
    const tooWide = l.stop === 'budget' && ((l.x1 - l.x0) * view.px.x > CONTOUR.maxBudgetLeafPx || (l.y1 - l.y0) * view.px.y > CONTOUR.maxBudgetLeafPx)
    if (tooWide) stats.oversized++
    else eligible[i] = 1
  }

  const cornerCache: Corner[][] = new Array<Corner[]>(leaves.length)
  const corners = (i: number): Corner[] => {
    let c = cornerCache[i]
    if (!c) {
      const l = leaves[i]
      c = [cr.corner(l.x0, l.y0), cr.corner(l.x1, l.y0), cr.corner(l.x1, l.y1), cr.corner(l.x0, l.y1)]
      cornerCache[i] = c
    }
    return c
  }
  const ctx: Ctx = { fns, cr, stats, px: view.px, emit, crit: new Map(), corners }
  let capped = false
  if (fns.grad && fns.hess) capped = criticalPass(leaves, eligible, ctx, over)

  const kinds = new Uint8Array(leaves.length) // 0 none, 1 drew, 2 candidate
  if (!capped) {
    for (let i = 0; i < leaves.length; i++) {
      if (!eligible[i]) continue
      if (over()) {
        capped = true
        break
      }
      stats.leaves++
      const k = contourLeaf(i, leaves[i], ctx)
      kinds[i] = k === 'drew' ? 1 : k === 'candidate' ? 2 : 0
    }
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
  return { segments, touches, touchLinks, stats, capped, refused: stats.oversized > 0 }
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

// The position of a point of the leaf's boundary along it, counter-clockwise from (x0, y0): the bottom edge is 0 to 1, the right 1 to 2,
// the top 2 to 3, the left 3 to 4.
function boundaryParam(l: Box, x: number, y: number): number {
  const w = l.x1 - l.x0
  const h = l.y1 - l.y0
  const db = Math.abs(y - l.y0)
  const dr = Math.abs(x - l.x1)
  const dt = Math.abs(y - l.y1)
  const dl = Math.abs(x - l.x0)
  const m = Math.min(db, dr, dt, dl)
  if (m === db) return (x - l.x0) / w
  if (m === dr) return 1 + (y - l.y0) / h
  if (m === dt) return 2 + (l.x1 - x) / w
  return 3 + (l.y1 - y) / h
}

function boundaryPoint(l: Box, u: number): Vec2 {
  const v = ((u % 4) + 4) % 4
  const k = Math.min(3, Math.floor(v))
  const t = v - k
  const w = l.x1 - l.x0
  const h = l.y1 - l.y0
  if (k === 0) return { x: l.x0 + t * w, y: l.y0 }
  if (k === 1) return { x: l.x1, y: l.y0 + t * h }
  if (k === 2) return { x: l.x1 - t * w, y: l.y1 }
  return { x: l.x0, y: l.y1 - t * h }
}

// A value with a sign: not zero, not NaN (an infinity has one).
function signed(v: number): boolean {
  return v === v && v !== 0
}

// H alternates in sign round a point: the four samples are all nonzero and neighbours differ.
function alternates(signs: boolean[]): boolean {
  return signs[0] !== signs[1] && signs[1] !== signs[2] && signs[2] !== signs[3] && signs[3] !== signs[0]
}

// Whether H alternates in sign round `centre`, sampled CRITICAL.probePx from it along the bisector of each pair of adjacent arms (the
// arms are the points the four pieces of the X run to, counter-clockwise round it).
function certified(cr: Crossings, centre: Vec2, arms: Vec2[], px: PxScale): boolean {
  const angles = arms.map((a) => {
    const dx = (a.x - centre.x) * px.x
    const dy = (a.y - centre.y) * px.y
    return dx === 0 && dy === 0 ? NaN : Math.atan2(dy, dx)
  })
  if (angles.some((a) => a !== a)) return false
  const signs: boolean[] = []
  for (let k = 0; k < 4; k++) {
    let gap = angles[(k + 1) % 4] - angles[k]
    while (gap <= 0) gap += 2 * Math.PI
    const beta = angles[k] + gap / 2
    const v = cr.value(centre.x + (CRITICAL.probePx * Math.cos(beta)) / px.x, centre.y + (CRITICAL.probePx * Math.sin(beta)) / px.y)
    if (!signed(v)) return false
    signs.push(v > 0)
  }
  return alternates(signs)
}

// The critical points of H: leaves where both partials change sign over the corners, solved by Newton's steps (held in the leaf), tested
// for a crossing (an indefinite Hessian), certified, and followed out by bisection round the leaf boundary. The roots where the arms leave
// are put in the edge cache. True if the budget ran out.
function criticalPass(leaves: readonly Leaf[], eligible: Uint8Array, ctx: Ctx, over: () => boolean): boolean {
  const { fns, cr } = ctx
  const grad = fns.grad as readonly [CompiledFn, CompiledFn]
  const grads = new Map<string, [number, number]>()
  const gradAt = (c: Corner): [number, number] => {
    let g = grads.get(c.key)
    if (!g) {
      g = [grad[0](c.x, c.y), grad[1](c.x, c.y)]
      cr.counter.points += 2
      grads.set(c.key, g)
    }
    return g
  }
  const tried = new Set<number>()
  let index: Map<string, number[]> | null = null
  for (let i = 0; i < leaves.length; i++) {
    if (!eligible[i] || tried.has(i)) continue
    if (over()) return true
    const l = leaves[i]
    const c = ctx.corners(i)
    if (c.some((k) => k.v !== k.v)) continue
    const g = c.map(gradAt)
    if (g.some((p) => !(Number.isFinite(p[0]) && Number.isFinite(p[1])))) continue
    const changes = (j: 0 | 1) => g.some((p) => p[j] >= 0) && g.some((p) => p[j] < 0)
    if (!changes(0) || !changes(1)) continue
    const node = newton(l, ctx)
    if (!node) continue
    // a node on an edge or corner of the leaf is solved once, in the box of the leaves that share it (the others are not tried)
    index ??= cornerIndex(leaves)
    const box = boxAround(i, node, leaves, eligible, index, ctx)
    if (!box) continue
    for (const j of box.members) tried.add(j)
    const x = crossingOf(box, node, ctx)
    if (!x) continue
    // each leaf of the box draws the arms that leave by its own edges, from the one node (an arm that leaves exactly at the corner between
    // two leaves is drawn by the first)
    const taken = new Set<Root>()
    for (const j of box.members) {
      const m = leaves[j]
      const mine = x.exits.filter((e) => !taken.has(e) && e.x >= m.x0 && e.x <= m.x1 && e.y >= m.y0 && e.y <= m.y1)
      for (const e of mine) taken.add(e)
      ctx.crit.set(j, { p: x.p, exits: mine })
    }
    ctx.stats.critical++
    ctx.stats.crosses++
    ctx.stats.saddles++
  }
  return false
}

// A critical point of H found in a leaf: where it is, the Hessian there, and which edges of the leaf it lies on (within CRITICAL.edgeTolPx of).
interface Node {
  x: number
  y: number
  hxx: number
  hxy: number
  hyy: number
  left: boolean
  right: boolean
  bottom: boolean
  top: boolean
}

// Newton's steps on grad H = 0 from the centre of the leaf, held in the leaf; the Hessian must be indefinite (a saddle) all the way. A node that
// comes to rest on an edge or corner of the leaf, or within a hair of it (a crossing on a grid line: y = 0 in the default view, an axis), is
// snapped onto it, so that it is the same point whichever leaf of the box it was found from.
function newton(leaf: Leaf, ctx: Ctx): Node | null {
  const { fns, cr, px } = ctx
  const grad = fns.grad as readonly [CompiledFn, CompiledFn]
  const hess = fns.hess as readonly [CompiledFn, CompiledFn, CompiledFn]
  const counter = cr.counter
  const tx = CRITICAL.edgeTolPx / px.x
  const ty = CRITICAL.edgeTolPx / px.y
  let x = (leaf.x0 + leaf.x1) / 2
  let y = (leaf.y0 + leaf.y1) / 2
  let hxx = 0
  let hxy = 0
  let hyy = 0
  let done = false
  for (let step = 0; step <= CRITICAL.steps; step++) {
    const gx = grad[0](x, y)
    const gy = grad[1](x, y)
    hxx = hess[0](x, y)
    hxy = hess[1](x, y)
    hyy = hess[2](x, y)
    counter.points += 5
    if (!(Number.isFinite(gx) && Number.isFinite(gy) && Number.isFinite(hxx) && Number.isFinite(hxy) && Number.isFinite(hyy))) return null
    const det = hxx * hyy - hxy * hxy
    if (!(det < 0)) return null
    const dx = (-hyy * gx + hxy * gy) / det
    const dy = (hxy * gx - hxx * gy) / det
    const nx = x + dx
    const ny = y + dy
    if (!(nx > leaf.x0 - tx && nx < leaf.x1 + tx && ny > leaf.y0 - ty && ny < leaf.y1 + ty)) return null
    x = nx
    y = ny
    if (Math.hypot(dx * px.x, dy * px.y) < CRITICAL.convergedPx) {
      done = true
      break
    }
  }
  if (!done) return null
  const left = x - leaf.x0 < tx
  const right = leaf.x1 - x < tx
  const bottom = y - leaf.y0 < ty
  const top = leaf.y1 - y < ty
  if ((left && right) || (bottom && top)) return null
  if (left) x = leaf.x0
  if (right) x = leaf.x1
  if (bottom) y = leaf.y0
  if (top) y = leaf.y1
  return { x, y, hxx, hxy, hyy, left, right, bottom, top }
}

// The leaves that share a node: the leaf alone where it is inside it, the leaf and its neighbour across the edge it lies on, the four round
// the corner it lies on; and the rectangle they make. Null if a leaf is missing (the quadtree dropped it, the budget left it too wide), is
// not the size of the others, has an undefined corner, or is a leaf the pass has taken.
function boxAround(i: number, node: Node, leaves: readonly Leaf[], eligible: Uint8Array, index: Map<string, number[]>, ctx: Ctx): { members: number[]; rect: Box } | null {
  const l = leaves[i]
  const sides = [node.left, node.right, node.bottom, node.top].filter(Boolean).length
  let members: number[] = [i]
  if (sides === 1) {
    const [ka, kb] = node.left
      ? [`${l.x0},${l.y0}`, `${l.x0},${l.y1}`]
      : node.right
        ? [`${l.x1},${l.y0}`, `${l.x1},${l.y1}`]
        : node.bottom
          ? [`${l.x0},${l.y0}`, `${l.x1},${l.y0}`]
          : [`${l.x0},${l.y1}`, `${l.x1},${l.y1}`]
    const lb = index.get(kb) ?? []
    const across = (index.get(ka) ?? []).filter((j) => j !== i && lb.includes(j))
    if (across.length !== 1) return null
    members = [i, across[0]]
  } else if (sides === 2) {
    const key = `${node.right ? l.x1 : l.x0},${node.top ? l.y1 : l.y0}`
    members = index.get(key) ?? []
    if (members.length !== 4 || !members.includes(i)) return null
  }
  const w = l.x1 - l.x0
  const h = l.y1 - l.y0
  for (const j of members) {
    const m = leaves[j]
    if (!eligible[j] || m.x1 - m.x0 !== w || m.y1 - m.y0 !== h) return null
    if (ctx.corners(j).some((k) => k.v !== k.v)) return null
  }
  const rect: Box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
  for (const j of members) {
    rect.x0 = Math.min(rect.x0, leaves[j].x0)
    rect.x1 = Math.max(rect.x1, leaves[j].x1)
    rect.y0 = Math.min(rect.y0, leaves[j].y0)
    rect.y1 = Math.max(rect.y1, leaves[j].y1)
  }
  return { members, rect }
}

// The X a box of leaves holds at its critical point, certified, with its arms followed out of the box and registered on the edges of its
// leaves that make its boundary; or null. (The edges inside a box need no root: the arms of a node on one begin there.)
function crossingOf(box: { members: number[]; rect: Box }, node: Node, ctx: Ctx): CritX | null {
  const { cr, px } = ctx
  const leaf = box.rect
  const { x, y, hxx, hxy, hyy } = node

  // the corners of the leaves that lie on the boundary of the box, counter-clockwise: the ends of the edges the arms are registered on
  const seen = new Set<string>()
  const ring: Corner[] = []
  for (const j of box.members) {
    for (const k of ctx.corners(j)) {
      const onBoundary = k.x === leaf.x0 || k.x === leaf.x1 || k.y === leaf.y0 || k.y === leaf.y1
      if (onBoundary && !seen.has(k.key)) {
        seen.add(k.key)
        ring.push(k)
      }
    }
  }
  const ru = new Map<Corner, number>(ring.map((k) => [k, boundaryParam(leaf, k.x, k.y)]))
  ring.sort((p, q) => (ru.get(p) as number) - (ru.get(q) as number))
  // a corner where H is exactly zero is the corners' own (the zero set passes through it: the zero edges and the roots at corners)
  if (ring.some((k) => k.v === 0)) return null

  // The zero directions of the Hessian's quadratic form, on the screen: q(t) = m + r cos(2t - phi) is zero at 2t - phi = +-alpha. The
  // four arms are t1, t2 and their opposites; the bisectors of neighbouring arms are a quarter turn apart.
  const A = hxx / (px.x * px.x)
  const B = hxy / (px.x * px.y)
  const C = hyy / (px.y * px.y)
  const m = (A + C) / 2
  const r = Math.hypot((A - C) / 2, B)
  if (!(r > Math.abs(m))) return null
  const phi = Math.atan2(B, (A - C) / 2)
  const alpha = Math.acos(-m / r)
  const tau = 2 * Math.PI
  const norm = (t: number) => ((t % tau) + tau) % tau
  const rays = [(phi + alpha) / 2, (phi - alpha) / 2, (phi + alpha) / 2 + Math.PI, (phi - alpha) / 2 + Math.PI].map(norm).sort((a, b) => a - b)
  const bisectors = [0, 1, 2, 3].map((j) => (j < 3 ? (rays[j] + rays[j + 1]) / 2 : (rays[3] + rays[0] + tau) / 2))

  // certified: H alternates in sign half a px out along the bisectors
  const probe = bisectors.map((b) => {
    const v = cr.value(x + (CRITICAL.probePx * Math.cos(b)) / px.x, y + (CRITICAL.probePx * Math.sin(b)) / px.y)
    return v > 0 ? 1 : v < 0 ? -1 : 0
  })
  if (probe.includes(0) || !alternates(probe.map((s) => s > 0))) return null

  // where each bisector leaves the leaf, and the sign of H there: the sectors must reach the boundary
  const exitsAt = bisectors.map((b) => {
    const dwx = Math.cos(b) / px.x
    const dwy = Math.sin(b) / px.y
    const tx = dwx > 0 ? (leaf.x1 - x) / dwx : dwx < 0 ? (leaf.x0 - x) / dwx : Infinity
    const ty = dwy > 0 ? (leaf.y1 - y) / dwy : dwy < 0 ? (leaf.y0 - y) / dwy : Infinity
    const t = Math.min(tx, ty)
    const bx = t === tx ? (dwx > 0 ? leaf.x1 : leaf.x0) : x + t * dwx
    const by = t === ty ? (dwy > 0 ? leaf.y1 : leaf.y0) : y + t * dwy
    return { x: bx, y: by }
  })
  const bu: number[] = []
  for (let j = 0; j < 4; j++) {
    const v = cr.value(exitsAt[j].x, exitsAt[j].y)
    const sameSector = v > 0 === probe[j] > 0
    if (!(sameSector && signed(v))) return null
    bu.push(boundaryParam(leaf, exitsAt[j].x, exitsAt[j].y))
  }

  // Arm a runs between bisectors a - 1 and a; the root where it leaves is the sign change of H along the boundary between the two
  // points where those bisectors leave (counter-clockwise).
  const maxEdgePx = Math.max((leaf.x1 - leaf.x0) * px.x, (leaf.y1 - leaf.y0) * px.y)
  const roots: { u: number; root: Root }[] = []
  for (let a = 0; a < 4; a++) {
    const j0 = (a + 3) % 4
    let lo = bu[j0]
    let hi = bu[a]
    while (hi <= lo) hi += 4
    // (the arcs between the bisectors' exits make one turn round the boundary between them; a centre near a corner makes one of them long)
    if (hi - lo >= 4 - 1e-9) return null
    const plusLo = probe[j0] > 0
    const steps = Math.min(CONTOUR.maxBisect, Math.max(1, Math.ceil(Math.log2(((hi - lo) * maxEdgePx) / CONTOUR.bisectPx))))
    for (let s = 0; s < steps; s++) {
      const mid = (lo + hi) / 2
      const p = boundaryPoint(leaf, mid)
      const v = cr.value(p.x, p.y)
      if (v !== v) return null
      // an exact zero is the root (the arm of x^2 = 4 y^2 leaves at the middle of a leaf's edge, a dyadic point the bisection reaches)
      if (v === 0) {
        lo = mid
        hi = mid
        break
      }
      if (v > 0 === plusLo) lo = mid
      else hi = mid
    }
    const u = (lo + hi) / 2
    const p = boundaryPoint(leaf, u)
    roots.push({ u: ((u % 4) + 4) % 4, root: { ok: true, x: p.x, y: p.y } })
  }

  // The roots on each edge of the boundary (between consecutive corners of the ring) must fit the corners' signs (an odd number where the
  // ends differ), and the edges must be new.
  const n = ring.length
  const s = ring.map((k) => k.v >= 0)
  const start = ru.get(ring[0]) as number
  const edgeOf = (u: number): number => {
    const uu = u < start ? u + 4 : u
    for (let k = n - 1; k >= 0; k--) if ((ru.get(ring[k]) as number) <= uu) return k
    return 0
  }
  const onEdge: { u: number; root: Root }[][] = ring.map(() => [])
  for (const e of roots) onEdge[edgeOf(e.u)].push(e)
  for (let k = 0; k < n; k++) {
    onEdge[k].sort((p, q) => p.u - q.u)
    const oddHere = onEdge[k].length % 2 === 1
    const endsDiffer = s[k] !== s[(k + 1) % n]
    if (oddHere !== endsDiffer) return null
    if (cr.hasEdge(ring[k], ring[(k + 1) % n])) return null
  }
  for (let k = 0; k < n; k++) if (onEdge[k].length > 0) cr.register(ring[k], ring[(k + 1) % n], onEdge[k].map((e) => e.root))
  return { p: { x, y }, exits: roots.map((e) => e.root) }
}

// One leaf. The corners c0..c3 run counter-clockwise from (x0, y0); edge k joins corner k to corner k + 1.
function contourLeaf(index: number, leaf: Leaf, ctx: Ctx): LeafKind {
  const { cr, stats, px, emit } = ctx
  const c = ctx.corners(index)
  const anyNaN = c.some((k) => k.v !== k.v)
  if (anyNaN) stats.undefinedLeaves++
  let drew = false
  // A leaf the twin did not prove DEFINED or CONTINUOUS may hold an undefined strip a chord would cross: the twin must vouch for the
  // box of the piece (a UNKNOWN twin, an integral, vouches for nothing and blocks nothing).
  const check = leaf.verdict === PARTIAL
  // A leaf whose twin says nothing (one integral term makes every enclosure UNKNOWN, an undefined strip included) cannot vouch for a box, and
  // is not taken to: H at CONTOUR.chordSamples points along the piece must at least be defined (a strip narrower than the gap between samples
  // is not seen; a twin that says nothing leaves no better test).
  const sample = leaf.verdict === UNKNOWN
  const piece = (a: Vec2, b: Vec2) => {
    if (a.x === b.x && a.y === b.y) return
    if (check && cr.verdictOver(Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)) === PARTIAL) {
      stats.chordsRejected++
      return
    }
    if (sample) {
      const n = CONTOUR.chordSamples + 1
      for (let i = 1; i < n; i++) {
        const v = cr.value(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n)
        if (v !== v) {
          stats.chordsRejected++
          return
        }
      }
    }
    if (emit(a, b)) drew = true
  }
  // An edge whose two ends are exact zeros and whose midpoint is zero is on the zero set: a piece, whichever signs the leaf has (the
  // axis of xy = 0 beside a leaf that is positive all through, the double line y^2 = 0). A leaf of zeros throughout is a plateau, not a
  // curve, and has no edges of its own.
  if (!c.every((k) => k.v === 0)) {
    for (let k = 0; k < 4; k++) {
      const a = c[k]
      const b = c[(k + 1) % 4]
      if (a.v === 0 && b.v === 0 && cr.zeroEdge(a, b)) piece(a.pt, b.pt)
    }
  }

  // a crossing found from a critical point: its arms run from the centre to the roots where they leave
  const owner = ctx.crit.get(index)
  if (owner) {
    for (const g of owner.exits) piece(g, owner.p)
    return drew ? 'drew' : 'none'
  }

  const s = c.map((k) => k.v >= 0)
  const continuous = leaf.verdict === CONTINUOUS
  const infos: EdgeInfo[] = []
  for (let k = 0; k < 4; k++) {
    const a = c[k]
    const b = c[(k + 1) % 4]
    const defined = a.v === a.v && b.v === b.v
    const differ = defined && s[k] !== s[(k + 1) % 4]
    infos.push(differ || !defined || !continuous || cr.maybeRegistered(a, b) ? cr.edge(a, b, continuous) : NO_EDGE)
  }
  // the roots of each edge counter-clockwise (the edges' own order runs from the smaller (x, y): the top and left edges are the other way)
  const roots = infos.map((inf, k) => (k >= 2 ? [...inf.roots].reverse() : inf.roots))
  const n = roots[0].length + roots[1].length + roots[2].length + roots[3].length
  const gapAny = infos.some((inf) => inf.gap || inf.fail !== null)
  const rest: LeafKind = anyNaN || gapAny ? 'none' : 'candidate'
  if (n === 0) return drew ? 'drew' : rest
  if (n !== 2 && n !== 4) return drew ? 'drew' : 'none'

  // the classic configuration: corners all defined, a root on each edge whose ends differ and none on the others
  const std = !anyNaN && infos.every((inf, k) => inf.roots.length <= 1 && inf.roots.length === (s[k] !== s[(k + 1) % 4] ? 1 : 0))
  const ring: { pt: Root; k: number; i: number }[] = []
  roots.forEach((list, k) => list.forEach((pt, i) => ring.push({ pt, k, i })))

  // two roots of one edge that are the ends of two arms of a crossing: the arms leave this leaf by other edges
  const armPair = (p: number, q: number) => ring[p].k === ring[q].k && cr.isArm(ring[p].pt) && cr.isArm(ring[q].pt)

  if (n === 2) {
    if (!std) {
      // Two arms that arrive by one edge and leave by none that shows: not joined to each other (they leave beyond, hidden as a pair)
      if (!armPair(0, 1)) piece(ring[0].pt, ring[1].pt)
      return drew ? 'drew' : rest
    }
    const x: (Vec2 | null)[] = infos.map((inf) => inf.roots[0] ?? null)
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
      // where every corner of the run is an exact zero the zero set follows the edges between them: those are pieces of their own (above)
      path = []
    } else if (run.length === 3 && run[1].v === 0 && (run[0].v === 0) !== (run[2].v === 0)) {
      // A zero edge (z1, z2) and a strict + corner s at one end of the run: a curve that meets the zero edge, a T. The
      // zero edge is a piece of its own (above); the curve is joined to the end of it nearer where it leaves it, the
      // strict corner's end if the root on the edge s - m is in the half nearer s.
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
    return drew ? 'drew' : rest
  }

  // four roots
  if (std) {
    stats.saddles++
    const x = infos.map((inf) => inf.roots[0]) as Root[]
    const f = c.map((k) => k.v)
    let cross = false
    let saddleInPlus = false
    if (f.every((v) => Number.isFinite(v))) {
      const m = Math.max(...f.map(Math.abs))
      const [g0, g1, g2, g3] = f.map((v) => v / m)
      const d = g0 - g1 + g2 - g3
      const saddle = (g0 * g2 - g1 * g3) / d
      saddleInPlus = saddle > 0
      if (Math.abs(saddle) <= CONTOUR.crossRel) {
        // an X through the saddle point, if H alternates round it half a px out
        const centre: Vec2 = { x: leaf.x0 + clamp((g0 - g3) / d, 0, 1) * (leaf.x1 - leaf.x0), y: leaf.y0 + clamp((g0 - g1) / d, 0, 1) * (leaf.y1 - leaf.y0) }
        if (certified(cr, centre, x, px)) {
          cross = true
          stats.crosses++
          for (let k = 0; k < 4; k++) piece(x[k], centre)
        }
      }
    }
    if (!cross) {
      // the region the saddle point lies in is the one that is joined; the pieces cut off the corners of the other
      for (let i = 0; i < 4; i++) {
        if (s[i] === saddleInPlus) continue
        piece(x[(i + 3) % 4], x[i])
      }
    }
    return drew ? 'drew' : rest
  }
  // Roots not one to an edge: two arms of a crossing leave the leaf through one edge. The roots of an edge that shows no sign change
  // come in pairs, so the boundary's signs still alternate with each root. The two ways to pair four roots round a ring without arcs
  // crossing are (0 1)(2 3) and (1 2)(3 0). Two arms of one crossing that arrive together continue apart: the pairing that does not join
  // them is the right one. Otherwise H at the centre says which sectors join.
  const parity = infos.every((inf, k) => inf.roots.length % 2 === (s[k] !== s[(k + 1) % 4] ? 1 : 0))
  if (anyNaN || gapAny || !parity) return drew ? 'drew' : 'none'
  stats.saddles++
  const joinsArms = [armPair(0, 1) || armPair(2, 3), armPair(1, 2) || armPair(3, 0)]
  if (joinsArms[0] !== joinsArms[1]) {
    const j0 = joinsArms[0] ? 1 : 0
    piece(ring[j0].pt, ring[j0 + 1].pt)
    piece(ring[j0 + 2].pt, ring[(j0 + 3) % 4].pt)
    return drew ? 'drew' : rest
  }
  const centre = cr.value((leaf.x0 + leaf.x1) / 2, (leaf.y0 + leaf.y1) / 2)
  if (!signed(centre)) return drew ? 'drew' : 'none'
  for (let j = 0; j < 4; j++) {
    // the sign of the boundary after root j: that of the corner the edge starts at, once for each root up to and including it
    const e = ring[j]
    const after = e.i % 2 === 0 ? !s[e.k] : s[e.k]
    // the stretches that do not have the sign of the centre are cut off
    if (after !== centre > 0) piece(ring[j].pt, ring[(j + 1) % 4].pt)
  }
  return drew ? 'drew' : rest
}
