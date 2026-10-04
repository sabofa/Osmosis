// What the 2D renderer knows of a gesture (calc P2; spec "The interaction budget"): whether the view is
// being dragged, zoomed or resized right now, so that the scene is rebuilt coarsely while it moves, and once
// more at full quality when it stops. Pure and clocked from outside, so it is tested with a fake clock; the
// renderer gives it performance.now (this folder is allowed to read the clock: the sampler's is not).
//
// - A DRAG runs from the pointer going down to it coming up. The view has moved only if a pointer move
//   panned it; a press and release in place has nothing to settle.
// - A BURST (a wheel turned, a canvas resized) has no end event, so it is over when WHEEL_SETTLE_MS have
//   passed with no event of either kind: each one moves that back. Wheel and resize share the one burst, so
//   the settle waits for both.
// - `isInteracting` is the coarse flag: dragging, or inside a burst. A wheel turned or a canvas resized while
//   the button is held moves the view though the pointer does not, so it counts as a move of the drag:
//   otherwise the burst's settle, finding a drag in progress, leaves the settling to the pointer up, which
//   would see no move and settle nothing.
// - The VIEWPORT is part of the view: the sampler works in screen pixels, so a canvas that changes size
//   (or comes up at its size after being built hidden, at 1 x 1) wants a rebuild. `viewportChanged` says
//   whether the size is a new one (the first size it is given is the baseline), and a new one is a resize
//   event of the burst: a splitter dragged across the page is a stream of them, coarse until it is quiet.
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
  // Milliseconds until the pending burst has settled (0 when it already has), or null when none is pending.
  settleIn(): number | null
  // True once, when a burst has settled: the caller rebuilds at full quality now.
  takeSettled(): boolean
  // True when the viewport's size (CSS px) differs from the last one it was given, which is also a resize
  // event of the burst. The first call only records the size.
  viewportChanged(width: number, height: number): boolean
}

export function createInteraction(now: () => number): Interaction {
  let dragging = false
  let moved = false
  let lastEvent = Number.NEGATIVE_INFINITY
  let pending = false
  let size: { width: number; height: number } | null = null
  const age = () => now() - lastEvent
  // an event of the burst: it moves the end of the burst back, and it moved the view
  const burst = () => {
    lastEvent = now()
    pending = true
    if (dragging) moved = true
  }
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
      if (changed) burst()
      return changed
    },
    pointerUp() {
      const settle = dragging && moved
      dragging = false
      moved = false
      return settle
    },
    wheel: burst,
    isDragging: () => dragging,
    isInteracting: () => dragging || age() < WHEEL_SETTLE_MS,
    settleIn: () => (pending ? Math.max(0, WHEEL_SETTLE_MS - age()) : null),
    takeSettled() {
      if (!pending || age() < WHEEL_SETTLE_MS) return false
      pending = false
      return true
    },
  }
}
