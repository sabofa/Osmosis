// A region statement through the interval quadtree (calc P3, task 4): the entry point, as P2's sampleCurve is the curve's.
//
//   sampleRegion(condition, comparisons, view, scope, options) -> { objects, capped, stats, tested, defined, ... }
//
// `condition` is the whole of the statement's condition as one Expr (math/reserved.ts): its comparison or chain, any `and` / `or` /
// `not`, and the `if` clause. `comparisons` are the comparisons in it, depth first and left to right, each as `h op 0` with
// h = a - b of the comparison `a op b` (region.ts comparisonsOf makes them from the condition; a caller that already has them
// gives them, and they must be the condition's own: the count and each operator are checked). The operators are what the boundary
// is dashed by: a strict one (< > !=) dashes its boundary, an inclusive one (<= >= =) draws it solid (and the other way round under a
// `not`: `not x < 1` holds at 1).
//
// WHAT IT DRAWS (the steps are in region.ts, outline.ts, quadtree.ts):
//  1. The quadtree over the view and its overscan, three-valued: the twin evaluates the condition on a cell; proven inside is kept
//     whole, proven outside (or undefined) is dropped, the rest is halved down to the leaf size.
//  2. Each leaf is cut by the zero sets of the comparisons (their bisected roots, shared by edge with the leaf beside, so fill and
//     boundary are one geometry) and by the edges of what is undefined; the pieces that are inside are kept.
//  3. The kept pieces' directed edges cancel where two share one, and what is left links into rings: the exact even-odd outline.
//  4. The stretches of the outline that lie on a comparison's zero set are its boundary curve, chained, `dashed` when strict.
//
// OUTPUT. One `region` object (id `<statement>/region`: the rings as closed chains with their arc length for a parameter, each ring
// from its smallest vertex, the region on the left of the way it runs: outer rings counter-clockwise, holes clockwise) and, for each
// comparison that has boundary in view, one `curve` (id `<statement>/boundary.<k>`, k the comparison's index; `breaks` empty) that
// `region.boundary` lists. Undefined is neither inside nor outside: the edge of the undefined area is on the outline and is nobody's
// boundary (a pole, the domain edge of ln x: a solid fill ends there and nothing is drawn along it), and nothing is joined across a
// pole or an undefined cell (the chords come from contour.ts's pieces, which are not drawn across one).
//
// BUDGET AND NOTES. One counter, one budget (tuning.ts ImplicitTuning.statement) for subdividing, contouring and clipping. At the cap
// the walk is held to the leaves the points budget can contour and the statement is drawn on bigger ones, all alike, `capped`; leaves
// a bigger one could not be cut (wider than a chord may span) or the spend did not reach are left out, never filled: a region
// coarsened is a smaller fill, never a false one. A view that is not a finite box of positive size, or a viewport of no px, draws
// nothing and says `badView`. A condition the kernel refuses throws its CompileError, for the caller to put on the statement's line.
import { compileInterval } from '../../math/interval'
import { compareValue, type ComparisonOp } from '../../math/reserved'
import type { MathScope } from '../../math/scope'
import type { Expr } from '../../parser/types'
import { chainOf } from '../../scene/chains'
import type { Chain, MarkId, SceneObject, Vec2 } from '../../scene/types'
import type { View } from '../sample/curve'
import type { EvalCounter } from '../sample/types'
import { buildChains } from './chains'
import { analyseCondition, type Comparison, clipLeaves, compileComparisons, conditionClassifier, truthOf } from './region'
import { EdgePool } from './outline'
import { gridPoints, inView, pictureFirst, prepare, walk } from './statement'
import type { Sampled, StatementOptions } from './types'

export type SampledRegion = Sampled

// A boundary is dashed when the zero set is not part of what the comparison holds on: a strict operator (< > !=), unless the comparison
// is negated (`not x < 1` holds at 1).
function dashed(op: ComparisonOp, negated: boolean): boolean {
  const strict = op === '<' || op === '>' || op === '!='
  return strict !== negated
}

function emptyResult(counter: EvalCounter, badView: boolean): SampledRegion {
  return { objects: [], capped: false, stats: { points: counter.points, intervals: counter.intervals }, tested: true, defined: true, badView, drawnInView: false, blankInView: false, leftOut: 0 }
}

// A ring as a closed chain: the arc length from its first vertex is the parameter.
function ringChain(ring: readonly Vec2[]): Chain {
  const param: number[] = [0]
  for (let i = 1; i < ring.length; i++) param.push(param[i - 1] + Math.hypot(ring[i].x - ring[i - 1].x, ring[i].y - ring[i - 1].y))
  return chainOf(ring, param, true)
}

export function sampleRegion(condition: Expr, comparisons: readonly Comparison[], view: View, scope: MathScope, options: StatementOptions): SampledRegion {
  const analysed = analyseCondition(condition)
  const own = analysed.comparisons
  if (own.length !== comparisons.length || own.some((c, k) => c.op !== comparisons[k].op)) {
    throw new Error(`sampleRegion: the comparisons are not the condition's own (${own.length} in the condition, ${comparisons.length} given, or their operators differ)`)
  }
  // compiled before the view is looked at, so that a statement the kernel refuses says so whatever the view
  const twin = compileInterval(condition, ['x', 'y'], scope)
  const fns = compileComparisons(comparisons, scope)
  const counter: EvalCounter = { points: 0, intervals: 0 }
  const p = prepare(view, options)
  if (p === null) return emptyResult(counter, true)

  // 1. the quadtree
  const sub = walk(conditionClassifier(twin), p, counter, comparisons.length)
  if (sub === null) return emptyResult(counter, true)

  // 2 and 3. the leaves cut, the outline from the pieces that are inside
  const pool = new EdgePool()
  for (const cell of sub.whole) pool.addBox(cell)
  const leaves = pictureFirst(sub.leaves, p.bounds)
  const clip = clipLeaves({ leaves, comparisons, tree: analysed.tree, fns, px: p.px, clip: p.root, view: p.bounds, counter, limit: p.budget, pool })
  const outline = pool.finish()

  // 4. the objects: the region, then each comparison's boundary
  const id = (object: string): MarkId => ({ statement: options.statement, object })
  const objects: SceneObject[] = []
  const boundary: MarkId[] = []
  const curves: SceneObject[] = []
  for (const k of [...outline.boundary.keys()].sort((a, b) => a - b)) {
    const chains = buildChains(outline.boundary.get(k) ?? [], p.px)
    if (chains.length === 0) continue
    const bid = id(`boundary.${k}`)
    boundary.push(bid)
    curves.push({ kind: 'curve', id: bid, chains, breaks: [], dashed: dashed(comparisons[k].op, analysed.negated[k]), color: options.color })
  }
  objects.push({ kind: 'region', id: id('region'), outline: outline.rings.map(ringChain), boundary, color: options.color }, ...curves)

  const drawnInView = clip.keptInView || sub.whole.some((c) => inView(c, p.bounds))
  const drawn = drawnInView || clip.kept > 0 || sub.whole.length > 0

  // defined: the condition is not undefined everywhere in the view: something is inside (a whole cell is proven defined, a kept
  // face is true), or a point of a grid over the view has a truth value
  let defined = drawn
  if (!defined) {
    const t = new Float64Array(comparisons.length)
    for (const q of gridPoints(p.bounds)) {
      for (let k = 0; k < comparisons.length; k++) {
        counter.points++
        t[k] = compareValue(comparisons[k].op, fns[k].H(q.x, q.y), 0)
      }
      const truth = truthOf(analysed.tree, t)
      // (a truth value of 0 or 1 is a point where the condition is defined; NaN is not)
      if (truth === truth) {
        defined = true
        break
      }
    }
  }
  return {
    objects,
    capped: sub.capped || clip.capped,
    stats: { points: counter.points, intervals: counter.intervals },
    tested: true,
    defined,
    badView: false,
    drawnInView,
    blankInView: !drawnInView && clip.starvedInView,
    leftOut: clip.unresolved + clip.refused,
  }
}
