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
  // was drawn coarsely. This is the subdivision's share of `statement`, not more spend on top of it: the entry points
  // (implicit.ts, regions.ts) give the walk the lesser of this and STATEMENT.subdivisionShare of the statement's intervals.
  budget: { intervals: number }
  // THE STATEMENT'S BUDGET, one for the whole statement: the subdivision, the contouring and the clipping of its leaves all spend it,
  // on one counter, points (scalar evaluations) and intervals (twin evaluations) each against its own. Past it the leaves not yet
  // reached are left out and the statement says it was drawn coarsely; before that, the walk is held to the leaves the points
  // budget can contour (STATEMENT.pointsPerLeaf), so that a statement too dear for FULL is drawn on bigger leaves, whole, and not
  // cut short.
  statement: { points: number; intervals: number }
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
//
// THE STATEMENT'S BUDGET (task 4) is the whole spend of a statement, the subdivision above and what is built on its leaves, and it is set against
// what the stages cost together on the same views ([-10, 10]^2, 800 px; points / twin evaluations, FULL then COARSE; the contouring
// and clipping of the leaves of the quadtree above, for each statement):
//   y = tan(x)                    732945 / 135857    174843 / 30518     (the chase for a pole, in every period)
//   y < tan(x)                    647254 / 157238    157148 / 35555     (as a region: the same chords, and the fill up to each pole)
//   sin(x) = cos(y)               370650 /  74997    102413 / 17189     (a lattice of nodes: the critical points of H)
//   sin(x) < cos(y)               291450 /  94419     81522 / 21975
//   x^2 - y^2 = 1                  75126 /  15701     20790 /  3845
//   y > 1/x                       130023 /  21777     28618 /  6713
//   xy > 1                         30600 /  10131      8704 /  2491
//   1 < x^2 + y^2 < 4              12360 /   4981      3536 /  1253
//   x^2 + y^2 < 4 and y > 0         4541 /   2465      1317 /   613
//   x^2 + y^2 = 4 if y > 0         10424 /   2811      2952 /   739
// 1,200,000 points is 1.6 times the dearest at FULL (the curve y = tan x), 300,000 1.7 times the dearest at COARSE (also y = tan x); 400,000
// twin evaluations (of which the subdivision may spend half, the 200000 above) is 2.5 times the dearest at FULL, 100,000 2.8 times at
// COARSE. A statement that costs more is a crowd: the walk is held to the leaves the budget can contour (STATEMENT.pointsPerLeaf and
// intervalsPerLeaf), so it is drawn on bigger leaves, all of it, and says so (sin(10x) = cos(10y): capped at FULL after 0.46 million points
// and 22 thousand twin evaluations, at COARSE after 0.10 million and 5 thousand; sin(x^2 + y^2) = 0.3 likewise).
export const FULL: ImplicitTuning = { leafPx: 1, overscan: 0.25, budget: { intervals: 200000 }, statement: { points: 1200000, intervals: 400000 } }
// COARSE draws the same curve on 4 px leaves, two halvings fewer: the cells along the curve are a quarter as
// many, so it costs about a quarter of FULL, and its budget is a quarter of FULL's.
export const COARSE: ImplicitTuning = { ...FULL, leafPx: 4, budget: { intervals: 50000 }, statement: { points: 300000, intervals: 100000 } }

// How the statement's budget is shared out between the stages (the entry points, implicit.ts and regions.ts).
export const STATEMENT = {
  // The subdivision may spend this fraction of the statement's twin evaluations, at most (and no more than ImplicitTuning.budget):
  // the rest is for the contouring and the clipping of the leaves it makes (a twin evaluation of each comparison over each leaf, the
  // chase for a pole, the checks of a piece).
  subdivisionShare: 0.5,
  // What contouring and clipping a leaf costs, in scalar evaluations, as the quadtree must reckon it before it walks: a circle costs
  // about 10 a leaf, y - tan x about 19 (the chase for each pole), a region more by the comparisons that share its leaves. The walk
  // is held to the leaves the points budget buys at this price; a statement that costs more than that a leaf is cut short by its own
  // budget and says so, one that costs less is drawn at the size asked.
  pointsPerLeaf: 24,
  // And in twin evaluations: the contour's own for a leaf (a pole, an edge not proven continuous: 1.5 a leaf for y = tan x, the
  // dearest of the common forms), which is paid besides the twin of each comparison over the leaf that a region asks (one more for each
  // of its comparisons). The walk is held to the leaves the statement's twin evaluations that the subdivision may not take can pay at
  // this price, and the twin of the leaves is not bought with what their contour needs.
  intervalsPerLeaf: 3,
  // The last of the budget that contouring is not given: cutting the leaves it reached costs points of its own, and a budget the contour
  // spent whole would leave every leaf it did reach uncut and the picture blank.
  reserve: 0.1,
}

// What a region's entry points sample to decide whether it is defined anywhere in the view (the same question the curve sampler's start
// grid answers): H, or the condition, at this many points across the view on each axis. A grid cannot prove a statement undefined: it
// can miss a stretch narrower than its spacing, so a statement is called undefined only when the grid, the corners the contouring read
// and what was drawn all say so.
export const GRID = { samples: 33 }

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
  // value MAY hold an X (two curves crossing in it: xy = 0, sin x sin y = 0 at its nodes); the X is drawn only if it is
  // certified (CRITICAL.probePx), and otherwise the leaf draws the two arcs. The gate is a cheap first test: a saddle
  // value that is not small beside the corners is two branches too far apart for an X.
  crossRel: 0.02,
  // The twin subdivision that finds the poles and undefined stretches of an edge that shows no sign change stops at this
  // many px (2^-12): a gap that narrow is a point. A curve beside a pole (1/x - y at |y| = 150 is 0.0067 from it) is
  // found beyond it.
  gapPx: 2 ** -12,
  // The most twin evaluations the subdivision of one edge may spend; past it what is still undecided is a gap (an
  // edge that is undefined or unbounded all along is not subdivided to the bottom).
  gapEvals: 128,
  // In a leaf whose twin is UNKNOWN (an integral term anywhere in H) a piece is drawn only if H is defined at this many points evenly along
  // it: the twin cannot vouch for the piece's box, and H at its middle alone misses a strip off the middle (a chord across a coarse leaf is
  // slanted). 7 sees a strip wider than an eighth of the piece; these are scalar points, a few a piece, in the few leaves that have no better test.
  chordSamples: 7,
  // A leaf the quadtree stopped halving only because the budget ran out ('budget') is contoured only up to this many px
  // on a side: a leaf of 679 px (a starved quadtree) is not a place to draw a chord. The chords of the leaves allowed are
  // true at their ends and off the curve by about (leaf size)^2 / (8 radius): 0.2 px for a leaf of 18.75 px on a circle
  // of 200 px. Past it the leaf is left out and the result says so (ContourResult.refused).
  maxBudgetLeafPx: 24,
  // The same limit for a REGION. A chord across a wide leaf is a false fill when the leaf holds more than the one crossing the
  // chord assumes (sin(x^2+y^2) < 0.3 filled 16 % too much at 24 px); a region coarsened is a smaller fill, never a false one, so a
  // wide 'budget' leaf is refused (leftOut, capped) rather than chorded. Measured on the default view (+-10, 800 px) at FULL (leaves 9.4 px) and COARSE (wider):
  // sin(x^2+y^2) < 0.3 FULL had outline area 621.5 against 535.5 (9,192 of 90,000 grid points false-filled, more than 0.05 from an edge) with
  // any limit from 9.5 up, and none with 9 or less; COARSE 643.2 and sin(10x) < cos(10y) COARSE 455.8 (against 448.2) likewise at 12 and 24, none at 9.
  // So 9, the widest that is clean: it refuses every leaf of those pictures (areas 24.8, 5.3, 0: small, never false, capped) and leaves the
  // circle at budgets of 2,000 and 20,000 points drawn.
  maxRegionBudgetLeafPx: 9,
}

// The critical point of H in a leaf (calc P3, task 3 fix round 1): two curves cross where grad H = 0 and H = 0, and
// the corners of a leaf cannot always show it (a crossing along the diagonals of the leaves shows no sign change at
// all). A leaf where both partials change sign over its corners holds a critical point; Newton's steps find it, the
// Hessian says which directions the zero set leaves it in, and each arm is followed out of the leaf.
export const CRITICAL = {
  // Newton steps on grad H = 0 from the leaf centre; the iterate must stay inside the leaf. The partials of a crossing
  // are nearly linear over a leaf, so the steps converge in three or four.
  steps: 8,
  // The iterate has converged when a step moves it less than this many px.
  convergedPx: 2 ** -10,
  // A node that comes to rest within this many px of an edge of the leaf (or past it: a node on a grid line is on the edge of the leaf either
  // side of it) is taken to be on it and put exactly there; the node is then solved once, in the box of the leaves that share that edge or
  // corner. 2^-8 px is four times the step it converged by, and far from the half px it is certified at.
  edgeTolPx: 2 ** -8,
  // The X is certified by H at this many px from its centre along the bisector of each pair of adjacent arms: the four
  // signs must alternate. Two branches that only pass near each other (xy = e) alternate at a radius only if sqrt(2 e)
  // is under it, so a certified X is within half a px of both curves, which is the bound the chains are held to.
  probePx: 0.5,
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
