// Shared types of the interval quadtree (calc P3) and what is built on it: implicit curves and
// regions. Pure data; nothing here evaluates anything.
import type { Verdict } from '../../math/interval'
import type { SceneObject, Vec2 } from '../../scene/types'

// An axis-aligned rectangle of the plane, the cell of a subdivision: x0 < x1, y0 < y1, in world units. (Not
// the sampler's Box in plot/sample/types.ts, which is the twin's xLo/xHi/yLo/yHi enclosure of a curve over a
// range of its parameter.)
export interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
}

// What a classifier is handed: the cell, and a place to say what the twin said of it. A classifier that
// has a twin verdict (implicitClassifier: the verdict of H over the box) writes it on `verdict` before it
// returns, and a cell that becomes a leaf carries it there. One that has none leaves it as it came, UNKNOWN,
// the weakest verdict: nothing is known of the cell. (A field written in place, so that a verdict costs no
// allocation: a cell is made once, by the walk, and is the classifier's own.)
export interface Cell extends Box {
  verdict: Verdict
}

// What a classifier says of a cell.
//  - drop: nothing in it is wanted (an implicit curve: the twin says H has no zero there; a region: the
//    condition is proven false there). The cell is discarded.
//  - split: it may hold what is wanted and the classifier cannot tell more. It is halved until it is about
//    the leaf size, where it is a leaf.
//  - keep-whole: all of it is wanted (a region: the condition is proven true there), and nothing more is to
//    be learned by subdividing it. It is recorded as it stands.
export type CellClass = 'drop' | 'split' | 'keep-whole'

// Why a leaf stopped being subdivided: it reached the leaf size (or the doubles could not halve it again), or
// the budget would not pay for the next level, so it is as small as the walk got.
export type LeafStop = 'size' | 'budget'

// A cell the classifier could not clear, as small as the leaf size asks (within a factor of sqrt 2) or, where
// the budget ran out, as small as the walk got: a coarser size, the same for every leaf of the run. Every leaf
// was classified, and carries the verdict the classifier gave it. The leaves of a run are one size and meet
// edge to edge on exactly the same doubles (an edge is made once, by a halving, and both cells it separates
// inherit it), so a neighbour is found by an edge key. (The one exception is a leaf the doubles stopped
// halving, which may be smaller than the rest. And a run whose budget is under 1 has nothing classified: its
// one leaf is the root, with the verdict UNKNOWN.)
export interface Leaf extends Box {
  stop: LeafStop
  verdict: Verdict
}

// The answer of a subdivision, in the order it was found: level by level (every cell of a level is looked at
// before any of the next), each parent's children low-low, high-low, low-high, high-high (x varies fastest),
// parents in the order they were found. Cells that were dropped are not reported.
export interface Subdivision {
  leaves: Leaf[]
  // The cells a classifier proved wholly wanted (keep-whole), as large as the cell it was proven at, the
  // largest first.
  whole: Box[]
  // The budget would not pay for the next level while cells remained to be halved: the leaves are then all
  // of stop 'budget', one size, coarser than the leaf size asks, and the caller says the statement was drawn
  // coarsely.
  capped: boolean
}

// What a statement-level entry point (implicit.ts's sampleImplicit, regions.ts's sampleRegion) is told besides the statement: as P2's
// CurveOptions, which the scene builder fills in the same way.
export interface StatementOptions {
  // the statement's index in the spec (the MarkId of what it draws)
  statement: number
  color: string | null
  quality: 'full' | 'coarse'
  // overrides the tuning's budget of the whole statement, for tests
  budget?: { points: number; intervals: number }
}

// What an entry point answers, as P2's SampledCurve does (the scene builder says the notes from it):
//  - `objects`: a curve (an implicit curve: `curve`, its isolated points as `value` marks), or a `region` and its `boundary.<k>`
//    curves; none if the view is bad (`badView`).
//  - `capped`: drawn coarsely. The statement's budget ran out in subdividing, contouring or clipping, or the walk stopped at leaves
//    too wide to draw a chord across: the picture is a coarser one, or has pieces of it missing, and the line says so.
//  - `tested` and `defined`: as the curve sampler's. `tested` is that the statement's own domain (an implicit curve's `if` clause)
//    holds at some point of the view, true where there is none, and always true of a region (its condition is its domain);
//    `defined` that the statement is not undefined everywhere in the view: some point of a grid over it, some corner the contouring
//    read or something drawn says it is defined (a grid can miss a stretch, so this errs toward defined). `tested && !defined` is
//    "undefined everywhere in view".
//  - `drawnInView`: some of what was drawn is in the picture (not only the overscan). `blankInView`: nothing is, and the picture
//    was not resolved: a leaf of it was left out for want of the budget or because it was too coarse. (Nothing drawn and nothing
//    left out is a statement that is not there: off screen, or empty.)
//  - `leftOut`: leaves not drawn, for the budget or because they could not be cut (a few a statement is a pixel each).
export interface Sampled {
  objects: SceneObject[]
  capped: boolean
  stats: { points: number; intervals: number }
  tested: boolean
  defined: boolean
  badView: boolean
  drawnInView: boolean
  blankInView: boolean
  leftOut: number
}

// A piece of a contour inside one leaf: the straight stretch between two points of the zero set. Its ends are
// the very objects the crossing cache keeps (a crossing is made once per leaf edge, and both leaves that share
// the edge hold the same object), or a corner of the grid where H is exactly zero, or the saddle point of a
// crossing: so two pieces that meet do so on exactly equal coordinates, and the chains join on them.
export interface Segment {
  a: Vec2
  b: Vec2
}
