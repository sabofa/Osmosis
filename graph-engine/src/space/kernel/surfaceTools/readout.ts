// Readout text for the calculus of a surface. Every number goes through
// pick/format.ts; nothing is inferred exact, and an answer from Newton carries
// ≈. A readout is an annotation label: the scene has no other channel for a
// statement's numbers (SpaceScene carries marks, labels and errors).

import { APPROX, formatApprox, formatApproxFull, formatNumber, MINUS } from '../../pick/format'

export interface AffineTerm {
  coef: number
  variable: string
  // The term is coef (variable − at).
  at: number
}

// "2(x − 1)", "(y + 2)", "3x", "x"; null for a zero coefficient. The sign is
// carried separately so it folds into the joining operator: "− 4(y − 2)",
// never "+ −4(y − 2)".
function term({ coef, variable, at }: AffineTerm): { negative: boolean; body: string } | null {
  const magnitude = formatNumber(Math.abs(coef))
  if (magnitude === '0') return null
  const offset = formatNumber(Math.abs(at))
  const factor = offset === '0' ? variable : `(${variable} ${at > 0 ? MINUS : '+'} ${offset})`
  const body = magnitude === '1' ? factor : `${magnitude}${factor}`
  return { negative: coef < 0, body }
}

// A coefficient below this fraction of the largest part (|c| and the |coef|s)
// is rounding noise — cos(π/2) is 6.1×10⁻¹⁷, not 0 — and is left out.
export const NOISE = 1e-12

// c + Σ coef (variable − at), with the signs folded in and zero parts left
// out: "−3 + 2(x − 1) − 4(y − 2)".
export function affineText(constant: number | null, terms: readonly AffineTerm[]): string {
  const pieces: string[] = []
  const c = constant === null ? '0' : formatNumber(constant)
  if (c !== '0') pieces.push(c)
  const largest = Math.max(Math.abs(constant ?? 0), ...terms.map((t) => Math.abs(t.coef)))
  for (const t of terms) {
    if (Math.abs(t.coef) <= NOISE * largest) continue
    const part = term(t)
    if (!part) continue
    if (pieces.length === 0) pieces.push(part.negative ? `${MINUS}${part.body}` : part.body)
    else pieces.push(`${part.negative ? MINUS : '+'} ${part.body}`)
  }
  return pieces.length === 0 ? '0' : pieces.join(' ')
}

// "(1, 2)", each coordinate through formatNumber.
export function pointText(p: readonly number[]): string {
  return `(${p.map((v) => formatNumber(v)).join(', ')})`
}

// A point from Newton: "≈ (0.7071, 0.7071)". A coordinate within `floor` of
// zero is below what the solve resolves and prints 0, still under ≈.
export function approxPoint(p: readonly number[], floor: number): string {
  return `${APPROX} (${p.map((v) => formatNumber(Math.abs(v) <= floor ? 0 : v)).join(', ')})`
}

export function approx(v: number, floor: number): string {
  return `${APPROX} ${formatNumber(Math.abs(v) <= floor ? 0 : v)}`
}

// A numeric estimate with its error: digits as the error supports, capped
// at DISPLAY_DIGITS (formatApprox), and ≈ 0 for a value within its error of
// zero.
export function approxWithin(v: number, error: number): string {
  return Math.abs(v) <= error ? `${APPROX} 0` : formatApprox(v, error)
}

// approxWithin, uncapped (S6 plan V3): every digit the error supports.
export function approxWithinFull(v: number, error: number): string {
  return Math.abs(v) <= error ? `${APPROX} 0` : formatApproxFull(v, error)
}
