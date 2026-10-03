// Shared types of the adaptive 2D curve sampler (calc P2). Pure data; nothing
// here evaluates anything.

// How much evaluation a sampling run has spent. It counts UP: the sampler's
// budgets compare a limit against it, so every evaluator that takes one adds to
// it as it goes, and a caller that wants a spend for one stage subtracts two
// readings. `points` are scalar evaluations (compileScalar), `intervals` are
// twin evaluations (compileInterval).
export interface EvalCounter {
  points: number
  intervals: number
}
