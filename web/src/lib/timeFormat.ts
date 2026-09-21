// ----------------------------------------------------------------------------
// Timer rendering (spec §7.2). Both timers on the Take screen — the set's
// countdown and the current item's count-up — read the same way, so they share
// one formatter; only the direction differs at the call site.
// ----------------------------------------------------------------------------

// Under this much left, the countdown earns its one muted emphasis class. No
// colour change above it: a timer that turns red with ten minutes to go is
// just noise.
export const FINAL_STRETCH_SEC = 60

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export function timerClass(secondsLeft: number | null): string {
  if (secondsLeft === null) return ''
  return secondsLeft < FINAL_STRETCH_SEC ? 'timer-final' : ''
}

// The set running out is a one-way trip through two states: 'message' is the
// two seconds where "Time." stands alone, 'finish' is after, when the way out
// appears. Pure and monotonic on purpose — the countdown reports 0 on every
// tick once it runs out, and a transition that re-entered 'message' each time
// would restart those two seconds forever and never reach 'finish'.
export type TimeUpPhase = 'none' | 'message' | 'finish'

export function nextTimeUpPhase(phase: TimeUpPhase, secondsLeft: number | null): TimeUpPhase {
  if (phase !== 'none') return phase
  if (secondsLeft === null || secondsLeft > 0) return 'none'
  return 'message'
}
