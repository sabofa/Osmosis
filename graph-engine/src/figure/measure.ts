import type { GraphConfig } from '../parser/config'
import type { Arc } from '../scene/geometry/circles'
import { GEOM_EPS } from '../scene/geometry/types'
import type { Vec2 } from '../scene/types'

// Measures — the quantities a label can name, computed from the geometry the
// construction layer already solved.
//
// This file is the answer to the thing v1 could not do: a measure was free
// text an author typed, and nothing checked it against the figure. Here a
// measure is *read off the drawing*, and the `= <value>` form is a check
// rather than a caption.

export type AngleMode = GraphConfig['angle']

// ---------------------------------------------------------------------------
// The quantities
// ---------------------------------------------------------------------------

export function segmentLength(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

// The non-reflex angle at `vertex` between the rays to `from` and `to`, in the
// unit `@angle` selects.
//
// atan2 of the cross and dot products rather than acos of the normalised dot:
// acos loses most of its precision near 0 and π — exactly where a figure's
// interesting angles sit (a right angle is fine, a 179-degree angle is not) —
// because the derivative of acos is unbounded there. atan2 is well conditioned
// across the whole range.
//
// A degenerate arm — the vertex and one endpoint coincident — measures zero
// rather than NaN, and it does so through atan2 itself: both products are
// then zero and `Math.atan2(0, 0)` is 0. Worth stating because the obvious
// guard against it is dead code, and dead code here would read as though the
// case were handled somewhere it is not.
export function angleMeasure(vertex: Vec2, from: Vec2, to: Vec2, mode: AngleMode): number {
  const u = { x: from.x - vertex.x, y: from.y - vertex.y }
  const v = { x: to.x - vertex.x, y: to.y - vertex.y }
  const cross = u.x * v.y - u.y * v.x
  const dot = u.x * v.x + u.y * v.y
  const radians = Math.atan2(Math.abs(cross), dot)
  return mode === 'degrees' ? (radians * 180) / Math.PI : radians
}

// G2 — an arc's measure and the central angle drawn for it are the same
// number, so they are computed here and nowhere else.
//
// The input is the arc itself, not a pair of endpoints, because the arc
// already carries the signed sweep its direction resolved to (see
// scene/geometry/circles.ts). That is the whole mechanism: a label reading
// "arc PQ" and a central-angle mark for the same arc cannot disagree, because
// neither of them decides which way round the arc goes — the arc did, once.
//
// A major arc therefore measures more than a straight angle, which the angle
// at the centre measured with `angleMeasure` cannot express: that function
// returns the non-reflex angle by construction, and printing it for a major
// arc would quietly label a 216-degree arc as 144.
export function arcMeasure(arc: Arc, mode: AngleMode): number {
  const radians = Math.abs(arc.sweep)
  return mode === 'degrees' ? (radians * 180) / Math.PI : radians
}

// ---------------------------------------------------------------------------
// F2 — the one formatter
// ---------------------------------------------------------------------------

// Every number a measure label prints passes through here.
//
// **That single seam is the point of the function, more than the rounding
// is.** Exact and symbolic display is specced and lands later; when it does,
// a measure has to be able to print `√50` and `π/6` instead of `7.071` and
// `0.524`. Routing every measure through one call makes that a change in one
// place. A renderer that formatted numbers inline at each call site would
// make it a sweep, and a sweep is how one of them gets missed.
//
// Three decimals: a competition figure's measures are small integers and
// simple surds, so three digits distinguishes 7.071 from 7.07 without
// printing the noise of a six-step construction chain. Distinct from svg.ts's
// `fmt`, which rounds *coordinates* for byte-stable markup — same number of
// digits today, but they answer to different requirements and must be free to
// diverge.
const MEASURE_PRECISION = 3

export function formatMeasure(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot print ${value} as a measure — a measured value must be a finite number`)
  }
  let s = value.toFixed(MEASURE_PRECISION)
  if (s.includes('.')) s = s.replace(/\.?0+$/, '')
  // A measure that rounds to nothing prints "0", never "-0": which side of
  // zero a rounding error landed on is not information about the figure.
  if (s === '-0' || s === '') return '0'
  return s
}

// An angle measure carries its unit in degrees mode and none in radians,
// matching how the subject is written: "30°" and "π/6". Until exact values
// land the radian form prints a decimal (F2), which is why the degree sign is
// the only unit marker here.
export function formatAngleMeasure(value: number, mode: AngleMode): string {
  return mode === 'degrees' ? `${formatMeasure(value)}°` : formatMeasure(value)
}

// ---------------------------------------------------------------------------
// F1 — the asserting form
// ---------------------------------------------------------------------------

export interface MeasureCheckOptions {
  // False under `@scale: false`. The not-to-scale flag exists precisely to
  // permit a label to disagree with the drawing, so it suppresses the check
  // rather than weakening it.
  toScale: boolean
  // Phase 12 — an area is asserted to the precision it prints: a shaded
  // region's area is almost always irrational (16 − 4π), and until exact
  // values land (build-order step 3) an author can only write it as the
  // decimal the label prints. So "= 3.434" holds for 3.43363…, while 3.43,
  // 3.435 and 4 do not.
  printed?: boolean
}

// Returns a message when a stated value contradicts the figure, or null when
// it does not.
//
// The tolerance is GEOM_EPS scaled by the magnitude of the values, which is
// the same relative-tolerance policy every predicate in scene/geometry uses —
// deliberately the one constant, not a second one calibrated for labels. A
// construction chain's residual grows with the coordinates it runs through,
// so an absolute tolerance would reject correct figures drawn at large scale
// and accept wrong ones drawn small.
export function checkMeasure(subject: string, stated: number, computed: number, options: MeasureCheckOptions): string | null {
  if (!options.toScale) return null
  const relative = GEOM_EPS * Math.max(1, Math.abs(stated), Math.abs(computed))
  const tolerance = options.printed ? Math.max(relative, 0.5 * 10 ** -MEASURE_PRECISION) : relative
  if (Math.abs(stated - computed) <= tolerance) return null
  return (
    `"${subject} = ${formatMeasure(stated)}" disagrees with the figure — the geometry gives ${formatMeasure(computed)}. ` +
    `Fix the construction, write "${subject} = x" for a symbolic value, or set "@scale: false" if the figure is deliberately not to scale.`
  )
}
