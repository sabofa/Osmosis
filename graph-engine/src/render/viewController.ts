import {
  fittedCamera,
  GestureRecognizer,
  ViewMotion,
  type Intent,
  type PointerSample,
  type Vec,
} from '../view2d'
import { axisZoom, wheelFactor } from '../plot/view/axisZoom'
import { axisZoomAllowedFor } from '../plot/view/authored'
import { plotCameraOf, plotViewOf, PLOT_LIMITS } from '../plot/view/plotView'
import type { Camera2D } from './camera2d'

// The 2D renderer's input model with no DOM and no WebGL: view2d's GestureRecognizer decodes samples into
// intents, ViewMotion smooths / coasts / eases them, and the result is written to the Camera2D facade each
// step. The renderer feeds it events and calls step() from its own frame loop. Clockless: every call is
// given its t (ms).

export interface WheelInput {
  x: number
  y: number
  deltaX: number
  deltaY: number
  deltaMode: 0 | 1 | 2
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  t: number
}

export class ViewController {
  private readonly recognizer: GestureRecognizer
  private motion: ViewMotion
  // Whether one-axis zoom may change the unit ratio: only when the authored aspect is not equal.
  // An exact change was written straight to the camera: the next step must report it.
  private pending = false
  private readonly axisZoomAllowed: () => boolean

  private readonly cam: Camera2D

  /** A locked (@lock) plot keeps its authored view: every input below is a no-op that reports not-handled. */
  locked: boolean

  constructor(cam: Camera2D, options?: { axisZoomAllowed?: () => boolean; locked?: boolean }) {
    this.cam = cam
    this.locked = options?.locked ?? false
    this.axisZoomAllowed = options?.axisZoomAllowed ?? (() => axisZoomAllowedFor(cam.aspect()))
    this.recognizer = new GestureRecognizer({ screen: () => cam.screenSize() })
    this.motion = new ViewMotion({
      frame: cam.frame(),
      screen: cam.screenSize(),
      start: plotCameraOf(cam.getView()),
      limits: PLOT_LIMITS,
    })
  }

  get moving(): boolean {
    return this.motion.moving
  }

  /** The canvas was resized (the camera keeps its world height): re-seat the motion on the new view. */
  resized(): void {
    this.motion.setScreen(this.cam.screenSize())
    this.motion.setContent(this.cam.frame(), plotCameraOf(this.cam.getView()))
  }

  pointerDown(s: PointerSample): Intent[] {
    if (this.locked) return []
    return this.dispatch(this.recognizer.pointerDown(s))
  }
  pointerMove(s: PointerSample): Intent[] {
    if (this.locked) return []
    return this.dispatch(this.recognizer.pointerMove(s))
  }
  pointerUp(s: PointerSample): Intent[] {
    if (this.locked) return []
    return this.dispatch(this.recognizer.pointerUp(s))
  }
  pointerCancel(s: PointerSample): Intent[] {
    if (this.locked) return []
    return this.dispatch(this.recognizer.pointerCancel(s))
  }

  /** True when the wheel moved the view (a locked plot leaves it, and the page scrolls). Plain wheel: isotropic zoom. Alt: x only; Alt+Shift: y only (exact, unsmoothed). */
  wheel(w: WheelInput): boolean {
    if (this.locked) return false
    if (!w.altKey) {
      this.dispatch(this.recognizer.wheel({ ...w, deltaY: w.deltaY || w.deltaX }))
      return true
    }
    if (!this.axisZoomAllowed()) return true
    const factor = wheelFactor(w)
    const view = plotViewOf(this.motion.current, this.cam.getView().a, this.cam.getView().b)
    const next = axisZoom(view, this.cam.plotWindow(), w.shiftKey ? 'y' : 'x', factor, { x: w.x, y: w.y }, this.cam.screenSize())
    this.cam.setView(next)
    this.motion.setContent(this.cam.frame(), plotCameraOf(next))
    this.pending = true
    return true
  }

  /** True when the key is the view's (the caller then preventDefaults). */
  key(key: string, t: number): boolean {
    if (this.locked) return false
    const intents = this.recognizer.key({ key, t })
    this.dispatch(intents)
    return intents.some((i) => i.kind === 'zoom' || i.kind === 'pan' || i.kind === 'reset')
  }

  reset(t: number): void {
    if (this.locked) return
    const start = this.cam.startView()
    const view = this.cam.getView()
    if (start.a !== view.a || start.b !== view.b) {
      // A one-axis zoom changed the frame itself: nothing to ease between, go back at once.
      this.cam.setView(start)
      this.motion.setContent(this.cam.frame(), plotCameraOf(start))
      this.pending = true
    } else {
      this.motion.animateTo(fittedCamera(this.cam.frame()), t)
    }
  }

  /** Advance to t; true when the camera changed. Keep calling while `moving`. */
  step(t: number): boolean {
    const before = this.cam.getView()
    this.motion.step(t)
    const cur = this.motion.current
    const forced = this.pending
    this.pending = false
    if (!forced && cur.cx === before.a * before.cu && cur.cy === -before.b * before.cv && cur.zoom === before.zoom) return false
    this.cam.setView(plotViewOf(cur, before.a, before.b))
    return true
  }

  private dispatch(intents: Intent[]): Intent[] {
    const m = this.motion
    for (const i of intents) {
      switch (i.kind) {
        case 'dragStart': m.dragStart(i.t); break
        case 'drag': m.dragBy(i.dx, i.dy, i.t); break
        case 'dragEnd': m.dragEnd(i.t); break
        case 'zoom': m.zoomAt(i.at as Vec, i.factor, i.t); break
        case 'pinch': m.pinch(i.at, i.factor, i.dx, i.dy, i.t); break
        case 'pan': m.panBy(i.dx, i.dy, i.t); break
        case 'reset': this.reset(i.t); break
      }
    }
    return intents
  }
}
