import { PI_LADDER, PI_STEP_EPS } from './tuning'

const MINUS = '−'
const PI = 'π'

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) [x, y] = [y, x % y]
  return x
}

/** The k-th tick of a pi axis with the given step, as an exact rational multiple of pi. */
export function piLabel(k: number, step: { num: number; den: number }): string {
  let p = k * step.num
  let q = step.den
  if (p === 0) return '0'
  const g = gcd(p, q)
  p /= g
  q /= g
  const sign = p < 0 ? MINUS : ''
  const a = Math.abs(p)
  const head = a === 1 ? PI : `${a}${PI}`
  return q === 1 ? `${sign}${head}` : `${sign}${head}/${q}`
}

/** The smallest ladder step at least span / targetDivisions (the largest rung if none is). */
export function piStepFor(span: number, targetDivisions: number): { num: number; den: number } {
  const rough = span / targetDivisions / Math.PI
  for (const s of PI_LADDER) {
    if (s.num / s.den >= rough * (1 - PI_STEP_EPS)) return { num: s.num, den: s.den }
  }
  const last = PI_LADDER[PI_LADDER.length - 1]
  return { num: last.num, den: last.den }
}
