import { FRAME } from './tuning'

const MINUS = '−'
const SUPERSCRIPT: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
}
const MAX_DIGITS = 20

export function superscript(n: number): string {
  return String(n)
    .split('')
    .map((c) => SUPERSCRIPT[c] ?? c)
    .join('')
}

/** Strip trailing zeros (and a dangling point) from a decimal mantissa. */
function stripZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

function withMinus(s: string): string {
  const out = s.startsWith('-') ? MINUS + s.slice(1) : s
  return out === MINUS + '0' ? '0' : out
}

/** Fewest digits d in [0, MAX_DIGITS] whose rendering is distinct and faithful. */
function fewestDigits(values: readonly number[], step: number, render: (v: number, d: number) => string): number {
  const tol = step / 1000
  for (let d = 0; d <= MAX_DIGITS; d++) {
    const seen = new Set<string>()
    let ok = true
    for (const v of values) {
      const s = render(v, d)
      if (seen.has(s) || Math.abs(Number(s) - v) > tol) {
        ok = false
        break
      }
      seen.add(s)
    }
    if (ok) return d
  }
  return MAX_DIGITS
}

/**
 * Labels for tick values `values` (ascending, evenly spaced by `step` > 0).
 * Each label has the fewest digits that tell the ticks apart; scientific
 * notation takes over for very large magnitudes or very small steps.
 */
export function formatTicks(values: readonly number[], step: number): string[] {
  if (values.length === 0) return []
  const tol = step / 1000
  // Values within tolerance of zero are zero (float noise from start + k*step).
  const vs = values.map((v) => (Math.abs(v) <= tol ? 0 : v))
  const finite = vs.filter(Number.isFinite)
  const maxAbs = finite.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  const sci = maxAbs >= FRAME.sciMagnitude || step < FRAME.sciStep

  if (!sci) {
    const d = fewestDigits(finite, step, (v, k) => v.toFixed(k))
    return vs.map((v) => (Number.isFinite(v) ? withMinus(stripZeros(v.toFixed(d))) : String(v)))
  }

  const d = fewestDigits(finite, step, (v, k) => v.toExponential(k))
  return vs.map((v) => {
    if (!Number.isFinite(v)) return String(v)
    if (v === 0) return '0'
    const [mant, exp] = v.toExponential(d).split('e')
    const e = Number(exp)
    const m = withMinus(stripZeros(mant))
    return e === 0 ? m : `${m}×10${superscript(e)}`
  })
}
