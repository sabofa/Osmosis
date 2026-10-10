import { anchoredCamera, basePxPerUnit, panByScreen, screenToContent } from './camera'
import {
  ARRIVE_LOG_ZOOM,
  ARRIVE_PX,
  COAST_HOLD,
  COAST_STOP,
  COAST_TAU,
  COAST_WINDOW,
  EASE_DURATION,
  SMOOTH_TAU,
} from './feel'
import { clampCamera, DEFAULT_LIMITS, type LimitsPolicy } from './limits'
import type { Camera, Rect, Size, Vec } from './types'

// Motion — how the view gets from where it is to where it was told to go.
//
// The view holds a **current** camera (what is drawn) and a **target** camera
// (where input says it should be). Input moves the target, always clamped to
// the limits; each frame moves current toward it. The rule that makes this
// feel right and not merely smooth is that **smoothing changes when the view
// arrives, never where**: a zoom keeps the content under the cursor fixed at
// every frame of its flight, a drag tracks the cursor exactly, and nothing
// overshoots.
//
// Like the rest of the core this is DOM-free and clockless. Time is a
// parameter: every input and every `step` is told `t` in milliseconds, so a
// node test drives it with a fake clock and a component feeds it
// `requestAnimationFrame`'s timestamp. Nothing here reads a real clock.
//
// There are four kinds of movement and exactly one is running at a time:
//   - smooth: exponential approach to the target (wheel, keys). Frame-rate
//     independent, because the step is `1 − exp(−dt/τ)` and not a fixed lerp.
//   - ease:   a fixed-length ease-out for reset and focus. Interruptible.
//   - coast:  the carry-on after a drag is released.
//   - none:   at rest, or being dragged or pinched, which are exact.
// A new input interrupts whatever is running and starts from where the view
// is *now*, not from where the old move was headed; otherwise the view would
// jump the instant a reader grabbed it.

export interface MotionOptions {
  frame: Rect
  screen: Size
  start: Camera
  limits?: LimitsPolicy
  reducedMotion?: boolean
}

type Mode = 'rest' | 'smooth' | 'coast' | 'ease'

interface Sample {
  t: number
  dx: number
  dy: number
}

// A content point held at a screen point while a smoothed zoom is in flight.
interface Anchor {
  content: Vec
  screen: Vec
}

export class ViewMotion {
  private cur: Camera
  private tgt: Camera
  private frame: Rect
  private screen: Size
  private limits: LimitsPolicy
  private reduced: boolean
  private mode: Mode = 'rest'
  // The time the view was last advanced to; the next step integrates from it.
  private clock = 0
  private anchor: Anchor | null = null
  private dragging = false
  private samples: Sample[] = []
  // Coast velocity in screen px per ms.
  private vx = 0
  private vy = 0
  private ease: { from: Camera; to: Camera; t0: number } | null = null

  constructor(options: MotionOptions) {
    this.frame = options.frame
    this.screen = options.screen
    this.limits = options.limits ?? DEFAULT_LIMITS
    this.reduced = options.reducedMotion ?? false
    this.cur = this.clamp(options.start)
    this.tgt = this.cur
  }

  get current(): Camera {
    return this.cur
  }

  get target(): Camera {
    return this.tgt
  }

  get moving(): boolean {
    return this.mode !== 'rest'
  }

  // The window was resized. Which content point is at the middle is kept;
  // the bounds depend on the screen, so both cameras are re-clamped to them.
  setScreen(screen: Size): void {
    this.screen = screen
    this.anchor = null
    this.cur = this.clamp(this.cur)
    this.tgt = this.clamp(this.tgt)
  }

  // A different drawing: jump to its start view and stop everything.
  setContent(frame: Rect, start: Camera): void {
    this.frame = frame
    this.halt()
    this.cur = this.clamp(start)
    this.tgt = this.cur
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on
    if (on) this.finish()
  }

  // -------------------------------------------------------------------------
  // Exact input: current is target, there is nothing to smooth
  // -------------------------------------------------------------------------

  dragStart(t: number): void {
    this.interrupt(t)
    this.halt() // a smoothed move in flight stops where it is, too
    this.dragging = true
  }

  // Content follows the cursor by exactly (dx, dy). Past a limit the view
  // holds at the bound rather than easing: a drag has no "later" to ease in.
  dragBy(dxPx: number, dyPx: number, t: number): void {
    if (!this.dragging) this.dragStart(t)
    this.cur = this.clamp(panByScreen(this.cur, dxPx, dyPx, this.frame, this.screen))
    this.tgt = this.cur
    this.samples.push({ t, dx: dxPx, dy: dyPx })
    // Only the newest stretch can ever matter to a release.
    const horizon = t - Math.max(COAST_WINDOW, COAST_HOLD)
    while (this.samples.length > 1 && this.samples[0].t < horizon) this.samples.shift()
  }

  // Let go. The velocity of the last COAST_WINDOW ms carries on, unless the
  // reader held still before releasing: a pointer that stopped, then lifted,
  // meant "stay here", and a coast then would feel like the view ignoring them.
  dragEnd(t: number): void {
    if (!this.dragging) return
    this.dragging = false
    const samples = this.samples
    this.samples = []
    if (this.reduced || samples.length === 0) return
    if (t - samples[samples.length - 1].t >= COAST_HOLD) return
    let sx = 0
    let sy = 0
    for (const s of samples) {
      if (t - s.t < COAST_WINDOW) {
        sx += s.dx
        sy += s.dy
      }
    }
    this.vx = sx / COAST_WINDOW
    this.vy = sy / COAST_WINDOW
    if (Math.hypot(this.vx, this.vy) * 1000 < COAST_STOP) return
    this.clock = t
    this.mode = 'coast'
  }

  // Fingers: zoom about their midpoint and follow its movement, exactly. The
  // zoom is clamped *before* the centre is derived from it, so the midpoint
  // holds even while the zoom is pinned at a limit.
  pinch(screenPoint: Vec, factor: number, dxPx: number, dyPx: number, t: number): void {
    this.interrupt(t)
    this.halt()
    const anchor = screenToContent(screenPoint, this.frame, this.cur, this.screen)
    const zoom = this.clampZoom(this.cur.zoom * factor)
    const zoomed = anchoredCamera(anchor, screenPoint, zoom, this.frame, this.screen)
    this.cur = this.clamp(panByScreen(zoomed, dxPx, dyPx, this.frame, this.screen))
    this.tgt = this.cur
  }

  // -------------------------------------------------------------------------
  // Smoothed input: moves the target, the view follows
  // -------------------------------------------------------------------------

  // Wheel zoom. The content point under the cursor *as drawn right now* is the
  // anchor, and the target is the camera that holds it there at the new zoom,
  // so successive notches compound and the point never drifts.
  zoomAt(screenPoint: Vec, factor: number, t: number): void {
    this.interrupt(t)
    const content = screenToContent(screenPoint, this.frame, this.cur, this.screen)
    const zoom = this.clampZoom(this.tgt.zoom * factor)
    const wanted = anchoredCamera(content, screenPoint, zoom, this.frame, this.screen)
    this.tgt = this.clamp(wanted)
    // If a pan bound moved the target's centre, the anchor can no longer be
    // held to the end, and the view eases to the bound instead of fighting it.
    const held = this.tgt.cx === wanted.cx && this.tgt.cy === wanted.cy
    this.anchor = held ? { content, screen: screenPoint } : null
    this.beginSmooth()
  }

  // Key pan: content moves by (dx, dy) screen pixels, smoothed.
  panBy(dxPx: number, dyPx: number, t: number): void {
    this.interrupt(t)
    this.anchor = null
    this.tgt = this.clamp(panByScreen(this.tgt, dxPx, dyPx, this.frame, this.screen))
    this.beginSmooth()
  }

  // Reset and focus: a fixed-length ease-out cubic, interruptible, to the
  // clamped camera.
  animateTo(camera: Camera, t: number): void {
    this.interrupt(t)
    this.anchor = null
    this.tgt = this.clamp(camera)
    if (this.reduced) {
      this.cur = this.tgt
      return
    }
    this.ease = { from: this.cur, to: this.tgt, t0: t }
    this.mode = 'ease'
  }

  // -------------------------------------------------------------------------
  // Time
  // -------------------------------------------------------------------------

  // Advance to time `t`. Returns true while the view is still moving, so a
  // caller keeps its frame loop alive exactly as long as it has to.
  step(t: number): boolean {
    const dt = Math.max(0, t - this.clock)
    this.clock = t
    if (this.mode === 'smooth') this.stepSmooth(dt)
    else if (this.mode === 'ease') this.stepEase(t)
    else if (this.mode === 'coast') this.stepCoast(dt)
    return this.moving
  }

  private stepSmooth(dt: number): void {
    const alpha = 1 - Math.exp(-dt / SMOOTH_TAU)
    const from = Math.log(this.cur.zoom)
    const to = Math.log(this.tgt.zoom)
    // exp(log(z)) can land an ulp past the target; never let it.
    const zoomRaw = Math.exp(from + (to - from) * alpha)
    const zoom = to >= from ? Math.min(zoomRaw, this.tgt.zoom) : Math.max(zoomRaw, this.tgt.zoom)
    let next: Camera
    if (this.anchor) {
      // The centre follows from the zoom, so the anchor holds at every frame.
      next = anchoredCamera(this.anchor.content, this.anchor.screen, zoom, this.frame, this.screen)
    } else {
      next = {
        cx: this.cur.cx + (this.tgt.cx - this.cur.cx) * alpha,
        cy: this.cur.cy + (this.tgt.cy - this.cur.cy) * alpha,
        zoom,
      }
    }
    const ppu = basePxPerUnit(this.frame, this.screen) * next.zoom
    const offPx = Math.hypot(next.cx - this.tgt.cx, next.cy - this.tgt.cy) * ppu
    if (Math.abs(to - Math.log(next.zoom)) < ARRIVE_LOG_ZOOM && offPx < ARRIVE_PX) {
      this.cur = this.tgt
      this.anchor = null
      this.mode = 'rest'
    } else {
      this.cur = next
    }
  }

  private stepEase(t: number): void {
    const ease = this.ease
    if (!ease) {
      this.mode = 'rest'
      return
    }
    const u = Math.min(1, Math.max(0, (t - ease.t0) / EASE_DURATION))
    if (u >= 1) {
      this.cur = ease.to
      this.ease = null
      this.mode = 'rest'
      return
    }
    const e = 1 - Math.pow(1 - u, 3)
    const lz0 = Math.log(ease.from.zoom)
    const lz1 = Math.log(ease.to.zoom)
    this.cur = {
      cx: ease.from.cx + (ease.to.cx - ease.from.cx) * e,
      cy: ease.from.cy + (ease.to.cy - ease.from.cy) * e,
      zoom: Math.exp(lz0 + (lz1 - lz0) * e),
    }
  }

  private stepCoast(dt: number): void {
    const moved = panByScreen(this.cur, this.vx * dt, this.vy * dt, this.frame, this.screen)
    const next = this.clamp(moved)
    // An axis the clamp stopped is finished; the other slides along the wall.
    if (next.cx !== moved.cx) this.vx = 0
    if (next.cy !== moved.cy) this.vy = 0
    this.cur = next
    this.tgt = next
    const decay = Math.exp(-dt / COAST_TAU)
    this.vx *= decay
    this.vy *= decay
    if (Math.hypot(this.vx, this.vy) * 1000 < COAST_STOP) this.mode = 'rest'
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private clamp(camera: Camera): Camera {
    return clampCamera(camera, this.frame, this.screen, this.limits)
  }

  private clampZoom(zoom: number): number {
    return Math.min(this.limits.zoomMax, Math.max(this.limits.zoomMin, zoom))
  }

  // A new input arrives. An eased move or a coast is dropped where it is, and
  // the target becomes the current camera so the next move starts from what the
  // reader is looking at. A smoothed move in flight is kept: wheel notches
  // compound onto its target. If the view was at rest the clock restarts at
  // the input, so the first step integrates from then and not from some
  // earlier idle frame.
  private interrupt(t: number): void {
    if (this.mode === 'ease' || this.mode === 'coast') {
      this.tgt = this.cur
      this.ease = null
      this.mode = 'rest'
    }
    if (this.mode === 'rest') this.clock = t
    this.dragging = false
    this.samples = []
  }

  private beginSmooth(): void {
    if (this.reduced) {
      this.cur = this.tgt
      this.anchor = null
      this.mode = 'rest'
      return
    }
    this.mode = 'smooth'
  }

  // Stop where the view is: nothing in flight, nothing remembered.
  private halt(): void {
    this.tgt = this.cur
    this.anchor = null
    this.ease = null
    this.mode = 'rest'
    this.dragging = false
    this.samples = []
  }

  // Finish whatever is running by landing on its target.
  private finish(): void {
    this.cur = this.tgt
    this.anchor = null
    this.ease = null
    this.mode = 'rest'
  }
}
