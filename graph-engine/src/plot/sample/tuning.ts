// Every tuned number of the adaptive sampler (calc P2) lives here, so tuning
// against the corpus is one file and no number hides in a stage. Each stage adds
// its own block; this is the first.

// The zero locator (locate.ts): isolating the zeros of the trouble-spot
// generators in the sampled range, in two phases. The twin brackets them coarsely;
// scalar samples inside each bracket say what is there.
export const LOCATE = {
  // The most zeros one range reports. Past it the ones nearest the centre of the
  // range are kept, and the result says it was cut. (The same number, times 8, is
  // the most separate brackets one generator may have before its search is cut.)
  maxZeros: 64,
  // The twin evaluations one generator may spend on its search: 2 / coarseRel, which
  // bisecting the whole range down to the coarse width takes at most (2 * 2^12 - 1),
  // so a generator's own budget never cuts the search short: the whole of a narrow
  // window can be one hard zero's band (an expanded double root, zoomed in on). It
  // stops a search that has not got to the coarse width because the call's total ran out.
  intervalsPerGenerator: 8192,
  // The twin evaluations one call may spend, over all its generators and the checks
  // after them. This is the real limit.
  intervalsTotal: 20000,
  // A zero is located to tolRel * max(1, |t|): the width the bisections and the
  // golden-section search stop at.
  tolRel: 1e-12,
  // The twin stops bisecting a box that may hold a zero at this fraction of the
  // range: a bracket narrow enough that the scalar samples inside it, not more
  // twin evaluations, decide what it holds. Sub-pixel is enough (about 0.2 px
  // across a view-sized range), because phase 2 restores the precision; a finer
  // width only costs: the twin cannot exclude zero in a band around a hard double
  // zero, which holds about 2 sqrt(2/w) boxes of width w (an expanded square
  // x^2 - 2x + 1, on [0.9, 1.1], used the whole budget at 2^-20). The width is also
  // the narrowest stretch of exact zeros that is reported as a stretch.
  coarseRel: 2 ** -12,
  // The scalar samples taken evenly over each bracket, its ends included.
  clusterSamples: 16,
  // A bracket wider than this many coarse boxes in which the samples show two sign
  // changes or more may hold more zeros than 16 samples count (cos(1/x) near 0, or
  // tan(1000 x) over a view): the result says it was cut. Zeros further apart than a
  // coarse box are told apart by the twin, so brackets that wide hold crowds.
  unresolvedLeaves: 4,
}

// The one-sided limits (limits.ts): what a trouble spot is, read from the curve's
// values at a geometric run of offsets on each side of it. Distances are screen
// pixels throughout, so a limit is "reached" when the eye cannot tell the samples
// from it.
export const LIMITS = {
  // The offsets are h0 / shrink^k for k = 0 … steps. From the step worth 4 px, 4^12
  // takes the last one to about 6e-9 in a 20-unit view: far enough in for any
  // limit that converges at a pixel-visible rate, and not so far that the offsets
  // reach the cancellation noise. Each step is a factor of 4, so 12 cover seven decades.
  steps: 12,
  shrink: 4,
  // The offsets stop at minRel * max(1, |tc|): below it cancellation noise, which
  // grows like machine epsilon / h, is no longer under a pixel's tenth. For
  // (x^2 - 1)/(x - 1) it is 4e-6 px at 1e-9 and reaches a tenth of a pixel near 4e-14;
  // a worse-conditioned function, or a more zoomed view, reaches it at a larger offset,
  // which is the reason for the margin.
  minRel: 1e-9,
  // A side converges when its last `window` finite samples lie within convergePx of
  // each other: a shrinking oscillation (x sin(1/x)) is inside the window when its
  // amplitude is. Four samples are a factor of 64 apart in offset. sqrt(x) at 0, the
  // slowest edge that is common, spreads 0.022 px over them in a 20-unit view: under
  // half of convergePx, and a window of six samples would fail it.
  window: 4,
  // A twentieth of a pixel: a limit and a sample this close are drawn on the same dot.
  // It is also what "equal" means when two limits, or a limit and a value, are compared.
  convergePx: 0.05,
  // The geometric test: the last 3 differences must each be at most this much of the
  // one before. A smooth limit shrinks them 4-fold (0.25); x^0.1 shrinks them 0.87-fold
  // and is rejected by it (its tail is six pixels), so this is not where slow
  // convergence is let in. The tail it estimates is d r / (1 - r): bounded by 9 d here.
  convergeRatio: 0.9,
  // The divergence test: each step of the distance from the first sample is at least
  // this much of the one before. ln(x) holds it constant (1.0), 1/x grows it 4-fold,
  // and x^0.1, whose steps shrink 0.87-fold, is left out. Slower convergence than
  // about x^0.03 cannot be told from ln(x) by 13 samples; it reads as divergence.
  divergeRatio: 0.95,
  // The run of steps (divergeRun + 1 samples) the divergence test looks at: 5 steps of
  // ln(x) are 5 * 55 px, past any noise, and 5 steps of 1/x are 4^5-fold.
  divergeRun: 5,
  // And the growth of those steps must be steady: the largest ratio of one step's growth
  // to the one before is at most this many times the smallest. A pole's are alike (1/x:
  // 4 4 4 4; 1/x^2: 16 16 16 16; ln: 1 1 1 1; 1/x^30, tan, 1/x + 1/x^2, sin(x)/x^2 the
  // same) and measure a spread of 1.00. Higher-order cancellation noise (x - sin x over
  // x^3, at the smallest offsets) grows the run's distance every step too, but by ratios
  // of 18, 4.4, 80, 1.2: a spread of 68. The noise that comes closest to steady is
  // exp(x) - 1 - x over x^2 at 100 and 400 px (9.2 8.8 24 25, a spread of 2.8): it grows
  // about 16-fold a step like a pole of order 2, because its numerator is a few ulps. So
  // 2: well above a pole's 1.00, which leaves room for rounding, and under noise's 2.8.
  divergeSpread: 2,
  // The last this-many samples all NaN make a side undefined. Fewer is not enough: a
  // function defined on a scatter of points (sqrt(sin(1/x)) near 0) is NaN at some
  // offsets and finite at others, and a stray NaN at the end is not a domain edge.
  undefinedRun: 3,
  // The confirming samples of a converging side are taken at these multiples of the
  // last offset, each between it and the one before (1 < factor < shrink), and BOTH must
  // agree. They have to be off the lattice h0 / shrink^k, and irrational is how: every
  // offset has 1/x = shrink^k / h0, so a function periodic in 1/x with a period that
  // divides that (sin(pi/x), cos(pi/x), 1/x - floor(1/x), at h0 = 0.1 and 0.08 from
  // k = 2) reads the same everywhere on the lattice and looks like a hole. A rational
  // factor can land on it again: at f = 2 the sample sits at 1/x = shrink^k / (2 h0),
  // which for sin(pi/x) at h0 = 0.1 is pi * 5 * 4^k, a whole number of periods again, so
  // it reads 0 like the lattice. With sqrt 2 the step from the lattice,
  // (1/f - 1) shrink^k / h0, is irrational for a rational h0, so it is never a whole
  // number of periods of any rational period. (A view whose h0 is itself a multiple of
  // pi is not covered by that argument.)
  // One sample is not enough. A function that sits at a maximum on the lattice
  // (cos(pi/x), cos(2 pi/x)) agrees with a given off-lattice sample whenever the phase
  // lands within 0.05 rad of a multiple of 2 pi, about one time in sixty, and with
  // enough views some do: cos(pi/x) read as a hole at h0 = 0.2 and on 11 of 96 round
  // views (2 to 100 units wide, 400 to 1920 px), cos(2 pi/x) on 6, cos(3 pi/x) on 5,
  // and sign(x) cos(pi/x) as a jump. A second sample at the golden ratio is independent
  // of the first: the factors are not related by a power of 2 (phi / sqrt 2 is not one),
  // as they would have to be for the second sample to be the first one halved or doubled,
  // or for it to be a lattice point (4^m times a lattice offset). Both agreeing is about
  // one in thousands; none of the 96 views gets through (0 of 96 for each of those).
  confirmFactors: [Math.SQRT2, (1 + Math.sqrt(5)) / 2],
  // Two limits count as equal when they are within convergePx on screen (and so does a
  // limit and the point's own value). A limit read from a retried tail (above) carries
  // noise of about convergePx, so two of them can be nearly twice that apart:
  // (exp(x) - 1 - x)/x^2 at 1600 px read as a jump between 0.50000001 and 0.50004066,
  // 0.065 px. This many times convergePx when either limit came from a retried tail: 2,
  // because each is within about convergePx of the true one. Measured over the five
  // cancellation families at 15 zooms (75 cases, 59 of them holes), the worst limit is
  // 0.068 px off ((tan(x) - x)/x^3 at 2500 px) and the next 0.044; so 2 has room. A limit
  // from the whole sequence keeps convergePx (a clean 0.07 px step is a jump).
  retriedEqualFactor: 2,
  // A side that is neither converged nor steadily diverged, and has no tight tail,
  // retries the convergence tests (window, geometric, the confirming sample) on its
  // sequence with the last 1, then 2, then up to this many samples dropped, and takes
  // the first that holds. The floor minRel covers noise of order eps/h; a numerator that
  // cancels to a higher order (x - sin x, exp(x) - 1 - x, 1 - cos x, tan x - x, over x^3
  // or x^2) has noise of eps/h^2 or worse, which is under a pixel's twentieth for most
  // of the offsets and then jumps: it is at the last few, and they are what is dropped.
  // How many is a matter of zoom: the noise is a fixed size in the function and a pixel
  // is smaller the further in the view is, so more offsets are over it. At 40 px per unit
  // dropping 3 is enough, at 400 and 4000 px per unit it takes 5. Swept over four such
  // functions at 14 zooms from 20 to 40000 px per unit: 4 gives 29 holes of 56, 5 gives
  // 44, 6 gives 46, 7 gives the same 46. The ten left are at 2000 px per unit and over,
  // where the noise is the function and unknown is honest. 6: the first where more
  // dropping changes nothing.
  noiseDrop: 6,
}
