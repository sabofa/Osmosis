import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { fittedCamera, pxPerUnit, screenToContent, visibleRect } from '../camera'
import { GestureRecognizer, type Intent, type PointerKind, type PointerSample } from '../input'
import { clampCamera, DEFAULT_LIMITS, type LimitsPolicy } from '../limits'
import { commitDue, liveTransform, type LiveTransform } from '../liveTransform'
import { SETTLE_MS } from '../feel'
import { ViewMotion } from '../motion'
import { hitTest, PointerSelection, type HitItem } from '../pointing'
import type { Camera, Rect, Size, Vec } from '../types'
import { keyReachesView, pointerKindOf, publishOnTrack, swallowsKey, toleranceInContent, type Tracking } from './domInput'
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
  // Draw the window. Called whenever the drawn camera changes; or, if `onLive`
  // is given, only when the drawing is *committed* (see onLive).
  // `settled`: the view is at rest (a commit mid-gesture says false), so an
  // engine can draw a cheaper drawing while it is not.
  onApply(camera: Camera, visible: Rect, pxPerUnit: number, settled: boolean): void
  // A cheap live view for a drawing that is dear to redraw. When given, a
  // moving view is not drawn through `onApply` on every frame: the drawing is
  // left as it was last committed and this is told how to move it (a
  // translate and a scale, relative to the committed view; see
  // ../liveTransform). `onApply` is then called to commit, when the motion
  // has stopped or has drifted far enough (see commitDue); the engine clears
  // its transform there.
  onLive?(transform: LiveTransform): void
  // With `onLive`: how much larger than the screen the committed drawing is on
  // each side, as a fraction of the screen (0: exactly the screen). The
  // engine draws `visible` grown by this in `onApply`; the hook needs it to
  // know when the live view has left the drawing.
  overscan?: number
  onHover?(id: string | null): void
  // Every selected id, in the order added; empty when nothing is selected.
  onSelect?(ids: readonly string[]): void
  onToggleCoordinates?(): void
  // Keep `pointer` up to date. Off by default: it re-renders on every mouse
  // move, which only the coordinate readout wants.
  trackPointer?: boolean
  // Keep `camera` up to date. Off by default, for the same reason: publishing
  // it re-renders the engine's view on every frame of a move, which only the
  // readout wants (the drawing itself goes through `onApply`).
  trackCamera?: boolean
}

export interface View2dHandle {
  // Attach to the element that receives input.
  surfaceRef: React.RefCallback<HTMLElement>
  // Where the view is looking, for the readout. Null until `trackCamera` is on;
  // after it goes off it keeps the last camera published.
  camera: Camera | null
  // The pointer in content units, for the readout. Null until `trackPointer` is on.
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

const sameRect = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

class Controller {
  private screen: Size = { width: 0, height: 0 }
  private motion: ViewMotion | null = null
  private key: string | null = null
  private reduced = false
  private readonly recognizer = new GestureRecognizer({ screen: () => this.screen })
  private readonly selection = new PointerSelection()
  private raf = 0
  private lastDrawn: Camera | null = null
  // The view last committed through onApply, with `onLive` given: the visible
  // window, the screen it was for, and when.
  private committed: { visible: Rect; screen: Size; at: number } | null = null
  // When the camera last changed (the clock of draw), for settling.
  private lastChangeAt = 0
  // The live view is not the committed one yet; the frame loop must go on
  // until it is.
  private uncommitted = false
  private lastAtStart = true
  // The pointer as last published, to publish only a change.
  private lastPointer: Vec | null = null
  // The pointer as last seen, kept whether or not anything is listening, so a
  // readout that comes on has it at once.
  private seenPointer: Vec | null = null
  // Where the pointer last was on the screen, so that a view that moves under a
  // still mouse (a key pan, a coast) moves the pointer's content position too.
  private pointerScreen: Vec | null = null
  // The readouts being listened to, as of the last render.
  private tracked: Tracking = { camera: false, pointer: false }
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
      this.committed = null
      this.uncommitted = false
      this.pointerScreen = null
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
      this.committed = null
      this.clearPointing()
    }
    this.draw()
  }

  // What was pointed at belongs to the items that were drawn.
  clearPointing(): void {
    const o = this.read()
    if (this.selection.hover(null)) o.onHover?.(null)
    if (this.selection.clear()) o.onSelect?.([])
    this.setPointer(null)
  }

  // A readout started or stopped listening. Nothing was published while it was
  // not, so one that has just started is handed what the view holds now: the
  // camera as last drawn and the pointer as last seen, with no frame or move
  // to wait for. Stored in plain fields, so untracked frames cost nothing.
  trackingChanged(now: Tracking): void {
    const publication = publishOnTrack(this.tracked, now, { camera: this.lastDrawn, pointer: this.seenPointer })
    this.tracked = now
    if (publication.camera) this.publish.camera(publication.camera)
    if (publication.pointer !== undefined) {
      this.lastPointer = publication.pointer
      this.publish.pointer(publication.pointer)
    }
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
        shiftKey: ev.shiftKey,
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

    // `inFrame`: called from the observer, not from a ref callback, so the
    // readout may be rendered at once (see draw).
    const measure = (size: Size, inFrame = false) => {
      this.screen = size
      this.motion?.setScreen(size)
      this.draw(inFrame)
    }
    measure({ width: el.clientWidth, height: el.clientHeight })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (entry) measure({ width: entry.contentRect.width, height: entry.contentRect.height }, true)
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
          if (this.selection.click(hit?.id ?? null, intent.additive)) this.read().onSelect?.(this.selection.selected)
          break
        }
        case 'hover':
          this.hover(intent.at, intent.pointer)
          break
        case 'clearSelection':
          if (this.selection.clear()) this.read().onSelect?.([])
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
    this.pointerScreen = at
    this.setPointer(at ? screenToContent(at, frame, m.current, this.screen) : null)
    const id = at ? (this.pick(at, kind)?.id ?? null) : null
    if (this.selection.hover(id)) this.read().onHover?.(id)
  }

  private setPointer(point: Vec | null): void {
    this.seenPointer = point
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
    this.draw(true)
    // Past the end of the motion the loop runs on until the drawing is
    // committed (a few frames: the view must be still for SETTLE_MS).
    if (moving || this.uncommitted) this.kick()
  }

  // The start view as the motion would hold it: past a limit it is clamped,
  // and "already at the start" must mean the view the reader can actually reach.
  private startNow(frame: Rect): Camera {
    const { start, limits } = this.read()
    return start ? clampCamera(start, frame, this.screen, limits ?? DEFAULT_LIMITS) : fittedCamera(frame)
  }

  private draw(inFrame = false): void {
    const { frame, onApply, onLive, overscan } = this.read()
    const m = this.motion
    // An unmeasured view has no window to draw; the engine's own markup shows
    // until the first measurement.
    if (!m || !frame || this.screen.width <= 0 || this.screen.height <= 0) {
      this.uncommitted = false
      return
    }
    const camera = m.current
    const changed = camera !== this.lastDrawn
    const now = performance.now()
    if (changed) {
      this.lastDrawn = camera
      this.lastChangeAt = now
      if (this.pointerScreen) this.setPointer(screenToContent(this.pointerScreen, frame, camera, this.screen))
    }
    const visible = visibleRect(frame, camera, this.screen)
    const ppu = pxPerUnit(frame, camera, this.screen)
    if (!onLive) {
      // The engine draws every change itself.
      if (!changed) return
      onApply(camera, visible, ppu, true)
    } else {
      // The drawing is committed now and then; between, it is moved.
      const prior = this.committed
      const due = commitDue({
        committed: prior ? prior.visible : null,
        live: visible,
        overscan: overscan ?? 0,
        moving: m.moving,
        idleMs: now - this.lastChangeAt,
        sinceCommitMs: prior ? now - prior.at : Infinity,
        reduced: this.reduced,
        screenChanged: prior !== null && (prior.screen.width !== this.screen.width || prior.screen.height !== this.screen.height),
      })
      if (due) {
        this.committed = { visible, screen: { ...this.screen }, at: now }
        onApply(camera, visible, ppu, !m.moving && now - this.lastChangeAt >= SETTLE_MS)
      } else if (changed && prior) {
        onLive(liveTransform(prior.visible, visible, this.screen))
      }
      const base = this.committed
      this.uncommitted = base !== null && !sameRect(base.visible, visible)
      // A commit with the camera unchanged (the view settled) has nothing new
      // to publish.
      if (!changed) return
    }
    if (this.read().trackCamera) {
      // From a frame (or the size observer), the readout is rendered now, in the frame that drew the
      // camera: a state update from a rAF callback is otherwise left to
      // React's scheduler, which can run after the paint (and, under a
      // headless screenshot, never before it), so the readout would show the
      // previous camera against a drawing that had already moved. Never from
      // a layout effect, where React refuses (and warns about) a flushSync.
      if (inFrame) flushSync(() => this.publish.camera(camera))
      else this.publish.camera(camera)
    }
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

  const trackCamera = options.trackCamera === true
  const trackPointer = options.trackPointer === true
  useLayoutEffect(
    () => controller.trackingChanged({ camera: trackCamera, pointer: trackPointer }),
    [controller, trackCamera, trackPointer],
  )

  const surfaceRef = useCallback((el: HTMLElement | null) => controller.attach(el), [controller])
  const reset = useCallback(() => controller.reset(), [controller])
  const focus = useCallback((to: Camera, animate = true) => controller.focus(to, animate), [controller])

  return { surfaceRef, camera, pointer, reset, focus, atStart }
}
