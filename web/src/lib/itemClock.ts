// ----------------------------------------------------------------------------
// Time-on-item (spec §2.5), as a pure accumulator. Every timestamp is passed
// in, so the whole thing is testable without fake timers and the component
// keeps exactly one source of "now".
//
// The clock is held rather than merely paused: the tab being hidden and the
// attempt being paused are independent reasons to stop counting, and the clock
// only runs again once every reason is gone. Getting that wrong is how a
// paused drill starts counting the moment the learner glances back at the tab.
// ----------------------------------------------------------------------------

export type ClockHold = 'hidden' | 'attempt' | 'offscreen' | 'manual'

export interface ItemClock {
  // First paint of the item. Idempotent: a second start on a running clock
  // does not reset it.
  start(at: number): void
  pause(at: number, reason?: ClockHold): void
  resume(at: number, reason?: ClockHold): void
  read(at: number): number
  isRunning(): boolean
}

export function createItemClock(seedMs = 0): ItemClock {
  let accumulated = Math.max(0, seedMs)
  let runningSince: number | null = null
  let started = false
  const holds = new Set<ClockHold>()

  // A clock that ran backwards (a system clock correction mid-item) banks 0
  // rather than a negative span, which would otherwise make elapsed_ms shrink.
  function bank(at: number) {
    if (runningSince !== null) accumulated += Math.max(0, at - runningSince)
    runningSince = null
  }

  function runIfFree(at: number) {
    if (started && holds.size === 0 && runningSince === null) runningSince = at
  }

  return {
    start(at) {
      started = true
      runIfFree(at)
    },
    pause(at, reason = 'manual') {
      bank(at)
      holds.add(reason)
    },
    resume(at, reason = 'manual') {
      holds.delete(reason)
      runIfFree(at)
    },
    read(at) {
      return accumulated + (runningSince !== null ? Math.max(0, at - runningSince) : 0)
    },
    isRunning() {
      return runningSince !== null
    },
  }
}
