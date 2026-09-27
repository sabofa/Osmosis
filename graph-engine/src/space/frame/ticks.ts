// Tick values and their text (plan G7). Pure.

import type { SpaceConfig, TickStep } from '../config'
import type { Box3, Range } from '../scene/types'
import type { AxisScale, FrameAxes } from './types'

// How many intervals the automatic step aims for across a span.
export const TICK_TARGET = 8

// A cap on one axis's tick count, so an authored step far too small for its
// range cannot make an unbounded loop. Gridlines past this are noise anyway.
export const MAX_TICKS = 1000

// replaced by frame/nice.ts at the S1 merge
// The value on the 1-2-5 x 10^n ladder nearest to span / target in log scale,
// ties going to the larger. A tie is an exact geometric mean, which no double
// hits exactly, so "tie" means within 1e-12 in log.
export function niceStep(span: number, target: number): number {
  const raw = span / target
  if (!(raw > 0) || !Number.isFinite(raw)) return 1
  const base = 10 ** Math.floor(Math.log10(raw))
  let best = base
  let bestDistance = Number.POSITIVE_INFINITY
  for (const m of [1, 2, 5, 10]) {
    const candidate = m * base
    const distance = Math.abs(Math.log(raw / candidate))
    if (distance <= bestDistance + 1e-12) {
      best = candidate
      bestDistance = Math.min(distance, bestDistance)
    }
  }
  return best
}

// Every k * step within the range, inclusive with a 1e-9 tolerance relative
// to the step, computed as k * step and never by accumulation. `scale` is the
// axis's scale (SP5); only 'linear' exists, so a log axis is a type error
// until sub-project 4 adds it here.
export function ticks(range: Range, step: number, scale: AxisScale): number[] {
  if (scale !== 'linear') return []
  if (!(step > 0) || !Number.isFinite(step) || !(range.max >= range.min)) return []
  const first = Math.ceil(range.min / step - 1e-9)
  const last = Math.floor(range.max / step + 1e-9)
  if (last - first + 1 > MAX_TICKS) return []
  const out: number[] = []
  // + 0 turns the -0 of ceil(-1e-9) into 0.
  for (let k = first; k <= last; k++) out.push(k * step + 0)
  return out
}

// The multiple of the step a tick value is: its stable identity.
export function tickIndex(value: number, step: number): number {
  return Math.round(value / step)
}

// The axis steps and titles from the space directives and the resolved box.
export function frameAxes(space: SpaceConfig, box: Box3): FrameAxes {
  const axis = (authored: TickStep | null, range: Range, title: string) => ({
    scale: 'linear' as const,
    step: authored && authored.value > 0 ? authored.value : niceStep(range.max - range.min, TICK_TARGET),
    authored,
    title,
  })
  return {
    x: axis(space.ticks.x, box.x, space.titles.x),
    y: axis(space.ticks.y, box.y, space.titles.y),
    z: axis(space.ticks.z, box.z, space.titles.z),
  }
}

const MINUS = '−'
const PI = 'π'
const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']
const SUPERSCRIPT_MINUS = '⁻'
// Decimals are capped: an irrational authored step (never a pi one, which
// prints as pi) would otherwise print 12 digits of noise.
const MAX_DECIMALS = 6

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) [x, y] = [y, x % y]
  return x || 1
}

// How many decimals the step's own decimal representation needs:
// 0.25 -> 2, 0.2 -> 1, 5 -> 0.
function decimalsOf(step: number): number {
  const s = Math.abs(step)
  for (let d = 0; d <= MAX_DECIMALS; d++) {
    const scaled = s * 10 ** d
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, scaled)) return d
  }
  return MAX_DECIMALS
}

function withMinus(text: string): string {
  return text.startsWith('-') ? MINUS + text.slice(1) : text
}

function superscript(n: number): string {
  const digits = String(Math.abs(n))
    .split('')
    .map((c) => SUPERSCRIPT[Number(c)])
    .join('')
  return (n < 0 ? SUPERSCRIPT_MINUS : '') + digits
}

// Shortest faithful text of a mantissa: 12 significant digits, trailing
// zeros (and floating noise below them) dropped.
function shortest(v: number): string {
  return String(Number(v.toPrecision(12)))
}

function scientific(value: number): string {
  let exponent = Math.floor(Math.log10(Math.abs(value)))
  let mantissa = Number((value / 10 ** exponent).toPrecision(12))
  if (Math.abs(mantissa) >= 10) {
    mantissa /= 10
    exponent += 1
  } else if (Math.abs(mantissa) < 1) {
    mantissa *= 10
    exponent -= 1
  }
  return `${withMinus(shortest(mantissa))}×10${superscript(exponent)}`
}

// The text of one tick. `step` is the authored step (pi multiples print as
// pi only through it — structural, never inferred from the float); `stepValue`
// is the step actually in use.
export function formatTick(value: number, step: TickStep | null, stepValue: number): string {
  const nearZero = Math.abs(value) < Math.abs(stepValue) * 1e-9
  if (step?.pi) {
    const k = tickIndex(value, stepValue)
    let num = k * step.pi.num
    let den = step.pi.den
    const g = gcd(num, den)
    num /= g
    den /= g
    if (num === 0) return '0'
    const sign = num < 0 ? MINUS : ''
    const coefficient = Math.abs(num) === 1 ? '' : String(Math.abs(num))
    return den === 1 ? `${sign}${coefficient}${PI}` : `${sign}${coefficient}${PI}/${den}`
  }
  const magnitude = Math.abs(stepValue)
  if (magnitude >= 1e5 || magnitude < 1e-4) return nearZero ? '0' : scientific(value)
  return withMinus((nearZero ? 0 : value).toFixed(decimalsOf(stepValue)))
}
