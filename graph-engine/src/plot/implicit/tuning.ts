// Every tuned number of the interval quadtree and what is built on it (calc P3: implicit curves and
// regions), so tuning against the corpus is one file and no number hides in a stage. Each stage adds its
// own block; this is the first, and the stage that follows (contouring a leaf) adds its own next to it.

// The preset of one quality. FULL is a settled view, COARSE a view being dragged (the interaction budget,
// as in the sampler: plot/sample/tuning.ts).
export interface ImplicitTuning {
  // A leaf of the quadtree is at most this many screen px on each side: the finest the zero set is resolved
  // on a settled view, and the width a contour is placed to before it is refined by bisection.
  leafPx: number
  // The root of the subdivision is the view widened by this fraction of its size on each side, so a curve
  // leaves the picture, not the sampled region, at the edge you can see (and a gesture may move the last
  // picture over the screen before it is rebuilt). The same 25 % as the sampler's clip box.
  overscan: number
  // Twin evaluations the subdivision may spend on one statement, counted from where it began. Past it the
  // cells still pending are leaves at the size they had, and the statement says it was drawn coarsely.
  budget: { intervals: number }
}

// The budgets are set against what the subdivision costs on the views that are common and dear, measured at
// [-10, 10]^2 and 800 px (twin evaluations, FULL / COARSE): a circle of radius 5 10917 / 2725 (8.7 a pixel of
// its perimeter), xy = 1 16245 / 4021, x^2 - y^2 = 1 31509 / 7797, sin(x) = cos(y) 152685 / 36333 and
// y = tan(x) 164085 / 35669 (a lattice and a pole at every period are the dearest a plain view gets). 250000
// is 1.5 times the dearest of those at FULL, 60000 1.65 times at COARSE: past them a curve is a real
// crowd (sin(10x) = cos(10y) is 1.3 million at FULL), which is drawn coarsely, and says so. A cell costs
// 0.4 to 1.8 us, so the whole of FULL's budget is under half a second. The corpus pins these (task 7).
export const FULL: ImplicitTuning = { leafPx: 1, overscan: 0.25, budget: { intervals: 250000 } }
// COARSE draws the same curve on 4 px leaves, two halvings fewer: the cells along the curve are a quarter as
// many, so it costs about a quarter of FULL, and its budget is a quarter of FULL's.
export const COARSE: ImplicitTuning = { ...FULL, leafPx: 4, budget: { intervals: 60000 } }

// The parts of the subdivision that are not a quality knob, so not in ImplicitTuning but still numbers that
// were chosen.
export const QUADTREE = {
  // A cell is "at most the leaf size" when it is that to this relative slack. A cell's width in px is the
  // root's, halved, and a root that is a power of two times the leaf size lands on the leaf size to
  // rounding: without the slack a cell a pixel to the last bit would be halved once more. A billionth.
  sizeSlack: 1e-9,
}
