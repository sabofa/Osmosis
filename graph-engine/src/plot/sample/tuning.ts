// Every tuned number of the adaptive sampler (calc P2) lives here, so tuning
// against the corpus is one file and no number hides in a stage. Each stage adds
// its own block; this is the first.

// The zero locator (locate.ts): isolating the zeros of the trouble-spot
// generators in the sampled range.
export const LOCATE = {
  // The most zeros one range reports. Past it the result says it was cut.
  maxZeros: 64,
  // The twin evaluations one generator may spend. A generator whose zeros never
  // settle (cos(1/x) near 0) stops here, and the result says it was cut.
  intervalsPerGenerator: 6000,
  // A box is a leaf when it is no wider than tolRel * max(1, |t|): the zero is
  // then known to about twelve digits, and a sign bisection takes it to the
  // last double.
  tolRel: 1e-12,
}
