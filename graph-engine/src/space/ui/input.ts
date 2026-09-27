// Input for the space view (plan G2, G11, spec SP5 "Input"): pointer, wheel,
// touch and keyboard, turned into the pure reducers of camera/controls.ts.
//
// InputMachine is the pure part: it tracks which pointers are down and what
// gesture they make, and returns the next SpaceView (or null for "no
// change"). attachInput is the thin DOM layer that feeds it.
//
// - Drag orbits; right-drag or shift-drag pans; two touches pinch (zoom about
//   their midpoint, and pan as the midpoint moves).
// - Wheel zooms about the cursor, one notch (100 px, or 3 lines) = x1.1.
// - Double-click returns to the authored view.
// - Keys, with the canvas focused: the arrows orbit 5 degrees the way a drag
//   in that direction would, + and - zoom about the centre, 0 resets.
// - Releasing a moving orbit drag hands its velocity to inertia, unless the
//   user prefers reduced motion or had stopped before letting go.
// - For the probe and pins (S3): a move with no gesture under way is a
//   hover; a press released within 4 px and 400 ms is a click (pins.ts);
//   leaving the canvas and Esc are reported too.
// - Dragging a point (S3): a primary press the host grabs (handlers.grab)
//   is not an orbit; its moves and release go to the host.

import type { Projection, SpaceView } from '../config'
import { orbit, ORBIT_DEG_PER_PX, pan, reset, WHEEL_STEP, zoomAt, type OrbitVelocity } from '../camera/controls'
import type { Viewport } from '../camera/projection'
import type { WorldMap } from '../camera/world'
import { isClick } from './pins'

export interface InputContext {
  view: SpaceView
  authored: SpaceView
  viewport: Viewport
  world: WorldMap
  projection: Projection
}

export interface PointerSample {
  id: number
  // CSS px from the canvas's top-left.
  x: number
  y: number
  button: number
  // Which buttons are held now; 0 during a drag means the release was missed.
  buttons: number
  shift: boolean
  // ms, any monotonic clock.
  time: number
}

export interface WheelSample {
  deltaY: number
  deltaMode: number
  x: number
  y: number
}

export const KEY_ORBIT_DEG = 5
// A drag that has not moved for this long before release gets no inertia.
const INERTIA_IDLE_MS = 80
// The release velocity is measured over the moves of the last 100 ms. It is
// trusted only when there are at least two of them spanning at least two
// frames (32 ms), and it is capped: movement packed into a few milliseconds
// (coalesced events, a synthetic drag) would otherwise read as a wild flick.
const VELOCITY_WINDOW_MS = 100
const VELOCITY_MIN_SPAN_MS = 32
export const INERTIA_MAX_DEG_PER_MS = 0.6

type Gesture = 'none' | 'orbit' | 'pan' | 'pinch'

export class InputMachine {
  private readonly pointers = new Map<number, { x: number; y: number }>()
  private gesture: Gesture = 'none'
  // Recent orbit moves: when, over how long, and how far (degrees).
  private samples: { time: number; dt: number; azimuth: number; elevation: number }[] = []
  private lastMove = 0

  // Whether a gesture is under way (a hover move has nothing to do).
  get active(): boolean {
    return this.gesture !== 'none'
  }

  down(p: PointerSample): void {
    this.pointers.set(p.id, { x: p.x, y: p.y })
    if (this.pointers.size >= 2) this.gesture = 'pinch'
    else this.gesture = p.button === 2 || p.shift ? 'pan' : 'orbit'
    this.samples = []
    this.lastMove = p.time
  }

  move(p: PointerSample, ctx: InputContext): SpaceView | null {
    const prev = this.pointers.get(p.id)
    if (!prev || this.gesture === 'none') return null
    // No button held: the release happened where we could not see it (outside
    // the window, or capture failed). The drag is over.
    if (p.buttons === 0) {
      this.cancel()
      return null
    }
    if (this.gesture === 'pinch') return this.pinch(p, prev, ctx)
    this.pointers.set(p.id, { x: p.x, y: p.y })
    const dx = p.x - prev.x
    const dy = p.y - prev.y
    if (dx === 0 && dy === 0) return null
    if (this.gesture === 'pan') return pan(ctx.view, dx, dy, ctx.viewport, ctx.world, ctx.projection)
    this.samples.push({ time: p.time, dt: p.time - this.lastMove, azimuth: -dx * ORBIT_DEG_PER_PX, elevation: dy * ORBIT_DEG_PER_PX })
    this.samples = this.samples.filter((s) => p.time - s.time <= VELOCITY_WINDOW_MS)
    this.lastMove = p.time
    return orbit(ctx.view, dx, dy)
  }

  // Returns the release velocity for inertia, or null.
  up(p: PointerSample, reducedMotion: boolean): OrbitVelocity | null {
    const was = this.gesture
    this.pointers.delete(p.id)
    if (this.pointers.size === 0) this.gesture = 'none'
    else if (this.pointers.size === 1) this.gesture = 'orbit'
    if (was !== 'orbit' || this.gesture !== 'none' || reducedMotion) return null
    if (p.time - this.lastMove > INERTIA_IDLE_MS) return null
    const recent = this.samples.filter((s) => p.time - s.time <= VELOCITY_WINDOW_MS)
    if (recent.length < 2) return null
    const span = recent.reduce((t, s) => t + s.dt, 0)
    if (span < VELOCITY_MIN_SPAN_MS) return null
    let azimuth = recent.reduce((a, s) => a + s.azimuth, 0) / span
    let elevation = recent.reduce((a, s) => a + s.elevation, 0) / span
    const speed = Math.hypot(azimuth, elevation)
    if (speed === 0) return null
    if (speed > INERTIA_MAX_DEG_PER_MS) {
      azimuth *= INERTIA_MAX_DEG_PER_MS / speed
      elevation *= INERTIA_MAX_DEG_PER_MS / speed
    }
    return { azimuth, elevation }
  }

  cancel(): void {
    this.pointers.clear()
    this.gesture = 'none'
    this.samples = []
  }

  // Pointer capture was lost (the element went away, or the browser took the
  // pointer): that pointer's gesture ends here, with no inertia.
  lose(id: number): void {
    if (!this.pointers.has(id)) return
    this.pointers.delete(id)
    this.samples = []
    this.gesture = this.pointers.size === 0 ? 'none' : this.pointers.size === 1 ? 'orbit' : 'pinch'
  }

  wheel(w: WheelSample, ctx: InputContext): SpaceView {
    const notches = w.deltaMode === 1 ? w.deltaY / 3 : w.deltaMode === 2 ? w.deltaY : w.deltaY / 100
    return zoomAt(ctx.view, WHEEL_STEP ** -notches, w.x, w.y, ctx.viewport, ctx.world, ctx.projection)
  }

  key(key: string, ctx: InputContext): SpaceView | null {
    const step = KEY_ORBIT_DEG / ORBIT_DEG_PER_PX
    const centre = [ctx.viewport.width / 2, ctx.viewport.height / 2] as const
    switch (key) {
      case 'ArrowRight':
        return orbit(ctx.view, step, 0)
      case 'ArrowLeft':
        return orbit(ctx.view, -step, 0)
      case 'ArrowDown':
        return orbit(ctx.view, 0, step)
      case 'ArrowUp':
        return orbit(ctx.view, 0, -step)
      case '+':
      case '=':
        return zoomAt(ctx.view, WHEEL_STEP, centre[0], centre[1], ctx.viewport, ctx.world, ctx.projection)
      case '-':
      case '_':
        return zoomAt(ctx.view, 1 / WHEEL_STEP, centre[0], centre[1], ctx.viewport, ctx.world, ctx.projection)
      case '0':
        return reset(ctx.authored)
      default:
        return null
    }
  }

  doubleClick(ctx: InputContext): SpaceView {
    return reset(ctx.authored)
  }

  private pinch(p: PointerSample, prev: { x: number; y: number }, ctx: InputContext): SpaceView | null {
    const others = [...this.pointers.entries()].filter(([id]) => id !== p.id)
    if (others.length === 0) return null
    const other = others[0][1]
    const before = { d: Math.hypot(prev.x - other.x, prev.y - other.y), x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 }
    this.pointers.set(p.id, { x: p.x, y: p.y })
    const after = { d: Math.hypot(p.x - other.x, p.y - other.y), x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 }
    let view = ctx.view
    if (after.x !== before.x || after.y !== before.y) {
      view = pan(view, after.x - before.x, after.y - before.y, ctx.viewport, ctx.world, ctx.projection)
    }
    if (before.d > 0 && after.d > 0 && after.d !== before.d) {
      view = zoomAt(view, after.d / before.d, after.x, after.y, ctx.viewport, ctx.world, ctx.projection)
    }
    return view === ctx.view ? null : view
  }
}

export interface InputHandlers {
  // The camera state input acts on, or null while there is nothing to move.
  context(): InputContext | null
  apply(view: SpaceView): void
  startInertia(velocity: OrbitVelocity): void
  stopInertia(): void
  now(): number
  prefersReducedMotion(): boolean
  // The pointer moved with no gesture under way (CSS px in the canvas).
  hover?(x: number, y: number): void
  // The pointer left the canvas.
  leave?(): void
  // A press began.
  press?(): void
  // A click: a primary press released within 4 px and 400 ms of it.
  click?(x: number, y: number): void
  // Esc, with the canvas focused.
  escape?(): void
  // A primary press: true takes the gesture (a draggable point is under it),
  // and its moves and release go to dragTo and release instead of the camera.
  grab?(x: number, y: number): boolean
  dragTo?(x: number, y: number): void
  // The drag ended: at (x, y) on a release, or with no position when the
  // pointer was cancelled or lost.
  release?(x: number | null, y: number | null): void
}

export interface AttachedInput {
  detach(): void
  // The canvas moved or resized: the cached rect is stale.
  invalidate(): void
}

// The DOM layer: listens on the canvas and feeds the machine. The canvas is
// focusable (tabIndex 0) so the keys work once it is clicked or tabbed to.
//
// A hover move reads no layout beyond the cached canvas rect, which is read
// afresh when a drag starts, and dropped on resize and on any scroll.
export function attachInput(canvas: HTMLCanvasElement, machine: InputMachine, handlers: InputHandlers): AttachedInput {
  let rect: { left: number; top: number } | null = null
  const invalidate = () => {
    rect = null
  }
  const local = (e: { clientX: number; clientY: number }) => {
    rect ??= canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const sample = (e: PointerEvent): PointerSample => ({
    id: e.pointerId,
    ...local(e),
    button: e.button,
    buttons: e.buttons,
    shift: e.shiftKey,
    time: handlers.now(),
  })
  // The primary press that may become a click.
  let pressed: { id: number; x: number; y: number; time: number } | null = null
  // The pointer dragging a grabbed point, if any.
  let grabbed: number | null = null
  const capture = (id: number) => {
    try {
      canvas.setPointerCapture(id)
    } catch {
      // A synthetic or already-released pointer cannot be captured; moves still arrive.
    }
  }
  const down = (e: PointerEvent) => {
    handlers.stopInertia()
    handlers.press?.()
    const first = !machine.active && grabbed === null
    if (first) invalidate()
    const s = sample(e)
    if (first && e.button === 0 && !e.shiftKey && handlers.grab?.(s.x, s.y)) {
      grabbed = e.pointerId
      pressed = null
      capture(e.pointerId)
      return
    }
    pressed = first && e.button === 0 ? { id: e.pointerId, x: s.x, y: s.y, time: s.time } : null
    machine.down(s)
    capture(e.pointerId)
  }
  const move = (e: PointerEvent) => {
    if (grabbed !== null) {
      if (e.pointerId === grabbed) {
        const p = local(e)
        handlers.dragTo?.(p.x, p.y)
      }
      return
    }
    if (!machine.active) {
      if (handlers.hover) {
        const p = local(e)
        handlers.hover(p.x, p.y)
      }
      return
    }
    const ctx = handlers.context()
    if (!ctx) return
    const view = machine.move(sample(e), ctx)
    if (view) handlers.apply(view)
  }
  const letGo = (id: number, at: { x: number; y: number } | null) => {
    if (grabbed !== id) return false
    grabbed = null
    handlers.release?.(at?.x ?? null, at?.y ?? null)
    return true
  }
  const up = (e: PointerEvent) => {
    if (grabbed === e.pointerId && letGo(e.pointerId, local(e))) return
    const s = sample(e)
    const velocity = machine.up(s, handlers.prefersReducedMotion())
    if (velocity) handlers.startInertia(velocity)
    const press = pressed
    pressed = null
    if (press && press.id === e.pointerId && isClick(press, s)) handlers.click?.(s.x, s.y)
  }
  const cancel = (e: PointerEvent) => {
    pressed = null
    if (letGo(e.pointerId, null)) return
    machine.cancel()
  }
  const leave = () => handlers.leave?.()
  const lost = (e: PointerEvent) => {
    if (letGo(e.pointerId, null)) return
    machine.lose(e.pointerId)
  }
  const wheel = (e: WheelEvent) => {
    const ctx = handlers.context()
    if (!ctx) return
    e.preventDefault()
    handlers.stopInertia()
    handlers.apply(machine.wheel({ deltaY: e.deltaY, deltaMode: e.deltaMode, ...local(e) }, ctx))
  }
  const dblclick = (e: MouseEvent) => {
    const ctx = handlers.context()
    if (!ctx) return
    e.preventDefault()
    handlers.stopInertia()
    handlers.apply(machine.doubleClick(ctx))
  }
  const keydown = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    if (e.key === 'Escape') {
      handlers.escape?.()
      return
    }
    const ctx = handlers.context()
    if (!ctx) return
    const view = machine.key(e.key, ctx)
    if (!view) return
    e.preventDefault()
    handlers.stopInertia()
    handlers.apply(view)
  }
  // Right-drag pans; keep the context menu out of its way.
  const contextmenu = (e: Event) => e.preventDefault()

  const listeners: [string, EventListener, AddEventListenerOptions?][] = [
    ['pointerdown', down as EventListener],
    ['pointermove', move as EventListener],
    ['pointerup', up as EventListener],
    ['pointercancel', cancel as EventListener],
    ['pointerleave', leave],
    ['lostpointercapture', lost as EventListener],
    ['wheel', wheel as EventListener, { passive: false }],
    ['dblclick', dblclick as EventListener],
    ['keydown', keydown as EventListener],
    ['contextmenu', contextmenu],
  ]
  for (const [type, fn, options] of listeners) canvas.addEventListener(type, fn, options)
  // Scroll events do not bubble, but a capturing listener on the window sees
  // every one, the page's and any scrolling ancestor's.
  const view = canvas.ownerDocument?.defaultView ?? null
  view?.addEventListener('scroll', invalidate, { capture: true, passive: true })
  // Touch gestures belong to the view, not the page's scroll and zoom.
  canvas.style.touchAction = 'none'
  return {
    invalidate,
    detach() {
      for (const [type, fn] of listeners) canvas.removeEventListener(type, fn)
      view?.removeEventListener('scroll', invalidate, { capture: true })
    },
  }
}
