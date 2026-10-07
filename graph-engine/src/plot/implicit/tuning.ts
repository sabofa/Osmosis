// Every tuned number of the interval quadtree and what is built on it (calc P3: implicit curves and
// regions), so tuning against the corpus is one file and no number hides in a stage. Each stage adds its
// own block; this is the first, and the stage that follows (contouring a leaf) adds its own next to it.

// The preset of one quality. FULL is a settled view, COARSE a view being dragged (the interaction budget,
// as in the sampler: plot/sample/tuning.ts).
export interface ImplicitTuning {
  // The size, in screen px on each side, a leaf of the quadtree is halved down to: the resolution the zero set
  // is found at on a settled view, and the width a contour is placed to before it is refined by bisection. A
  // cell is halved while it is wider than QUADTREE.halveAbove (sqrt 2) times this, so a leaf is within a factor of
  // sqrt 2 of it, above or below (a 1200 px root at leafPx 1 comes to 1.17 px, at 4 to 4.69).
  leafPx: number
  // The root of the subdivision is the view widened by this fraction of its size on each side, so a curve
  // leaves the picture, not the sampled region, at the edge you can see (and a gesture may move the last
  // picture over the screen before it is rebuilt). The same 25 % as the sampler's clip box.
  overscan: number
  // Twin evaluations the subdivision may spend on one statement, counted from where it began. It is spent a
  // level at a time: the walk stops before the level it cannot pay for whole, and the cells it could not clear
  // at the last level it paid for are the leaves, all of one size, coarser than leafPx; the statement says it
  // was drawn coarsely.
  budget: { intervals: number }
}

// The budgets are set against what the subdivision costs on the views that are common and dear, measured at
// [-10, 10]^2 and 800 px (twin evaluations, FULL / COARSE; leaves of 1.17 and 4.69 px):
//   circle of radius 5            5461 / 1365   (4.3 a pixel of its perimeter)
//   xy = 1                        8093 / 1981
//   x^2 - y^2 = 1                15701 / 3845
//   sin(x) = cos(y)              74997 / 17189  (a lattice)
//   y = tan(x)                   78477 / 15469  (a pole at every period)
//   x^2 - 2xy + y^2             127237 / 14997  (a form that expands: the twin's enclosure of a cancelling form is
//                                                loose, so a band of cells it cannot clear runs along the line)
//   (x + 1)^2 - x^2 - 2x - 1 + y 131589 / 29901
//   tan(x) = tan(y)             152261 / 32293  (a lattice of poles)
// 200000 is 1.5 times the dearest of the common forms at FULL (the expanded ones, 131589; and 1.3 times the lattice
// of poles), 50000 1.55 times the dearest at COARSE (32293). Past them a curve is a crowd (sin(10x) = cos(10y) is
// 596917 at FULL, exp(x^2) - exp(x^2) + x - y 1.2 million), and is drawn at the coarser size the budget pays for,
// all of it, and says so. A cell costs 0.2 to 2.4 us, so the whole of FULL's budget is under half a second.
// The corpus pins these (task 7).
export const FULL: ImplicitTuning = { leafPx: 1, overscan: 0.25, budget: { intervals: 200000 } }
// COARSE draws the same curve on 4 px leaves, two halvings fewer: the cells along the curve are a quarter as
// many, so it costs about a quarter of FULL, and its budget is a quarter of FULL's.
export const COARSE: ImplicitTuning = { ...FULL, leafPx: 4, budget: { intervals: 50000 } }

// The parts of the subdivision that are not a quality knob, so not in ImplicitTuning but still numbers that
// were chosen.
export const QUADTREE = {
  // A cell is halved while it is wider than this many leaf sizes. With 1 a leaf would land between half the leaf
  // size and the leaf size, and on average under it: 0.586 px for a 1 px leaf in a 1200 px root, where 1.17 is
  // the nearer halving to 1 (it is 0.17 over, 0.41 under for 0.586) and costs half as much. sqrt 2 puts every
  // leaf within a factor of sqrt 2 of the size asked, above or below, which is as near as halving can come: the
  // finer half of the range is not paid for a resolution nobody asked for.
  halveAbove: Math.SQRT2,
  // A cell is "not wider than" its limit (halveAbove leaf sizes) to this relative slack. A cell's width in px is
  // the root's, halved, and a root that is a power of two times the limit lands on it to rounding: without the
  // slack a cell on the limit to the last bit would be halved once more. A billionth.
  sizeSlack: 1e-9,
}

// Contouring a leaf (calc P3, task 3): where the zero set crosses a leaf, and how a crossing is told from a
// pole or a jump.
export const CONTOUR = {
  // A crossing on a leaf edge is bisected on H until the bracket is this many screen px wide (2^-12 of a px: about
  // 12 steps from a 1 px leaf, 14 from a 4 px one). Far finer than anything drawn: the vertex is the zero to a
  // thousandth of a px, so the vertices of a curve lie on it and the chains join without cracks.
  bisectPx: 2 ** -12,
  // The most steps one bisection takes (a bracket of adjacent doubles is reached sooner).
  maxBisect: 64,
  // The most further steps the chase for a pole takes, from the 2^-12 px bracket to machine width: a 1 px leaf at
  // 40 px a unit is 2^-12 px = 6e-6 units wide, and 2^-52 relative of a coordinate near 1 is 2e-16, 35 steps.
  maxChase: 80,
  // The chase asks the twin whether the bracket has become CONTINUOUS (a root, not a pole) every this many steps, so
  // a root whose first twin enclosure was loose is let go early; the verdict at machine width decides the rest.
  chaseCheck: 16,
  // A sign change whose twin is not CONTINUOUS down to machine width and that is not a pole is a root only if H is
  // continuous across it: |H(hi) - H(lo)| over the bracket must have shrunk, from its width at 2^-12 px to its width
  // at machine width, to at most this fraction. A continuous H shrinks it with the bracket (by 2^-35 or so); a jump
  // (floor, mod, a piecewise seam) keeps it all, a pole grows it.
  jumpShrink: 0.25,
  // A leaf whose four edges all cross and whose bilinear saddle value is within this fraction of its largest corner
  // value is drawn as an X through the saddle point: two curves crossing in it (xy = 0, sin x sin y = 0 at its nodes),
  // not two near-miss arcs. The worst case for the X is two branches close but not touching, xy = e at the middle of a
  // square leaf of side h: the corners are +-h^2/4 - e, the saddle value -e, and the branches pass sqrt(2e) from the
  // saddle point, where the X's vertex is. At e = crossRel * h^2/4 that is h * sqrt(crossRel / 2): 0.12 px at FULL and 0.47
  // at COARSE for 0.02, where the chains are held to half a px (0.1 would be 0.26 and 1.05 px). Above it the leaf draws
  // the two arcs, which pass within about that of each other.
  crossRel: 0.02,
}

// A leaf the twin cannot clear whose corners show no sign change (a double root: (x - y)^2 = 0; a point:
// x^2 + y^2 = 0; the cusp of y^2 = x^3 beside the branches) is searched for a touch point, and its touch points are
// chained.
export const TOUCH = {
  // Newton steps toward the zero of H along its gradient, from the leaf centre, the iterate held in the leaf. A
  // double root halves its distance each step, so 8 steps leave a 256th of the leaf.
  steps: 8,
  // The leaf is a touch point if |H| / |grad H| (the first-order distance to the zero set) at the iterate is under
  // this many px: the spec's half a px.
  maxPx: 0.5,
  // The iterate has converged when |H| / |grad H| is under this many px: the point is a zero for every purpose.
  convergedPx: 2 ** -8,
  // Touch points within this many px of each other are one point: the four leaves round a grid corner that is the
  // point x^2 + y^2 = 0, the columns either side of the double line x^2 = 0.
  mergePx: 0.25,
  // |H| / |grad H| is small near a pole as well (H is large there and its gradient larger), where Newton's steps carry
  // |H| UP. A zero's iterates bring it down: at the last iterate |H| must be at most this fraction of its value at the
  // leaf centre (unless it has converged).
  descent: 0.5,
  // A cluster of touch points no more than this many px across is one filled point, not a curve: a curve of that length
  // is a mark to the eye.
  pointPx: 2,
}
// (A leaf that shares a corner with a leaf that drew a piece of the contour is not searched at all: the contour
// already speaks for it, and a touch point there would be a dot beside a curve: at a singular point the corners
// cannot see, at the cusp of y^2 = x^3, at a leaf the twin was loose about.)
