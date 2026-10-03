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
  // The twin evaluations one generator may spend.
  intervalsPerGenerator: 6000,
  // The twin evaluations one call may spend, over all its generators.
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
