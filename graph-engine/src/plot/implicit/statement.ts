// What the two entry points of calc P3's implicit stage share (implicit.ts, regions.ts): checking the view, the tuning and the budget of
// one statement, walking the quadtree under it, the picture first, and the grid that says whether a statement is defined anywhere in view.
import type { Bounds, Vec2 } from '../../scene/types'
import type { View } from '../sample/curve'
import type { EvalCounter, PxScale } from '../sample/types'
import { subdivide } from './quadtree'
import { COARSE, FULL, GRID, type ImplicitTuning, STATEMENT } from './tuning'
import type { Box, Cell, CellClass, Leaf, StatementOptions, Subdivision } from './types'

// A statement ready to be drawn: its tuning, the budget of the whole of it, the screen scale, and the root of the quadtree.
export interface Prepared {
  tuning: ImplicitTuning
  budget: { points: number; intervals: number }
  px: PxScale
  root: Box
  bounds: Bounds
}

function positive(n: number): boolean {
  return Number.isFinite(n) && n > 0
}

// The view the statement is drawn in, checked: finite bounds of positive extent, a viewport of finite positive px, and a root box and a
// scale that are numbers. A bad one is null, and the entry point answers with no objects and `badView`, which the scene builder turns
// into a note: an empty answer for it, with nothing said, would be a silent one (the quadtree throws RangeError on the same input,
// and that is not let escape).
export function prepare(view: View, options: StatementOptions): Prepared | null {
  const { bounds, widthPx, heightPx } = view
  const finite = [bounds.xMin, bounds.xMax, bounds.yMin, bounds.yMax].every(Number.isFinite)
  if (!finite || !(bounds.xMin < bounds.xMax) || !(bounds.yMin < bounds.yMax) || !positive(widthPx) || !positive(heightPx)) return null
  const tuning = options.quality === 'coarse' ? COARSE : FULL
  const dx = (bounds.xMax - bounds.xMin) * tuning.overscan
  const dy = (bounds.yMax - bounds.yMin) * tuning.overscan
  const root: Box = { x0: bounds.xMin - dx, x1: bounds.xMax + dx, y0: bounds.yMin - dy, y1: bounds.yMax + dy }
  const px: PxScale = { x: widthPx / (bounds.xMax - bounds.xMin), y: heightPx / (bounds.yMax - bounds.yMin) }
  if (!positive(px.x) || !positive(px.y) || !Number.isFinite(root.x1 - root.x0) || !Number.isFinite(root.y1 - root.y0)) return null
  if (!Number.isFinite((root.x1 - root.x0) * px.x) || !Number.isFinite((root.y1 - root.y0) * px.y)) return null
  return { tuning, budget: options.budget ?? tuning.statement, px, root, bounds }
}

// The quadtree under the statement's budget: the walk may spend the subdivision's share of the twin evaluations, and may hold only as
// many cells as the rest of the budget can contour (STATEMENT.pointsPerLeaf points and intervalsPerLeaf twin evaluations each, and one
// more twin evaluation for each of the `comparisons` of a region, which the clipping asks of every leaf). Null if the quadtree refused
// its arguments, which the checks above make impossible.
export function walk(classify: (cell: Cell) => CellClass, p: Prepared, counter: EvalCounter, comparisons = 0): Subdivision | null {
  const intervals = Math.min(p.tuning.budget.intervals, Math.floor(p.budget.intervals * STATEMENT.subdivisionShare))
  // the leaves the rest of the budget can contour: by its points, and by its twin evaluations (what the subdivision may not take), each
  // leaf costing the twin of every comparison over it and the contour's own
  const cells = Math.floor(Math.min(p.budget.points / STATEMENT.pointsPerLeaf, (p.budget.intervals * (1 - STATEMENT.subdivisionShare)) / (STATEMENT.intervalsPerLeaf + comparisons)))
  try {
    return subdivide(classify, p.root, { x: p.tuning.leafPx, y: p.tuning.leafPx }, p.px, counter, { intervals, cells })
  } catch (err) {
    if (err instanceof RangeError && err.message.startsWith('subdivide:')) return null
    throw err
  }
}

export function inView(l: Box, v: Bounds): boolean {
  return l.x1 >= v.xMin && l.x0 <= v.xMax && l.y1 >= v.yMin && l.y0 <= v.yMax
}

// The leaves, those that touch the picture first and the overscan after, each group in the order the walk made it: a budget that
// runs out in the contouring leaves the overscan out, not the view.
export function pictureFirst(leaves: readonly Leaf[], view: Bounds): Leaf[] {
  const seen: Leaf[] = []
  const rest: Leaf[] = []
  for (const l of leaves) (inView(l, view) ? seen : rest).push(l)
  return [...seen, ...rest]
}

// The points of the grid over the view (GRID.samples on each axis, the edges included), the same for every call.
export function gridPoints(view: Bounds): Vec2[] {
  const n = GRID.samples
  const out: Vec2[] = []
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) out.push({ x: view.xMin + ((view.xMax - view.xMin) * i) / (n - 1), y: view.yMin + ((view.yMax - view.yMin) * j) / (n - 1) })
  }
  return out
}
