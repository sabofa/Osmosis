// Numbers shown to a reader in space (plan E8): readouts, pins, and every
// numeric answer a statement reports. Pure. Every number a readout prints
// goes through here.
//
// - 4 significant digits, trailing zeros trimmed.
// - The minus sign is U+2212, as the frame's tick labels print it.
// - Scientific (m×10ⁿ) when the rounded value's decimal exponent n is 5 or
//   more, or -4 or less: 123456 is 1.235×10⁵ and 0.000123456 is
//   1.235×10⁻⁴, while 0.001234 and 12340 print as they are.
// - -0 prints 0.
// - Exactness is never inferred: 1/3 prints 0.3333, never 1/3, and nothing
//   prints as a multiple of π. A value that comes from a numeric method (a
//   root, an integral) is marked approximate with ≈ (formatApprox).
// - S6 plan V3: an on-figure annotation shows at most DISPLAY_DIGITS
//   significant digits even when its error supports more — heavy to read
//   otherwise (∬ ≈ 25.1327412287). formatApproxFull, the pinned readout's
//   click-to-expand text, prints every digit the error supports.
//   Gate fix C1: capping to fewer digits is NOT automatically honest —
//   rounding an already-rounded value again, at a coarser unit, can carry
//   and show a digit the truth contradicts (kernel/integrals/common.ts had
//   exactly this bug: chosenDisplay's own rounding, re-rounded a second
//   time to DISPLAY_DIGITS, without ever re-checking the half-unit rule at
//   that coarser unit). formatApprox/formatApproxFull below round the raw
//   value fresh at each call, so they do not double-round, but the digit
//   count itself (supportedDigits) is a cruder estimate than the honestAt
//   half-unit search kernel/integrals/common.ts's chosenDisplay runs, and
//   is not re-verified against that rule either — a caller after that
//   stronger guarantee wants chosenDisplay, not this pair.

import type { Vec3 } from '../scene/types'

export const SIGNIFICANT_DIGITS = 4
export const MINUS = '−'
export const APPROX = '≈'
// The decimal exponents at which a number goes scientific.
export const SCIENTIFIC_MIN_EXPONENT = 5
export const SCIENTIFIC_MAX_NEGATIVE_EXPONENT = -4
// A numeric method's error estimate can support more digits than the default
// 4; never more than this.
export const MAX_DIGITS = 12
// S6 plan V3: the display cap for an on-figure annotation — fewer than
// MAX_DIGITS is always allowed, however many the error supports.
export const DISPLAY_DIGITS = 6

const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']
const SUPERSCRIPT_MINUS = '⁻'

function superscript(n: number): string {
  const digits = String(Math.abs(n))
    .split('')
    .map((c) => SUPERSCRIPT[Number(c)])
    .join('')
  return (n < 0 ? SUPERSCRIPT_MINUS : '') + digits
}

function withMinus(text: string): string {
  return text.startsWith('-') ? MINUS + text.slice(1) : text
}

// `digits` significant digits (default 4).
export function formatNumber(value: number, digits: number = SIGNIFICANT_DIGITS): string {
  if (Number.isNaN(value)) return 'undefined'
  if (value === Number.POSITIVE_INFINITY) return '∞'
  if (value === Number.NEGATIVE_INFINITY) return `${MINUS}∞`
  const d = Math.min(MAX_DIGITS, Math.max(1, Math.floor(digits)))
  // Round first, then choose the form from the rounded value's exponent:
  // 99999.5 is 1.000e+5 at 4 digits, so it prints 1×10⁵, not 100000.
  const [mantissa, exponentText] = value.toExponential(d - 1).split('e')
  const exponent = Number(exponentText)
  if (exponent >= SCIENTIFIC_MIN_EXPONENT || exponent <= SCIENTIFIC_MAX_NEGATIVE_EXPONENT) {
    return `${withMinus(String(Number(mantissa)))}×10${superscript(exponent)}`
  }
  // Between 1e-3 and 1e5, String() never goes exponential, and it trims
  // trailing zeros.
  return withMinus(String(Number(`${mantissa}e${exponentText}`)))
}

// How many significant digits an error estimate supports: the digits of
// |value| / |error|, at least 1 and at most MAX_DIGITS.
export function supportedDigits(value: number, error: number): number {
  if (!(Math.abs(error) > 0) || !Number.isFinite(error) || !(Math.abs(value) > 0)) return MAX_DIGITS
  const digits = Math.floor(Math.log10(Math.abs(value) / Math.abs(error)))
  return Math.min(MAX_DIGITS, Math.max(1, digits))
}

// A value from a numeric method: "≈ 0.3333". With an error estimate, as many
// digits as it supports, capped at DISPLAY_DIGITS (S6 plan V3: an on-figure
// annotation is never asked to print 12 digits of a quadrature); otherwise
// the default 4.
export function formatApprox(value: number, error?: number): string {
  const digits = error === undefined ? SIGNIFICANT_DIGITS : Math.min(DISPLAY_DIGITS, supportedDigits(value, error))
  return `${APPROX} ${formatNumber(value, digits)}`
}

// The same value, uncapped: every digit the error supports (still at most
// MAX_DIGITS). The pinned readout's click-to-expand text (V3).
export function formatApproxFull(value: number, error?: number): string {
  const digits = error === undefined ? SIGNIFICANT_DIGITS : supportedDigits(value, error)
  return `${APPROX} ${formatNumber(value, digits)}`
}

// "(1, −2, 0.5)"
export function formatPoint(p: Vec3 | readonly number[]): string {
  return `(${Array.from(p, (v) => formatNumber(v)).join(', ')})`
}
