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
  // twin evaluations, decide what it holds. (The twin cannot exclude zero near a
  // hard double zero, and bisecting that to tolRel would take every evaluation
  // there is.)
  coarseRel: 2 ** -20,
  // The scalar samples taken evenly over each bracket, its ends included.
  clusterSamples: 16,
}
