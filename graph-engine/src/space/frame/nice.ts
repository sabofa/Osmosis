// Nice steps on the 1-2-5 ladder (K9). The one module both mesh lines (S1)
// and the frame's ticks (S2) take their steps from, so a mesh line on z = f
// always falls on a tick value.

import type { TickStep } from '../config'

const LADDER = [1, 2, 5]

// The value on the 1-2-5 x 10^n ladder nearest to span / target in log scale.
// A tie goes to the larger (on this ladder an exact tie cannot occur in
// floating point: the log midpoints are irrational). A non-positive or
// non-finite span gives 1.
export function niceStep(span: number, target: number): number {
  if (!(span > 0) || !Number.isFinite(span) || !(target > 0)) return 1
  const ideal = span / target
  const exponent = Math.floor(Math.log10(ideal))
  let best = 1
  let bestDistance = Infinity
  // Ascending, so "<=" hands a tie to the larger.
  for (let k = exponent - 1; k <= exponent + 1; k++) {
    for (const m of LADDER) {
      // One correctly rounded operation, so 0.05 is the double nearest 0.05.
      const candidate = k < 0 ? m / 10 ** -k : m * 10 ** k
      const distance = Math.abs(Math.log(candidate / ideal))
      if (distance <= bestDistance) {
        best = candidate
        bestDistance = distance
      }
    }
  }
  return best
}

// An authored step (@ticks3d) wins; otherwise the ladder.
export function stepFor(span: number, target: number, authored: TickStep | null): number {
  return authored ? authored.value : niceStep(span, target)
}
