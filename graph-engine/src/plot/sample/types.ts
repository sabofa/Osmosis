// Shared types of the adaptive 2D curve sampler (calc P2). Pure data; nothing
// here evaluates anything.
import type { Verdict } from '../../math/interval'
import type { Bounds, Vec2 } from '../../scene/types'

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

// The twin's enclosure of a curve over a range of its parameter: every point the
// curve takes there lies in [xLo, xHi] x [yLo, yHi]. Empty (xLo > xHi or yLo > yHi)
// means the curve is undefined on the whole range. Bounds may be infinite: the twin's
// CONTINUOUS does not mean bounded.
export interface Box {
  xLo: number
  xHi: number
  yLo: number
  yHi: number
}

// What the adaptive core needs of one curve. The core never sees an expression.
export interface CurveFns {
  point: PointFn
  // The twin of both coordinates over [tLo, tHi], written into `out`, and the worse of
  // the two verdicts. Counted by the caller, not here.
  enclose(tLo: number, tHi: number, out: Box): Verdict
  // The inner evaluations the point function has made so far, ever (a count that only goes up; absent where a point costs
  // no more than a point): an integral's integrand, which is evaluated as often as the quadrature asks, thousands of times
  // for one point of 5000 cos(100 t). The core reads it before and after each evaluation and charges the budget for what
  // it cost (CORE.innerPerPoint), so a curve of dear points is capped and not left to run.
  work?: () => number
  // Screen pixels per parameter unit: sets the density of the start grid and the
  // width, in pixels, of an interval at the sub-pixel floor.
  pxPerT: number
  // Where a band could form (calc P2 task 6): an explicit y = f(x) oscillates in y,
  // x = f(y) in x; a polar or parametric curve has no such axis and gets no bands.
  oscillationAxis: 'y' | 'x' | null
}

// The screen a range is sampled for: pixels per world unit on each axis, the
// visible view, and the clip box, the view widened by the overscan (25 % each side). The sink clips to the clip
// box and the core culls against it; the view is where the core decides that something it has to say is
// visible (adaptive.ts steepInView).
export interface Screen {
  px: PxScale
  view: Bounds
  clip: Bounds
}

// How the core treats one end of its parameter range.
//  - free: an ordinary end, evaluated.
//  - anchor: the curve is known to reach `at` here, from the limit of a hole or a jump,
//    where the function itself is undefined or elsewhere. The core uses the point and
//    does not evaluate at the end, and draws the stretch that reaches it even where the
//    twin cannot vouch for that stretch (next to a hole its enclosure is unbounded).
//  - singular: a pole or an edge of the domain is here. The core never evaluates at the
//    end itself, only a floor's width (1/16 px) inside it.
export type End = { kind: 'free' } | { kind: 'anchor'; at: Vec2 } | { kind: 'singular' }
