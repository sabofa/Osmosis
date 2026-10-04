import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { fittedCamera, pxPerUnit, screenToContent, visibleRect } from '../camera'
import { GestureRecognizer, type Intent, type PointerKind, type PointerSample } from '../input'
import { clampCamera, DEFAULT_LIMITS, type LimitsPolicy } from '../limits'
import { ViewMotion } from '../motion'
import { hitTest, PointerSelection, type HitItem } from '../pointing'
import type { Camera, Rect, Size, Vec } from '../types'
import { keyReachesView, pointerKindOf, swallowsKey, toleranceInContent } from './domInput'
import { resetTarget, sameView, viewKey } from './startView'
import './view2d.css'

// The browser layer of the 2D handling model.
//
// Everything that is a decision lives in the pure core (../*.ts) and in the
// small pure helpers beside this file, all of which node tests reach. This
// file only plumbs: it turns DOM events into the core's samples, runs the
// core's intents through the motion, and draws the result through the engine's
// `onApply`. It cannot be render-tested here, so it is kept to that.

export interface View2dOptions {
  // The content frame; null: nothing to handle.
  frame: Rect | null
  // The start view (from @focus), else fitted.
  start: Camera | null
  items?: readonly HitItem[]
  // Read when the view is first made; a different policy later is not picked up.
  limits?: LimitsPolicy
  // Draw the window. Called whenever the drawn camera changes.
  onApply(camera: Camera, visible: Rect, pxPerUnit: number): void
  onHover?(id: string | null): void
  onSelect?(id: string | null): void
  onToggleCoordinates?(): void
  // Keep `pointer` up to date. Off by default: it re-renders on every mouse
  // move, which only the coordinate readout wants.
  trackPointer?: boolean
}

export interface View2dHandle {
  // Attach to the element that receives input.
  surfaceRef: React.RefCallback<HTMLElement>
  camera: Camera | null
  // The pointer in content units, for the readout.
  pointer: Vec | null
  // To the start view; already there: to the fitted view.
  reset(): void
  focus(camera: Camera, animate?: boolean): void
  atStart: boolean
}

interface Publish {
  camera(camera: Camera): void
  pointer(point: Vec | null): void
  atStart(atStart: boolean): void
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

class Controller {
  private screen: Size = { width: 0, height: 0 }
  private motion: ViewMotion | null = null
  private key: string | null = null
  private reduced = false
  private readonly recognizer = new GestureRecognizer({ screen: () => this.screen })
  private readonly selection = new PointerSelection()
  private raf = 0
  private lastDrawn: Camera | null = null
  private lastAtStart = true
  private lastPointer: Vec | null = null
  private teardown: (() => void) | null = null
  private readonly read: () => View2dOptions
  private readonly publish: Publish

  constructor(read: () => View2dOptions, publish: Publish) {
    this.read = read
    this.publish = publish
  }

  // -------------------------------------------------------------------------
  // The hook's side
  // -------------------------------------------------------------------------

  // The content (or the start view) may have changed: a new figure starts at
  // its own start view and forgets what was pointed at; the same drawing
  // rebuilt keeps the reader where they were.
  sync(): void {
    const { frame, start, limits } = this.read()
    const key = viewKey(frame, start)
    if (key === null || !frame || !start) {
      this.stopFrames()
      this.motion = null
      this.key = null
      this.lastDrawn = null
      this.clearPointing()
      return
    }
    if (!this.motion) {
      this.motion = new ViewMotion({ frame, screen: this.screen, start, limits, reducedMotion: this.reduced })
    } else if (key !== this.key) {
      this.stopFrames()
      this.motion.setContent(frame, start)
    }
    if (key !== this.key) {
      this.key = key
      this.lastDrawn = null
      this.clearPointing()
    }
    this.draw()
  }

  // What was pointed at belongs to the items that were drawn.
  clearPointing(): void {
    const o = this.read()
    if (this.selection.hover(null)) o.onHover?.(null)
    if (this.selection.clear()) o.onSelect?.(null)
    this.setPointer(null)
  }

  reset(): void {
    const { frame } = this.read()
    const m = this.motion
    if (!m || !frame) return
    const ppu = pxPerUnit(frame, m.current, this.screen)
    m.animateTo(resetTarget(m.current, this.startNow(frame), fittedCamera(frame), ppu), performance.now())
    this.kick()
  }

  focus(camera: Camera, animate = true): void {
    const { frame } = this.read()
    const m = this.motion
    if (!m || !frame) return
    if (animate) m.animateTo(camera, performance.now())
    else m.setContent(frame, camera)
    this.kick()
  }

  // -------------------------------------------------------------------------
  // The surface
  // -------------------------------------------------------------------------

  attach(el: HTMLElement | null): void {
    this.detach()
    if (!el) return
    el.tabIndex = 0
    el.classList.add('view2d-surface')

    const sample = (ev: PointerEvent): PointerSample => {
      const box = el.getBoundingClientRect()
      return {
        id: ev.pointerId,
        x: ev.clientX - box.left,
        y: ev.clientY - box.top,
        t: performance.now(),
        kind: pointerKindOf(ev.pointerType),
        button: ev.button,
      }
    }
    const release = (ev: PointerEvent) => {
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId)
    }

    const onPointerDown = (ev: PointerEvent) => {
      if (!this.motion) return
      // Blocks text selection and native drag; focus is given by hand because
      // the default that would give it has just been cancelled.
      ev.preventDefault()
      el.focus({ preventScroll: true })
      try {
        el.setPointerCapture(ev.pointerId)
      } catch {
        // The pointer is already gone (a touch lifted between event and handler).
      }
      this.dispatch(this.recognizer.pointerDown(sample(ev)))
    }
    const onPointerMove = (ev: PointerEvent) => {
      if (this.motion) this.dispatch(this.recognizer.pointerMove(sample(ev)))
    }
    const onPointerUp = (ev: PointerEvent) => {
      release(ev)
      if (this.motion) this.dispatch(this.recognizer.pointerUp(sample(ev)))
    }
    const onPointerCancel = (ev: PointerEvent) => {
      release(ev)
      if (this.motion) this.dispatch(this.recognizer.pointerCancel(sample(ev)))
    }
    const onPointerLeave = (ev: PointerEvent) => {
      if (this.motion) this.dispatch(this.recognizer.pointerLeave(pointerKindOf(ev.pointerType)))
    }
    const onWheel = (ev: WheelEvent) => {
      if (!this.motion) return
      // Non-passive, so the page does not scroll while a figure is zoomed.
      ev.preventDefault()
      const box = el.getBoundingClientRect()
      this.dispatch(
        this.recognizer.wheel({
          x: ev.clientX - box.left,
          y: ev.clientY - box.top,
          deltaY: ev.deltaY,
          deltaMode: ev.deltaMode as 0 | 1 | 2,
          ctrlKey: ev.ctrlKey,
          t: performance.now(),
        }),
      )
    }
    const onKeyDown = (ev: KeyboardEvent) => {
      if (!this.motion || !keyReachesView(ev)) return
      const intents = this.recognizer.key({ key: ev.key, t: performance.now() })
      if (!swallowsKey(intents, this.read().onToggleCoordinates !== undefined)) return
      ev.preventDefault()
      this.dispatch(intents)
    }
    // Belt and braces for "no text selection, ever": the CSS already forbids
    // it and pointerdown's preventDefault stops it starting.
    const onBlock = (ev: Event) => ev.preventDefault()

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerCancel)
    el.addEventListener('pointerleave', onPointerLeave)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('keydown', onKeyDown)
    el.addEventListener('selectstart', onBlock)
    el.addEventListener('dragstart', onBlock)

    const measure = (size: Size) => {
      this.screen = size
      this.motion?.setScreen(size)
      this.draw()
    }
    measure({ width: el.clientWidth, height: el.clientHeight })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (entry) measure({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer?.observe(el)

    // Live, so a reader who flips the setting does not have to reload.
    const media = typeof matchMedia === 'undefined' ? null : matchMedia(REDUCED_MOTION)
    const onMedia = () => {
      this.reduced = media?.matches ?? false
      this.motion?.setReducedMotion(this.reduced)
      this.kick()
    }
    this.reduced = media?.matches ?? false
    this.motion?.setReducedMotion(this.reduced)
    media?.addEventListener('change', onMedia)

    this.teardown = () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerCancel)
      el.removeEventListener('pointerleave', onPointerLeave)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('keydown', onKeyDown)
      el.removeEventListener('selectstart', onBlock)
      el.removeEventListener('dragstart', onBlock)
      observer?.disconnect()
      media?.removeEventListener('change', onMedia)
    }
  }

  private detach(): void {
    this.teardown?.()
    this.teardown = null
    this.stopFrames()
  }

  // -------------------------------------------------------------------------
  // Intents
  // -------------------------------------------------------------------------

  private dispatch(intents: Intent[]): void {
    const m = this.motion
    if (!m || intents.length === 0) return
    let moves = false
    for (const intent of intents) {
      switch (intent.kind) {
        case 'dragStart':
          m.dragStart(intent.t)
          moves = true
          break
        case 'drag':
          m.dragBy(intent.dx, intent.dy, intent.t)
          moves = true
          break
        case 'dragEnd':
          m.dragEnd(intent.t)
          moves = true
          break
        case 'zoom':
          m.zoomAt(intent.at, intent.factor, intent.t)
          moves = true
          break
        case 'pinch':
          m.pinch(intent.at, intent.factor, intent.dx, intent.dy, intent.t)
          moves = true
          break
        case 'pan':
          m.panBy(intent.dx, intent.dy, intent.t)
          moves = true
          break
        case 'reset':
          this.reset() // starts its own frames
          break
        case 'click': {
          const hit = this.pick(intent.at, intent.pointer)
          if (this.selection.click(hit?.id ?? null)) this.read().onSelect?.(hit?.id ?? null)
          break
        }
        case 'hover':
          this.hover(intent.at, intent.pointer)
          break
        case 'clearSelection':
          if (this.selection.clear()) this.read().onSelect?.(null)
          break
        case 'toggleCoordinates':
          this.read().onToggleCoordinates?.()
          break
      }
    }
    // A move may have changed the view: drag and pinch are exact and already
    // there, the rest are in flight. The loop draws, and stops itself. Pointing
    // alone (hover, click) does not move anything, so it starts no frames.
    if (moves) this.kick()
  }

  private pick(at: Vec, kind: PointerKind): HitItem | null {
    const { frame, items } = this.read()
    const m = this.motion
    if (!m || !frame || !items || items.length === 0) return null
    const content = screenToContent(at, frame, m.current, this.screen)
    return hitTest(items, content, toleranceInContent(kind, pxPerUnit(frame, m.current, this.screen)))
  }

  private hover(at: Vec | null, kind: PointerKind): void {
    const { frame } = this.read()
    const m = this.motion
    if (!m || !frame) return
    this.setPointer(at ? screenToContent(at, frame, m.current, this.screen) : null)
    const id = at ? (this.pick(at, kind)?.id ?? null) : null
    if (this.selection.hover(id)) this.read().onHover?.(id)
  }

  private setPointer(point: Vec | null): void {
    if (!this.read().trackPointer && point !== null) return
    const last = this.lastPointer
    if (last === point || (last && point && last.x === point.x && last.y === point.y)) return
    this.lastPointer = point
    this.publish.pointer(point)
  }

  // -------------------------------------------------------------------------
  // Frames
  // -------------------------------------------------------------------------

  // Run the frame loop for as long as the motion is moving; any intent
  // restarts it.
  private kick(): void {
    if (this.raf === 0) this.raf = requestAnimationFrame(this.tick)
  }

  private stopFrames(): void {
    if (this.raf !== 0) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private readonly tick = (): void => {
    this.raf = 0
    const m = this.motion
    if (!m) return
    const moving = m.step(performance.now())
    this.draw()
    if (moving) this.kick()
  }

  // The start view as the motion would hold it: past a limit it is clamped,
  // and "already at the start" must mean the view the reader can actually reach.
  private startNow(frame: Rect): Camera {
    const { start, limits } = this.read()
    return start ? clampCamera(start, frame, this.screen, limits ?? DEFAULT_LIMITS) : fittedCamera(frame)
  }

  private draw(): void {
    const { frame, onApply } = this.read()
    const m = this.motion
    // An unmeasured view has no window to draw; the engine's own markup shows
    // until the first measurement.
    if (!m || !frame || this.screen.width <= 0 || this.screen.height <= 0) return
    const camera = m.current
    if (camera === this.lastDrawn) return
    this.lastDrawn = camera
    const ppu = pxPerUnit(frame, camera, this.screen)
    onApply(camera, visibleRect(frame, camera, this.screen), ppu)
    this.publish.camera(camera)
    const atStart = sameView(camera, this.startNow(frame), ppu)
    if (atStart !== this.lastAtStart) {
      this.lastAtStart = atStart
      this.publish.atStart(atStart)
    }
  }
}

export function useView2d(options: View2dOptions): View2dHandle {
  const latest = useRef(options)
  latest.current = options

  const [camera, setCamera] = useState<Camera | null>(null)
  const [pointer, setPointer] = useState<Vec | null>(null)
  const [atStart, setAtStart] = useState(true)
  const [controller] = useState(
    () => new Controller(() => latest.current, { camera: setCamera, pointer: setPointer, atStart: setAtStart }),
  )

  // A new figure, or a new start view: by value, so that a rebuild which
  // changes nothing the reader can see does not move them. Layout effects, so
  // the start view is drawn before the first paint rather than after a flash
  // of the fitted one.
  const key = viewKey(options.frame, options.start)
  useLayoutEffect(() => controller.sync(), [controller, key])
  useLayoutEffect(() => controller.clearPointing(), [controller, options.items])

  const surfaceRef = useCallback((el: HTMLElement | null) => controller.attach(el), [controller])
  const reset = useCallback(() => controller.reset(), [controller])
  const focus = useCallback((to: Camera, animate = true) => controller.focus(to, animate), [controller])

  return { surfaceRef, camera, pointer, reset, focus, atStart }
}
