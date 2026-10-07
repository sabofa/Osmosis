// The interval quadtree (calc P3, task 2): the one subdivision under implicit curves and regions. It
// takes a CLASSIFIER, which says of a rectangle of the plane whether it is wanted whole, not at all, or
// perhaps in part, and halves what it cannot decide until the cells are about a pixel. What it keeps is
// where the contouring (the next stage) has to look, and the cost is the length of the curve to follow,
// not the area of the view: a cell the classifier clears is never cut.
//
//  - An implicit curve F = G passes implicitClassifier: the twin's enclosure of H = F - G over the cell
//    drops it when it excludes zero, else the cell is split. It never proves a cell wanted.
//  - A region passes its own, three-valued: proven true is keep-whole (the cell is inside, and is kept as
//    the big cell it was found at), proven false is drop, anything else (it may be undefined there) splits.
//
// THE WALK. Depth first, with an explicit stack, and the four children of a cell in the order low-low,
// high-low, low-high, high-high (x fastest), so a run is the same run: two calls with the same arguments
// give the same leaves in the same order. A cell is halved on an axis only while it is wider than the leaf
// size on it, so the leaves are all one size and the two axes need not agree (a 10:1 view still gets
// leaves of about the leaf size in px, not 4 leaves where it needs 2). The depth each axis needs is
// counted once at the root (halvings), so a rounding at the leaf size cannot make one cell a leaf and its
// neighbour not. Halving is by the midpoint, and an edge made by a halving is inherited as the very same
// double by the cell on each side: leaves of the same size meet on exactly the same coordinates, so the
// contouring may key a shared edge by its endpoints. Where the doubles cannot halve a cell (its midpoint
// is one of its ends) it is a leaf of size, as fine as a cell gets.
//
// THE BUDGET. Every classifier call is one twin evaluation and is counted in counter.intervals; the budget is a
// spend, counted from where the counter stood when the call began (a counter that already carries other
// stages' work does not eat it), checked before each classification. When it is spent the cells still
// pending, the one about to be classified and everything the stack holds, become leaves at the size they
// have, with stop 'budget', and `capped` is set: the caller says the statement was drawn coarsely. A cell
// that was dropped or kept is never undone, so the leaves and the kept cells still cover everything that
// was not proven unwanted: a capped run holds every zero a complete one does, in fewer, larger cells.
// (Depth first spends the budget on the first quadrants at full resolution and leaves the later ones coarse
// at once; a breadth-first walk would lose resolution evenly. The order is the brief's.)
import { type CompiledInterval, type Iv, iv } from '../../math/interval'
import type { Bounds } from '../../scene/types'
import type { EvalCounter, PxScale } from '../sample/types'
import { QUADTREE } from './tuning'
import type { Box, CellClass, Leaf, LeafStop, Subdivision } from './types'

// One scratch for every classifier: an enclosure is read at once, and twin evaluations do not overlap
// (the twin's contract: one evaluation at a time).
const SCRATCH: Iv = iv()

// The root of a subdivision: the view widened by `overscan` of its size on each side.
export function rootBox(view: Bounds, overscan: number): Box {
  const dx = (view.xMax - view.xMin) * overscan
  const dy = (view.yMax - view.yMin) * overscan
  return { x0: view.xMin - dx, x1: view.xMax + dx, y0: view.yMin - dy, y1: view.yMax + dy }
}

// The classifier of an implicit curve: H = F - G is the twin's compile of the two sides, called with
// both boxes (x and y: the contract's rule that every declared variable is given its box). A cell is
// dropped by the contract's discard rule, valid under any verdict: the enclosure is above zero, below it,
// or empty (NaN everywhere; NaN is no zero). Anything else is split, including a cell the twin cannot
// bound (a pole, a domain edge, an integral): it is subdivided to the leaf size and the contouring
// decides there what is in it.
export function implicitClassifier(H: CompiledInterval, out: Iv = SCRATCH): (box: Box) => CellClass {
  return (box) => {
    H(out, box.x0, box.x1, box.y0, box.y1)
    return out.lo > 0 || out.hi < 0 || out.lo > out.hi ? 'drop' : 'split'
  }
}

// A cell of the walk: its box, and how many times each axis has been halved since the root.
interface Cell extends Box {
  lx: number
  ly: number
}

// How many halvings of an extent (px) it takes to get it to the leaf size, to the slack.
function halvings(extentPx: number, leafPx: number): number {
  let k = 0
  for (let w = extentPx; w > leafPx * (1 + QUADTREE.sizeSlack); w /= 2) k++
  return k
}

function leafOf(c: Box, stop: LeafStop): Leaf {
  return { x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, stop }
}

function positive(n: number): boolean {
  return n > 0 && n < Infinity
}

// `classify` is called once on each cell the walk reaches, with a box of its own (it may keep it; the
// extra fields it carries are the walk's, not part of the contract). The root is the caller's box, copied.
// `leafPx` is the size, in screen px, a cell is halved down to on each axis, `pxPerUnit` the scale that
// makes a cell's world size px. A root that is not a finite box of positive extent, a leaf size or scale
// that is not a positive finite number, and a budget that is NaN or negative are RangeErrors: the caller
// owns the view, and an empty answer for a bad one would be a silent one. (A budget of 0 is a valid one:
// the root is a leaf of 'budget' at once.)
export function subdivide(
  classify: (box: Box) => CellClass,
  root: Box,
  leafPx: { x: number; y: number },
  pxPerUnit: PxScale,
  counter: EvalCounter,
  budget: { intervals: number },
): Subdivision {
  if (!(Number.isFinite(root.x0) && Number.isFinite(root.x1) && Number.isFinite(root.y0) && Number.isFinite(root.y1) && root.x0 < root.x1 && root.y0 < root.y1)) {
    throw new RangeError(`subdivide: the root must be a finite box of positive size, got x ${root.x0}..${root.x1}, y ${root.y0}..${root.y1}`)
  }
  if (!(positive(leafPx.x) && positive(leafPx.y))) throw new RangeError(`subdivide: the leaf size must be positive and finite, got ${leafPx.x} by ${leafPx.y} px`)
  if (!(positive(pxPerUnit.x) && positive(pxPerUnit.y))) throw new RangeError(`subdivide: the scale must be positive and finite, got ${pxPerUnit.x} by ${pxPerUnit.y} px a unit`)
  if (!(budget.intervals >= 0)) throw new RangeError(`subdivide: the budget must be a number of evaluations, 0 or more, got ${budget.intervals}`)
  // a finite root at a finite scale can still be an infinite number of px, which no number of halvings gets down to a leaf
  const widthPx = (root.x1 - root.x0) * pxPerUnit.x
  const heightPx = (root.y1 - root.y0) * pxPerUnit.y
  if (!(Number.isFinite(widthPx) && Number.isFinite(heightPx))) throw new RangeError(`subdivide: the root is ${widthPx} by ${heightPx} px, which is not a size`)

  const kx = halvings(widthPx, leafPx.x)
  const ky = halvings(heightPx, leafPx.y)
  const limit = counter.intervals + budget.intervals
  const leaves: Leaf[] = []
  const whole: Box[] = []
  const stack: Cell[] = [{ x0: root.x0, x1: root.x1, y0: root.y0, y1: root.y1, lx: 0, ly: 0 }]
  let capped = false

  while (stack.length > 0) {
    if (counter.intervals >= limit) {
      // spent: what is pending, in the order the walk would have reached it
      capped = true
      for (let i = stack.length - 1; i >= 0; i--) leaves.push(leafOf(stack[i], 'budget'))
      break
    }
    const c = stack.pop() as Cell
    counter.intervals++
    const verdict = classify(c)
    if (verdict === 'drop') continue
    if (verdict === 'keep-whole') {
      whole.push({ x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1 })
      continue
    }

    const mx = (c.x0 + c.x1) / 2
    const my = (c.y0 + c.y1) / 2
    const splitX = c.lx < kx && mx > c.x0 && mx < c.x1
    const splitY = c.ly < ky && my > c.y0 && my < c.y1
    if (!splitX && !splitY) {
      leaves.push(leafOf(c, 'size'))
      continue
    }
    const nx = splitX ? 2 : 1
    const ny = splitY ? 2 : 1
    const lx = c.lx + (splitX ? 1 : 0)
    const ly = c.ly + (splitY ? 1 : 0)
    // pushed last to first, so that the first is popped first: low-low, high-low, low-high, high-high
    for (let j = ny - 1; j >= 0; j--) {
      const y0 = j === 0 ? c.y0 : my
      const y1 = splitY && j === 0 ? my : c.y1
      for (let i = nx - 1; i >= 0; i--) {
        const x0 = i === 0 ? c.x0 : mx
        const x1 = splitX && i === 0 ? mx : c.x1
        stack.push({ x0, x1, y0, y1, lx, ly })
      }
    }
  }
  return { leaves, whole, capped }
}
