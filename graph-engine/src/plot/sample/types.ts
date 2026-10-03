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

// One point of a curve at parameter t: writes out[0] = x and out[1] = y, NaN in
// the coordinate that is undefined there. A y = f(x) curve writes out[0] = t.
export type PointFn = (t: number, out: Float64Array) => void

// Screen pixels per world unit on each axis (they differ when the view's axes are
// not 1:1). Limits are compared in pixels, so what the eye cannot tell apart is equal.
export interface PxScale {
  x: number
  y: number
}
