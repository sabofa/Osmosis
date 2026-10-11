// An implicit curve statement through the interval quadtree (calc P3, task 4): the entry point, as P2's sampleCurve is the explicit
// curves'.
//
//   sampleImplicit(left, right, where, view, scope, options) -> { objects, capped, stats, tested, defined, ... }
//
// F = G is H = F - G = 0. The quadtree finds the leaves the twin cannot clear (quadtree.ts), contour.ts finds the zero set in them
// as pieces whose ends are bisected roots shared by edge, chains.ts joins them into certified chains and the touch points into
// curves and isolated points. What is drawn is ONE `curve` object (id `<statement>/curve`) of those chains, each with the arc length
// from its start for a parameter (an open chain starts at its smaller (x, y) end, a closed one at its smallest vertex and runs
// counter-clockwise: "Decided before P3"), and a `value` mark for each isolated point (`x^2 + y^2 = 0` is one filled mark at the
// origin). `breaks` is empty: a pole or an undefined stretch ends a chain, and the parameter is a length, not a place on an axis to
// type a break at.
//
// THE `if` CLAUSE. A condition on x and y (it may be a comparison, a chain, `and`/`or`/`not`: a region's condition), compiled like a
// region's (region.ts). It clips the chains the way the region stage clips a leaf, with no centroid rule:
//  - a piece of the contour lies in one leaf; the twin of the clause over the leaf says it is proven true (the piece is kept whole),
//    proven false or undefined (it is dropped), or ambiguous;
//  - an ambiguous leaf is cut: the zero sets of the clause's comparisons are contoured in it (the same chords a region's boundary
//    is made of), a piece is split where it crosses one, and each part is kept if the clause is true at its middle (the scalar:
//    the exact truth, not the chord's). `x^2 + y^2 = 4 if y > 0` is the upper arc, ending where the circle crosses y = 0, at the
//    root the leaf edge holds there.
// A piece in a leaf the budget did not reach is left out, never kept unclipped. An isolated touch point is kept if the clause is
// true at it. (The clause's own domain edge or pole inside a leaf is not cut: the part of a piece on either side of it is kept or
// dropped by the clause at its middle, so the piece is wrong by at most a leaf there.)
//
// BUDGET, NOTES. One counter and one budget for subdividing, contouring and clipping (tuning.ts ImplicitTuning.statement), as in
// regions.ts, and the same answer (types.ts Sampled): `capped` is drawn coarsely, `badView` that the view was refused and nothing drawn,
// `tested` and `defined` as the curve sampler's (a clause that is true nowhere on a grid over the view is not tested: nothing to say;
// tested and not defined is "undefined everywhere in view"), `drawnInView` and `blankInView`.
import { sub } from '../../math/expr'
import { compileInterval, DEFINED, type CompiledInterval, iv } from '../../math/interval'
import { compareValue } from '../../math/reserved'
import type { MathScope } from '../../math/scope'
import type { Expr } from '../../parser/types'
import type { Chain, MarkId, SceneObject, Vec2 } from '../../scene/types'
import { chordMeets } from '../sample/adaptive'
import type { View } from '../sample/curve'
import type { EvalCounter } from '../sample/types'
import { buildChains, buildTouchCurves } from './chains'
import { compileContour, contourLeaves, type TouchPoint } from './contour'
import { implicitClassifier } from './quadtree'
import { analyseCondition, analyseLeaves, type Condition, compileComparisons, crossAt, LeafGrid, truthOf } from './region'
import { gridPoints, inView, pictureFirst, type Prepared, prepare, walk } from './statement'
import { CONTOUR, STATEMENT } from './tuning'
import type { Leaf, Sampled, Segment, StatementOptions } from './types'

export type SampledImplicit = Sampled

function emptyAnswer(counter: EvalCounter, badView: boolean): SampledImplicit {
  return { objects: [], capped: false, stats: { points: counter.points, intervals: counter.intervals }, tested: true, defined: true, badView, drawnInView: false, blankInView: false, leftOut: 0 }
}

// Whether any segment of a chain is in the view, or a vertex.
function meetsView(chains: readonly Chain[], v: { xMin: number; xMax: number; yMin: number; yMax: number }): boolean {
  for (const { xy } of chains) {
    for (let i = 0; 2 * i < xy.length; i++) {
      if (xy[2 * i] >= v.xMin && xy[2 * i] <= v.xMax && xy[2 * i + 1] >= v.yMin && xy[2 * i + 1] <= v.yMax) return true
      if (i > 0 && chordMeets(v, xy[2 * i - 2], xy[2 * i - 1], xy[2 * i], xy[2 * i + 1])) return true
    }
  }
  return false
}

export function sampleImplicit(left: Expr, right: Expr, where: Expr | null, view: View, scope: MathScope, options: StatementOptions): SampledImplicit {
  const h = sub(left, right)
  // compiled before the view is looked at: a statement the kernel refuses says so whatever the view
  const fns = compileContour(h, scope)
  const clause = where === null ? null : compileClause(where, scope)
  const counter: EvalCounter = { points: 0, intervals: 0 }
  const p = prepare(view, options)
  if (p === null) return emptyAnswer(counter, true)

  const quad = walk(implicitClassifier(fns.Hi), p, counter)
  if (quad === null) return emptyAnswer(counter, true)
  const leaves = pictureFirst(quad.leaves, p.bounds)
  const limit = p.budget

  // (with a clause to clip by, the contour is not given the last of the budget: the clipping has its own to spend)
  const share = clause === null ? 1 : 1 - STATEMENT.reserve
  const contour = contourLeaves(leaves, fns, { px: p.px, clip: p.root }, counter, { points: (limit.points - counter.points) * share, intervals: (limit.intervals - counter.intervals) * share })
  // leaves the contour could not reach or was not given: the picture may be missing a piece of the curve there
  const wide = (l: Leaf) => l.stop === 'budget' && ((l.x1 - l.x0) * p.px.x > CONTOUR.maxBudgetLeafPx || (l.y1 - l.y0) * p.px.y > CONTOUR.maxBudgetLeafPx)
  const eligible = leaves.filter((l) => !wide(l))
  let starved = leaves.some((l) => wide(l) && inView(l, p.bounds))
  if (contour.capped) starved = starved || eligible.slice(contour.stats.leaves).some((l) => inView(l, p.bounds))
  let capped = quad.capped || contour.capped || contour.refused

  // the `if` clause clips the pieces and the touch points
  let segments: Segment[] = contour.segments
  let touches: TouchPoint[] = contour.touches
  let touchLinks = contour.touchLinks
  if (clause !== null) {
    const clipped = clipByClause(segments, leaves, clause, p, counter)
    segments = clipped.segments
    if (clipped.capped) {
      capped = true
      starved = starved || clipped.starved
    }
    const keep = contour.touches.map((t) => clause.truthAt(t.x, t.y, counter))
    const index = new Map<number, number>()
    touches = contour.touches.filter((_, i) => {
      if (keep[i]) index.set(i, index.size)
      return keep[i]
    })
    touchLinks = contour.touchLinks.filter(([a, b]) => keep[a] && keep[b]).map(([a, b]) => [index.get(a) as number, index.get(b) as number])
  }

  const chains = buildChains(segments, p.px)
  const touch = buildTouchCurves(touches, touchLinks, p.px)
  const id = (object: string): MarkId => ({ statement: options.statement, object })
  const allChains = [...chains, ...touch.chains]
  const objects: SceneObject[] = [{ kind: 'curve', id: id('curve'), chains: allChains, breaks: [], color: options.color }]
  touch.points.forEach((at, i) => objects.push({ kind: 'mark', id: id(`value.${i}`), at, role: 'value', fill: 'filled', exact: false, color: options.color }))

  const drawnInView = meetsView(allChains, p.bounds) || touch.points.some((q) => q.x >= p.bounds.xMin && q.x <= p.bounds.xMax && q.y >= p.bounds.yMin && q.y <= p.bounds.yMax)
  const drawn = allChains.length > 0 || touch.points.length > 0

  // tested: the clause holds somewhere; defined: H has a value somewhere the clause holds. What was drawn says both; else a grid over the
  // view, and the corners the contouring read for `defined` where there is no clause to narrow them.
  let tested = clause === null || drawn
  let defined = drawn || (clause === null && contour.stats.definedCorners > 0)
  if (!(tested && defined)) {
    for (const q of gridPoints(p.bounds)) {
      const inside = clause === null || clause.truthAt(q.x, q.y, counter)
      if (inside) tested = true
      counter.points++
      if (inside && Number.isFinite(fns.H(q.x, q.y))) defined = true
      if (tested && defined) break
    }
  }
  return {
    objects,
    capped,
    stats: { points: counter.points, intervals: counter.intervals },
    tested,
    defined,
    badView: false,
    drawnInView,
    blankInView: !drawnInView && starved,
    leftOut: contour.stats.oversized + (contour.capped ? eligible.length - contour.stats.leaves : 0),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The `if` clause
// ---------------------------------------------------------------------------------------------------------------

interface Clause {
  analysis: Condition
  twin: CompiledInterval
  fns: ReturnType<typeof compileComparisons>
  // the clause's exact truth at a point: the scalar, counted
  truthAt: (x: number, y: number, counter: EvalCounter) => boolean
}

function compileClause(where: Expr, scope: MathScope): Clause {
  const analysis = analyseCondition(where)
  const twin = compileInterval(where, ['x', 'y'], scope)
  const fns = compileComparisons(analysis.comparisons, scope)
  const t = new Float64Array(analysis.comparisons.length)
  const truthAt = (x: number, y: number, counter: EvalCounter): boolean => {
    for (let k = 0; k < fns.length; k++) {
      counter.points++
      t[k] = compareValue(analysis.comparisons[k].op, fns[k].H(x, y), 0)
    }
    return truthOf(analysis.tree, t) === 1
  }
  return { analysis, twin, fns, truthAt }
}

// The pieces of the curve kept by the clause. See the header: proven true over the leaf keeps them, proven false drops them, and
// in a leaf that is neither each piece is cut where it crosses a chord of the clause's zero sets and kept where the clause is true at
// the middle of the part.
function clipByClause(segments: readonly Segment[], leaves: readonly Leaf[], clause: Clause, p: Prepared, counter: EvalCounter): { segments: Segment[]; capped: boolean; starved: boolean } {
  const out: Segment[] = []
  let capped = false
  let starved = false
  const grid = new LeafGrid(leaves)
  const byLeaf = new Map<number, Segment[]>()
  for (const s of segments) {
    const at = grid.at((s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2)[0]
    if (at === undefined) continue
    const list = byLeaf.get(at)
    if (list) list.push(s)
    else byLeaf.set(at, [s])
  }
  const over = () => counter.points >= p.budget.points || counter.intervals >= p.budget.intervals
  const scratch = iv()
  const ambiguous: number[] = []
  for (const li of [...byLeaf.keys()].sort((a, b) => a - b)) {
    const l = leaves[li]
    if (over()) {
      capped = true
      starved = starved || inView(l, p.bounds)
      continue
    }
    counter.intervals++
    clause.twin(scratch, l.x0, l.x1, l.y0, l.y1)
    if (scratch.lo > scratch.hi || (scratch.lo === 0 && scratch.hi === 0)) continue
    if ((scratch.lo > 0 || scratch.hi < 0) && scratch.v >= DEFINED) out.push(...(byLeaf.get(li) as Segment[]))
    else ambiguous.push(li)
  }
  if (ambiguous.length === 0) return { segments: out, capped, starved }

  // the zero sets of the clause's comparisons through the ambiguous leaves
  const amb = ambiguous.map((li) => leaves[li])
  const an = analyseLeaves({ leaves: amb, comparisons: clause.analysis.comparisons, tree: clause.analysis.tree, fns: clause.fns, px: p.px, clip: p.root, view: p.bounds, counter, limit: p.budget }, null)
  if (an.stats.capped || an.stats.refused > 0) capped = true
  if (an.stats.starvedInView) starved = true
  const decided = new Set<number>()
  an.todo.forEach((at, pos) => {
    if (an.unprocessed[pos]) return
    decided.add(at)
    const chords = an.pieces[pos].filter((c) => c.k >= 0)
    for (const s of byLeaf.get(ambiguous[at]) as Segment[]) {
      const ts = [0, 1]
      for (const c of chords) {
        const hit = crossAt(s.a, s.b, c.a, c.b)
        if (hit) ts.push(hit.t)
      }
      ts.sort((a, b) => a - b)
      const at01 = (t: number): Vec2 => (t === 0 ? s.a : t === 1 ? s.b : { x: s.a.x + t * (s.b.x - s.a.x), y: s.a.y + t * (s.b.y - s.a.y) })
      let start = -1
      for (let i = 0; i + 1 < ts.length; i++) {
        if (ts[i + 1] === ts[i]) continue
        const mid = (ts[i] + ts[i + 1]) / 2
        const inside = clause.truthAt(s.a.x + mid * (s.b.x - s.a.x), s.a.y + mid * (s.b.y - s.a.y), counter)
        if (inside && start < 0) start = ts[i]
        if (!inside && start >= 0) {
          out.push({ a: at01(start), b: at01(ts[i]) })
          start = -1
        }
      }
      if (start >= 0) out.push({ a: at01(start), b: at01(1) })
    }
  })
  // a leaf the analysis did not reach is left out, never kept unclipped
  ambiguous.forEach((li, at) => {
    if (!decided.has(at)) {
      capped = true
      starved = starved || inView(leaves[li], p.bounds)
    }
  })
  return { segments: out, capped, starved }
}
