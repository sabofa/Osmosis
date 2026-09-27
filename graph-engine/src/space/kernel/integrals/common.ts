// What the S5 builders share: approximate values and their readouts, the
// floor a region is drawn on, and the tolerance that decides when a sampled
// piece (a boundary edge, a wall, a face) has collapsed.

import type { GraphConfig } from '../../../parser/config'
import type { Statement } from '../../../parser/types'
import { QuadratureError } from '../../../math/quadrature'
import { QUAD_BUDGET } from '../../../math/tolerance'
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
export interface Approx {
  value: number
  error: number
  scale: number
  singular?: boolean
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
// significant digit; anything less is refused, never printed.
export function determined(a: Approx): Approx {
  if (isZero(a) || a.error < Math.abs(a.value) / 2) return a
  throw new IntegralRefusal(
    `the integral could not be determined to one significant digit (≈ ${formatNumber(a.value)} ± ${formatNumber(a.error)}) — try tighter bounds or a finer res:`,
  )
}

function shown(a: Approx): number {
  return isZero(a) ? 0 : a.value
}

// The most digits a singular estimate is shown to (C1's belt and braces):
// its error already carries the ×10, so this is only the extra floor.
function digitsOf(a: Approx): number {
  const cap = a.singular ? SIGNIFICANT_DIGITS : MAX_DIGITS
  return Math.min(cap, supportedDigits(shown(a), a.error))
}

export function approxText(a: Approx): string {
  return `${APPROX} ${formatNumber(shown(a), digitsOf(a))}`
}

// "≈ (0.6667, 0.3333)": each coordinate to the digits its own estimate supports.
export function approxTupleText(values: readonly Approx[]): string {
  const parts = values.map((a) => formatNumber(shown(a), digitsOf(a)))
  return `${APPROX} (${parts.join(', ')})`
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
//   "the integral did not settle near x = 0: ..." — never "does not converge".
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
