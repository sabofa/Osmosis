// Shared types of the interval quadtree (calc P3) and what is built on it: implicit curves and
// regions. Pure data; nothing here evaluates anything.

// An axis-aligned rectangle of the plane, the cell of a subdivision: x0 < x1, y0 < y1, in world units. (Not
// the sampler's Box in plot/sample/types.ts, which is the twin's xLo/xHi/yLo/yHi enclosure of a curve over a
// range of its parameter.)
export interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
}

// What a classifier says of a cell.
//  - drop: nothing in it is wanted (an implicit curve: the twin says H has no zero there; a region: the
//    condition is proven false there). The cell is discarded.
//  - split: it may hold what is wanted and the classifier cannot tell more. It is halved until it is at most
//    the leaf size, where it is a leaf.
//  - keep-whole: all of it is wanted (a region: the condition is proven true there), and nothing more is to
//    be learned by subdividing it. It is recorded as it stands.
export type CellClass = 'drop' | 'split' | 'keep-whole'

// Why a leaf stopped being subdivided: it reached the leaf size (or the doubles could not halve it again),
// or the budget ran out while it was still pending, at whatever size it had then.
export type LeafStop = 'size' | 'budget'

// A cell the classifier could not clear, as small as the leaf size asks, or larger because the budget was
// spent. The leaves of 'size' are all the same size and meet edge to edge on exactly the same doubles (an
// edge is made once, by a halving, and both cells it separates inherit it), so a neighbour is found by an
// edge key. A leaf of 'budget' may be larger than its neighbours.
export interface Leaf extends Box {
  stop: LeafStop
}

// The answer of a subdivision, in the order it was found: depth first, the quadrants low-low, high-low,
// low-high, high-high (x varies fastest). Cells that were dropped are not reported.
export interface Subdivision {
  leaves: Leaf[]
  // The cells a classifier proved wholly wanted (keep-whole), as large as the cell it was proven at.
  whole: Box[]
  // The budget ran out before every pending cell was classified: the cells that were pending are among
  // `leaves`, with stop 'budget'.
  capped: boolean
}
