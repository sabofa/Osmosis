// Play (plan E11, spec SP6 "Parameters"): the minimal timeline over a
// binding, as a pure function of time.
//
// - `once` sweeps min -> max in 6 s, linearly, and holds at max.
// - `loop` ping-pongs: min -> max in 6 s, back to min in the next 6 s, again.
// - An integer binding steps: the swept value rounded half away from zero.

import { roundHalfAway } from '../../math/compile'
import type { Binding } from '../config'

export const SWEEP_MS = 6000

export type PlayMode = 'once' | 'loop'

// The fraction of the sweep at `elapsed` ms, in [0, 1].
export function sweepFraction(elapsed: number, mode: PlayMode): number {
  const phase = Math.max(0, elapsed) / SWEEP_MS
  if (mode === 'once') return Math.min(1, phase)
  const cycle = phase % 2
  return cycle <= 1 ? cycle : 2 - cycle
}

// The binding's value at `now`, having started playing at `t0` (both ms).
export function valueAt(binding: Pick<Binding, 'min' | 'max' | 'integer'>, t0: number, now: number, mode: PlayMode): number {
  const value = binding.min + (binding.max - binding.min) * sweepFraction(now - t0, mode)
  return binding.integer ? roundHalfAway(value) : value
}

// Whether a `once` sweep has finished.
export function finished(t0: number, now: number, mode: PlayMode): boolean {
  return mode === 'once' && now - t0 >= SWEEP_MS
}
