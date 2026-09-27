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
// digits as it supports; otherwise the default 4.
export function formatApprox(value: number, error?: number): string {
  const digits = error === undefined ? SIGNIFICANT_DIGITS : supportedDigits(value, error)
  return `${APPROX} ${formatNumber(value, digits)}`
}

// "(1, −2, 0.5)"
export function formatPoint(p: Vec3 | readonly number[]): string {
  return `(${Array.from(p, (v) => formatNumber(v)).join(', ')})`
}
