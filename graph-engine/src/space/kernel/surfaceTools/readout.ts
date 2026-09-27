// Readout text for the calculus of a surface. Every number goes through
// pick/format.ts; nothing is inferred exact, and an answer from Newton carries
// ≈. A readout is an annotation label: the scene has no other channel for a
// statement's numbers (SpaceScene carries marks, labels and errors).

import { APPROX, formatNumber, MINUS } from '../../pick/format'

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

// c + Σ coef (variable − at), with the signs folded in and zero parts left
// out: "−3 + 2(x − 1) − 4(y − 2)".
export function affineText(constant: number | null, terms: readonly AffineTerm[]): string {
  const pieces: string[] = []
  const c = constant === null ? '0' : formatNumber(constant)
  if (c !== '0') pieces.push(c)
  for (const t of terms) {
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
