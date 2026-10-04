// What the 2D renderer knows of a gesture (calc P2; spec "The interaction budget"): whether the view is
// being dragged or zoomed right now, so that the scene is rebuilt coarsely while it moves, and once more at
// full quality when it stops. Pure and clocked from outside, so it is tested with a fake clock; the
// renderer gives it performance.now (this folder is allowed to read the clock: the sampler's is not).
//
// - A DRAG runs from the pointer going down to it coming up. The view has moved only if a pointer move
//   panned it; a press and release in place has nothing to settle.
// - A WHEEL burst has no end event, so it is over when WHEEL_SETTLE_MS have passed with no wheel event:
//   each event moves that back.
// - `isInteracting` is the coarse flag: dragging, or inside a wheel burst.
export const WHEEL_SETTLE_MS = 150

export interface Interaction {
  pointerDown(): void
  // The view was panned by this drag
  pointerMove(): void
  // True when a drag that moved the view just ended: the caller rebuilds at full quality now. The window hears
  // every pointer up, so it is false for any other.
  pointerUp(): boolean
  // A wheel event
  wheel(): void
  isDragging(): boolean
  isInteracting(): boolean
  // Milliseconds until the pending wheel burst has settled (0 when it already has), or null when none is pending.
  wheelSettleIn(): number | null
  // True once, when a wheel burst has settled: the caller rebuilds at full quality now.
  takeWheelSettled(): boolean
}

export function createInteraction(now: () => number): Interaction {
  let dragging = false
  let moved = false
  let lastWheel = Number.NEGATIVE_INFINITY
  let wheelPending = false
  const wheelAge = () => now() - lastWheel
  return {
    pointerDown() {
      dragging = true
      moved = false
    },
    pointerMove() {
      if (dragging) moved = true
    },
    pointerUp() {
      const settle = dragging && moved
      dragging = false
      moved = false
      return settle
    },
    wheel() {
      lastWheel = now()
      wheelPending = true
    },
    isDragging: () => dragging,
    isInteracting: () => dragging || wheelAge() < WHEEL_SETTLE_MS,
    wheelSettleIn: () => (wheelPending ? Math.max(0, WHEEL_SETTLE_MS - wheelAge()) : null),
    takeWheelSettled() {
      if (!wheelPending || wheelAge() < WHEEL_SETTLE_MS) return false
      wheelPending = false
      return true
    },
  }
}
