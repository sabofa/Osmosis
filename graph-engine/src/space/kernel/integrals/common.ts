// What the S5 builders share: approximate values and their readouts, the
// floor a region is drawn on, and the tolerance that decides when a sampled
// piece (a boundary edge, a wall, a face) has collapsed.

import type { GraphConfig } from '../../../parser/config'
import type { Statement } from '../../../parser/types'
import { QuadratureError } from '../../../math/quadrature'
import { QUAD_BUDGET, S5_SAFETY } from '../../../math/tolerance'
import { APPROX, formatNumber, SIGNIFICANT_DIGITS, supportedDigits, MAX_DIGITS } from '../../pick/format'
import type { LabelAnchor, SceneError, Vec3 } from '../../scene/types'
import type { SpaceForm } from '../../grammar/types'
import type { BuildContext } from '../registry'

// A numeric answer. `error` bounds |value - true value|: the method's own
// honest estimate, never below what the arithmetic can resolve (errorFloor).
// `scale` is the integral of |g|, what the value is small or large against.
// `singular` (S5 fix round 4, C1's belt and braces): the run leaned on a
// singularity treatment somewhere (the power rule, a frozen panel, a pole
// nudge, an anchor split, or a decay chain's tail) — its error is already
// multiplied by 10 for this by the caller that set it, and formatters here
// also floor its digits at SIGNIFICANT_DIGITS, never trusting more from an
// estimate that leaned on a heuristic.
// `mesh` (S5 breaker follow-up, F1a): a bounded inequality-region mesh sum's
// own error (the larger of the last two changes, plus the boundary gap and
// rounding) is a direct measurement of that sum's own behaviour across
// resolutions, not an adaptive quadrature's heuristic decay estimate — the
// kind SAFETY exists to cover for. It skips SAFETY. A singular mesh sum
// (already floored ×10, C1's belt and braces) still leans on the same kind
// of heuristic tail estimate as quadrature does, so it keeps SAFETY.
export interface Approx {
  value: number
  error: number
  scale: number
  singular?: boolean
  mesh?: boolean
}

// What floating point can resolve in an integral: this fraction of the
// integral of |g|. A quadrature estimate says nothing about rounding, so a
// value that cancels (the moment of a symmetric region) would otherwise print
// its rounding noise, 2×10⁻¹⁷, as if it were a value.
export const ROUNDING_REL = 1e-13

// "≈ 0" is shown only for a value within its error when that error is also
// at most this fraction of the integral of |g|: the value is then known to be
// negligible against the integrand, not merely unknown (x^(-2/3) over the
// cube, 3 ± 1000, is not "≈ 0").
export const ZERO_REL = 1e-3

// The floored error; ×10 when the run leaned on a singularity treatment
// (C1's belt and braces): its own estimate, however carefully tracked, is
// still built on heuristics (a decay ratio, a substitution's mismatch), so
// it is trusted to one order of magnitude less than a plain qk15 error.
export function errorFloor(error: number, absolute: number, rel: number, singular = false): number {
  const floor = Math.max(error, rel * Math.abs(absolute))
  return singular ? floor * 10 : floor
}

function isZero(a: Approx): boolean {
  return Math.abs(a.value) <= a.error && a.error <= ZERO_REL * Math.abs(a.scale)
}

// A value may be shown when it is negligible (≈ 0) or known to at least one
// significant digit; anything less is refused, never printed. The half-value
// test itself keeps the raw, unscaled error (S5 breaker ruling, F1c: values
// do not start refusing that are honestly shown at one coarse digit under
// SAFETY) — but a value that clears it can still fail to find any honest
// nonzero unit to show under SAFETY (chosenDisplay returning null, F1b,
// "when no unit works"), and is refused here too, before any caller
// formats it.
export function determined(a: Approx): Approx {
  if (isZero(a) || (a.error < Math.abs(a.value) / 2 && chosenDisplay(a) !== null)) return a
  throw new IntegralRefusal(
    `the integral could not be determined to one significant digit (≈ ${formatNumber(a.value)} ± ${formatNumber(a.error)}) — try tighter bounds or a finer res:`,
  )
}

function shown(a: Approx): number {
  return isZero(a) ? 0 : a.value
}

// `value` rounded to the nearest multiple of 10^p — p may be larger than
// value's own leading exponent (a unit coarser than its leading digit: nine
// point four rounded to the nearest ten is 10, not 9).
function roundToUnit(value: number, p: number): number {
  const unit = 10 ** p
  return Math.round(value / unit) * unit
}

// Whether showing `value` rounded to the unit 10^p is honest (S5 breaker
// ruling, F1b): the gap rounding itself introduces, plus SAFETY times the
// stated error, must fit within half that unit — not the error alone
// (round 5's rule), since at the worst rounding position the gap alone can
// already claim most of a unit. `error` is already SAFETY-scaled by the
// caller (digitsOf): a singular result's error already carries C1's own
// ×10 belt-and-braces, so this is ×1000 in total for one.
function honestAt(value: number, error: number, p: number): boolean {
  const rounded = roundToUnit(value, p)
  return Math.abs(rounded - value) + error <= 10 ** p / 2
}

// The digits `formatNumber` needs to reproduce `rounded` (itself already a
// multiple of 10^p) without rounding it any further — read off ITS OWN
// exponent, not the pre-rounding value's, since rounding can carry into the
// next order of magnitude.
function digitsAt(rounded: number, p: number): number {
  return rounded === 0 ? 1 : Math.max(1, Math.floor(Math.log10(Math.abs(rounded))) - p + 1)
}

// S5 breaker follow-up, F1c: SAFETY's own search (chosenDisplay, below) can
// fail every unit, all the way to 0, even when the RAW (unscaled) error
// honestly supports one significant digit — or one unit coarser than
// that — on its own: SAFETY is a conservatism margin against a heuristic
// error estimate being wrong by a wide margin, not a claim that a small,
// already-honest error somehow is not. Tried only as this last resort,
// after SAFETY's own search finds no unit at all (the pin: |x-0.5|^-0.7,
// whose singular ×10-floored error is tiny beside SAFETY but plenty tiny
// on its own, prints a correct one-digit prefix, not a refusal).
function honestFallback(raw: number, error: number, leading: number): { value: number; digits: number } | null {
  for (const p of [leading, leading + 1]) {
    const rounded = roundToUnit(raw, p)
    if (rounded !== 0 && honestAt(raw, error, p)) return { value: rounded, digits: digitsAt(rounded, p) }
  }
  return null
}

// The value and digit count a readout shows an estimate to (S5 breaker
// ruling, F1): coarsened, one unit at a time, from what SAFETY times the
// stated error supports (supportedDigits), capped at SIGNIFICANT_DIGITS
// for a singularity treatment (C1's belt and braces), until showing it
// there is honest (honestAt) — possibly past the leading digit, to a unit
// larger than the value itself. A bounded mesh sum's own error (`mesh`,
// F1a) is a direct measurement, not a heuristic decay estimate, and skips
// SAFETY. Failing that entirely falls back to `honestFallback` (F1c)
// before finally giving up: a value that fails even that is left to the
// caller's own half-value refusal instead, which judges the raw, unscaled
// error, not this one. Adaptive error estimates are heuristic and were
// measured up to 29x short of the truth on some kinks (S5_SAFETY).
function chosenDisplay(a: Approx): { value: number; digits: number } | null {
  const raw = shown(a)
  if (raw === 0) return { value: 0, digits: 1 }
  const cap = a.singular ? SIGNIFICANT_DIGITS : MAX_DIGITS
  const error = (a.mesh ? 1 : S5_SAFETY) * a.error
  const leading = Math.floor(Math.log10(Math.abs(raw)))
  let p = leading - Math.min(cap, supportedDigits(raw, error)) + 1
  for (;;) {
    const rounded = roundToUnit(raw, p)
    if (rounded === 0) return honestFallback(raw, a.error, leading)
    if (honestAt(raw, error, p)) return { value: rounded, digits: digitsAt(rounded, p) }
    p++
  }
}

export function approxText(a: Approx): string {
  const d = chosenDisplay(a)
  if (!d) return refusedDisplay(a)
  return `${APPROX} ${formatNumber(d.value, d.digits)}`
}

// "≈ (0.6667, 0.3333)": each coordinate to the digits its own estimate supports.
export function approxTupleText(values: readonly Approx[]): string {
  const parts = values.map((a) => {
    const d = chosenDisplay(a)
    return d ? formatNumber(d.value, d.digits) : '?'
  })
  return `${APPROX} (${parts.join(', ')})`
}

// Text for a value chosenDisplay could not honestly show at any nonzero
// unit — reached only if a caller formats without going through determined
// first (determined refuses this same case, F1b, "the existing half-value
// refusal applies"), kept here so approxText itself never throws.
function refusedDisplay(a: Approx): string {
  return `${APPROX} ${formatNumber(a.value)} (undetermined)`
}

// An integral with no value, in words an author can act on: returned as an
// error on the statement's line while the figure still draws.
export class IntegralRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntegralRefusal'
  }
}

// A quadrature's refusal, naming its levels' variables (outer first).
// A level of a quadrature, outer first: its variable, and its bounds as the
// author wrote them (for "the bound sqrt(x - 0.5) is not a number").
export interface QuadLevel {
  name: string
  lower: string
  upper: string
}

// " at x = 0.5", " at (x, y) = (0, 0.5)": the levels that know where.
function place(err: QuadratureError, levels: readonly QuadLevel[], upTo: number, word: string): string {
  const known = levels.slice(0, upTo).flatMap((level, i) => (typeof err.at[i] === 'number' ? [[level.name, err.at[i] as number] as const] : []))
  if (known.length === 0) return ''
  if (known.length === 1) return ` ${word} ${known[0][0]} = ${formatNumber(known[0][1])}`
  return ` ${word} (${known.map((e) => e[0]).join(', ')}) = (${known.map((e) => formatNumber(e[1])).join(', ')})`
}

// A quadrature's refusal in words:
// - divergence: "the integral does not converge: it grows without bound near x = 0";
// - NaN in the integrand: "the integral is undefined: the integrand is not a number at (x, y) = ...";
// - NaN in a bound: "the bound sqrt(x - 0.5) is not a number at x = 0.4";
// - the budget: "the integral did not settle within 6,000,000 evaluations" (QUAD_BUDGET) — never "does not converge";
// - a singular point whose pieces shrink too slowly to judge (x^-0.99 at 0):
//   "the integral did not settle near x = 0: ..." — never "does not converge";
// - a divergence claim only one pass made, downgraded (I1c): "the integral
//   did not settle near x = 0" alone, without a reason the passes' mere
//   disagreement does not actually tell (S5 fix round 5).
export function refusalOf(err: QuadratureError, levels: readonly QuadLevel[]): IntegralRefusal {
  switch (err.reason) {
    case 'diverges': {
      const where = place(err, levels, levels.length, 'near')
      return new IntegralRefusal(`the integral does not converge: it grows without bound${where}`)
    }
    case 'undefined':
      return new IntegralRefusal(`the integral is undefined: the integrand is not a number${place(err, levels, levels.length, 'at')}`)
    case 'bound': {
      const { level, side } = err.bound ?? { level: 0, side: 'lower' as const }
      const text = levels[level] ? (side === 'lower' ? levels[level].lower : levels[level].upper) : 'a bound'
      return new IntegralRefusal(`the bound ${text} is not a number${place(err, levels, level, 'at')}`)
    }
    case 'slow': {
      const where = place(err, levels, levels.length, 'near')
      // A divergence claim downgraded because the two passes disagreed on
      // it (unsettled(), I1c) is not a genuine decay too slow to judge —
      // "the pieces shed there shrink too slowly" would misstate why
      // (S5 fix round 5).
      if (err.downgraded) return new IntegralRefusal(`the integral did not settle${where}`)
      return new IntegralRefusal(
        `the integral did not settle${where}: the pieces shed there shrink too slowly to tell a value from divergence in floating point`,
      )
    }
    case 'budget': {
      const where = place(err, levels, levels.length, 'near')
      // A level's own panel cap ran out, not the whole pass's evaluations
      // (M1): its own few thousand is not honestly "within 6,000,000".
      if (err.panelCap) return new IntegralRefusal(`the integral did not settle${where}`)
      return new IntegralRefusal(
        `the integral did not settle within ${QUAD_BUDGET.toLocaleString('en-US')} evaluations${where ? ` (it was still refining${where})` : ''}`,
      )
    }
  }
}

// Runs a quadrature over `levels`, turning its refusal into words.
export function quadrature<T>(levels: readonly QuadLevel[], run: () => T): T {
  try {
    return run()
  } catch (err) {
    if (err instanceof QuadratureError) throw refusalOf(err, levels)
    throw err
  }
}

// Runs an integral; a refusal becomes an error on the statement's line and
// null, so the caller draws what it can.
export function attempt<T>(context: BuildContext, errors: SceneError[], run: () => T): T | null {
  try {
    return run()
  } catch (err) {
    if (!(err instanceof IntegralRefusal)) throw err
    errors.push({ line: context.line, message: err.message })
    return null
  }
}

// A piece is collapsed when its size is at most this fraction of the whole
// figure's (a length against the diagonal, an area against the diagonal
// squared): a side x = 1 whose bounds meet, the centre r = 0, a wall of zero
// height. Real pieces are many orders above it.
export const COLLAPSED_REL = 1e-9

// Where a region is drawn: the box floor when @bounds3d states z, else the
// xy-plane. The kernel builds before the frame's automatic bounds exist, and
// the xy-plane is where the region lives.
export function floorHeight(config: GraphConfig): number {
  return config.space.bounds.z?.min ?? 0
}

export function part(context: BuildContext, name: string): BuildContext['source'] {
  return { ...context.source, object: `${context.source.object}.${name}` }
}

// The statement's readout: an annotation anchored at `position`.
export function readoutLabel(context: BuildContext, position: Vec3, text: string): LabelAnchor {
  return { source: part(context, 'readout'), position, text, kind: 'annotation' }
}

// The form a builder was registered for.
export function formOf<F extends SpaceForm['form']>(statement: Statement, form: F): Extract<SpaceForm, { form: F }> {
  if (statement.kind !== 'space' || statement.form.form !== form) throw new Error(`not a ${form}: ${statement.kind}`)
  return statement.form as Extract<SpaceForm, { form: F }>
}
