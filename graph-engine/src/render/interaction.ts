// What the 2D renderer knows of a gesture (calc P2; spec "The interaction budget"): whether the view is
// being dragged or zoomed right now, so that the scene is rebuilt coarsely while it moves, and once more at
// full quality when it stops. Pure and clocked from outside, so it is tested with a fake clock; the
// renderer gives it performance.now (this folder is allowed to read the clock: the sampler's is not).
//
// - A DRAG runs from the pointer going down to it coming up. The view has moved only if a pointer move
//   panned it; a press and release in place has nothing to settle.
// - A WHEEL burst has no end event, so it is over when WHEEL_SETTLE_MS have passed with no wheel event:
//   each event moves that back.
// - `isInteracting` is the coarse flag: dragging, or inside a wheel burst. A wheel turned while the button
//   is held moves the view though the pointer does not, so it counts as a move of the drag: otherwise the
//   wheel burst's settle, finding a drag in progress, leaves the settling to the pointer up, which would see
//   no move and settle nothing.
// - The VIEWPORT is part of the view: the sampler works in screen pixels, so a canvas that changes size
//   (or comes up at its size after being built hidden, at 1 x 1) wants a rebuild. `viewportChanged` says
//   whether the size is a new one; the first size it is given is the baseline.
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
  // True when the viewport's size (CSS px) differs from the last one it was given. The first call only records it.
  viewportChanged(width: number, height: number): boolean
}

export function createInteraction(now: () => number): Interaction {
  let dragging = false
  let moved = false
  let lastWheel = Number.NEGATIVE_INFINITY
  let wheelPending = false
  let size: { width: number; height: number } | null = null
  const wheelAge = () => now() - lastWheel
  return {
    pointerDown() {
      dragging = true
      moved = false
    },
    pointerMove() {
      if (dragging) moved = true
    },
    viewportChanged(width, height) {
      const changed = size !== null && (size.width !== width || size.height !== height)
      size = { width, height }
      return changed
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
      if (dragging) moved = true
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
