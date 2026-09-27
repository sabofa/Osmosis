// SpaceRenderer (plan G11, spec SP1): the class a host mounts on a canvas to
// draw a SpaceScene inside a real chart frame. It orchestrates the pure
// modules (camera/, frame/, ui/layout.ts), the GL backend (gl/) and the DOM
// overlay and input (ui/), and renders on demand: a frame is drawn only after
// a scene, camera, size or theme change, or while inertia runs.
//
// The overlay is created as a sibling of the canvas inside the canvas's
// parent, which must be `position: relative`; dispose() removes it.
//
// Nothing here throws into its host: a missing WebGL2 shows a legible
// message in the view, and shader or GL failures go to onError.
//
// Interaction (S3): hovering runs the probe (pick/pick.ts), at most once per
// animation frame; a click pins what is under the cursor, or unpins a pin
// clicked near its marker; Esc clears the pins. Markers and drop lines are
// the backend's overlay (ui/interactionLayer.ts), readouts are DOM boxes
// (ui/probe.ts). `@hover: none` turns the probe and pins off. What the reader
// is exposed to is reported through onEvent.
//
// Parameters (S3): a spec's @param bindings get a panel (ui/params.ts) with
// sliders and play; a point defined by one or two bindings can be dragged
// (pick/drag.ts). Every change, from the panel, play, a drag or a host's
// setValue, is coalesced to one kernel rebuild per animation frame.

import type { GraphConfig, HoverMode } from '../parser/config'
import type { Statement } from '../parser/types'
import type { Palette } from '../render/palette'
import { clampElevation, inertiaStep, sanitizeView, wrapAzimuth, type OrbitVelocity } from './camera/controls'
import { cameraMatrices, project, type CameraMatrices, type Viewport } from './camera/projection'
import { colormapTable } from './colormaps'
import { worldMap, type WorldMap } from './camera/world'
import { defaultSpaceConfig, type SpaceConfig, type SpaceView } from './config'
import type { SpaceEvent } from './events'
import { boxHalfExtents } from './frame/aspect'
import { resolveBox } from './frame/bounds'
import { buildFrame } from './frame/build'
import { frameAxes } from './frame/ticks'
import type { FrameAxes } from './frame/types'
import { GlBackend } from './gl/backend'
import { NO_WEBGL2_MESSAGE } from './gl/context'
import type { SpaceKernel } from './kernel/api'
import { createSpaceKernel } from './kernel/index'
import { solveDrag } from './pick/drag'
import { pickAt } from './pick/pick'
import { readoutTitle } from './pick/readout'
import type { Hit } from './pick/types'
import type { Mark, SceneError, SpaceScene } from './scene/types'
import { spaceColors, type SpaceColors } from './theme'
import { Colorbars } from './ui/colorbar'
import { colorbarModel, colorbarScales } from './ui/colorbarModel'
import { attachInput, InputMachine, type AttachedInput, type InputContext } from './ui/input'
import { interactionMarks, wallKey } from './ui/interactionLayer'
import { layoutLabels } from './ui/layout'
import { Overlay } from './ui/overlay'
import { ParamsPanel, type ParamRowState } from './ui/params'
import { NO_PINS, reducePins, type PinAction, type PinsState } from './ui/pins'
import { ReadoutBoxes, type ReadoutItem } from './ui/probe'
import { FrameScheduler, type CancelFrame, type RequestFrame } from './ui/scheduler'
import { finished, valueAt, type PlayMode } from './ui/timeline'

// The part of GraphConfig setScene reads: a GraphConfig is one, and so is a
// bare { space } for hand-built scenes (the review page's fixtures).
export interface SpaceRenderConfig {
  space: SpaceConfig
  // The spec's @hover; the probe and pins are off under 'none', and only
  // points are probed under 'points'. 'all' when absent.
  hover?: HoverMode
}

export interface SpaceRendererOptions {
  palette: Palette
  theme: 'light' | 'dark'
  onError?: (message: string) => void
  onContextLost?: () => void
  // The context came back and everything was rebuilt from the retained scene
  // (a host clears its "couldn't render" notice here).
  onContextRestored?: () => void
  // Called when the viewer moves the camera (drag, wheel, keys, inertia).
  onViewChange?: (view: SpaceView) => void
  // Exposure: the probe entering a mark, pins, parameter changes (E12).
  onEvent?: (event: SpaceEvent) => void
}

// Everything the renderer takes from the browser, injectable so it can be
// constructed and tested in node.
export interface SpaceRendererEnv {
  requestFrame: RequestFrame
  cancelFrame: CancelFrame
  now(): number
  devicePixelRatio(): number
  prefersReducedMotion(): boolean
  // Calls back whenever the element's CSS size may have changed; returns the unsubscribe.
  observeSize(element: HTMLElement, callback: () => void): () => void
  // Calls back whenever devicePixelRatio changes (a move to another monitor,
  // browser zoom), which resizes nothing in CSS; returns the unsubscribe.
  observePixelRatio(callback: () => void): () => void
}

export function browserEnv(): SpaceRendererEnv {
  return {
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    now: () => performance.now(),
    devicePixelRatio: () => (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
    prefersReducedMotion: () =>
      typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    observeSize(element, callback) {
      if (typeof ResizeObserver === 'undefined') {
        window.addEventListener('resize', callback)
        return () => window.removeEventListener('resize', callback)
      }
      const observer = new ResizeObserver(() => callback())
      observer.observe(element)
      return () => observer.disconnect()
    },
    observePixelRatio(callback) {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
      // A resolution query matches only the current ratio, so it fires once
      // when the ratio changes and must be re-armed for the new one.
      let query: MediaQueryList | null = null
      const changed = () => {
        arm()
        callback()
      }
      const arm = () => {
        query?.removeEventListener('change', changed)
        query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
        query.addEventListener('change', changed)
      }
      arm()
      return () => query?.removeEventListener('change', changed)
    },
  }
}

// The backing store is CSS size x min(devicePixelRatio, 2).
export const MAX_PIXEL_RATIO = 2

function sameView(a: SpaceView, b: SpaceView): boolean {
  return (
    a.azimuth === b.azimuth &&
    a.elevation === b.elevation &&
    a.zoom === b.zoom &&
    a.target[0] === b.target[0] &&
    a.target[1] === b.target[1] &&
    a.target[2] === b.target[2]
  )
}

// @hover: points probes points only (pick/pick.ts filters before choosing).
const POINTS_ONLY = { kinds: new Set(['point'] as const) }

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

function sameBox(a: WorldMap | null, b: WorldMap): boolean {
  if (!a) return false
  const x = a.box
  const y = b.box
  return x.x.min === y.x.min && x.x.max === y.x.max && x.y.min === y.y.min && x.y.max === y.y.max && x.z.min === y.z.min && x.z.max === y.z.max
}

export class SpaceRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly options: SpaceRendererOptions
  private readonly env: SpaceRendererEnv
  private readonly backend: GlBackend
  private readonly overlay: Overlay
  private readonly colorbars: Colorbars
  private readonly readouts: ReadoutBoxes
  private readonly params: ParamsPanel
  private readonly scheduler: FrameScheduler
  private readonly input = new InputMachine()
  private readonly attached: AttachedInput
  private readonly stopObserving: () => void
  private readonly stopPixelRatio: () => void
  private colors: SpaceColors
  private scene: SpaceScene | null = null
  // The kernel behind the current scene, when it came from a spec; S3's
  // parameter panel drives it through setValue.
  private kernel: SpaceKernel | null = null
  private space: SpaceConfig = defaultSpaceConfig()
  private world: WorldMap | null = null
  private axes: FrameAxes | null = null
  private authored: SpaceView
  private view: SpaceView
  private viewport: Viewport = { width: 1, height: 1 }
  private pixelRatio = 1
  private inertia: OrbitVelocity | null = null
  private lastInertiaTime: number | null = null
  private disposed = false
  // The spec's source lines, for readout titles (setSpec's `source`).
  private sourceLines: readonly string[] | null = null
  private hoverMode: HoverMode = 'all'
  // The probe: what is under the cursor, and where the cursor is.
  private probe: { hit: Hit; x: number; y: number } | null = null
  // A hover position waiting for the next frame's pick, and the last one.
  private pendingHover: { x: number; y: number } | null = null
  private lastHover: { x: number; y: number } | null = null
  // The mark the probe was last reported on (hover events fire on a change).
  private hoverObject: string | null = null
  private pins: PinsState = NO_PINS
  private overlayKey = ''
  // The config the current scene was set with (a value change rebuilds with it).
  private config: SpaceRenderConfig = { space: defaultSpaceConfig() }
  // Binding values waiting for the next frame, the last per name; `source`
  // is null for a host's setValue (no event).
  private readonly pendingValues = new Map<string, { value: number; source: 'slider' | 'play' | 'drag' | null }>()
  private readonly playing = new Map<string, { t0: number; mode: PlayMode }>()
  private readonly looping = new Set<string>()
  // The point being dragged (by source object) and the cursor to solve for.
  private dragging: { object: string } | null = null
  private pendingDrag: { x: number; y: number } | null = null

  constructor(canvas: HTMLCanvasElement, options: SpaceRendererOptions, env: SpaceRendererEnv = browserEnv()) {
    this.canvas = canvas
    this.options = options
    this.env = env
    this.colors = spaceColors(options.palette, options.theme)
    this.authored = { ...this.space.camera, target: [0, 0, 0] }
    this.view = { ...this.authored, target: [0, 0, 0] }
    this.overlay = new Overlay(canvas)
    this.overlay.setColors(this.colors)
    this.colorbars = new Colorbars(this.overlay.element)
    this.readouts = new ReadoutBoxes(this.overlay.element)
    this.readouts.setColors(this.colors)
    this.params = new ParamsPanel(this.overlay.element, {
      change: (name, value) => this.queueValue(name, value, 'slider'),
      togglePlay: (name) => this.togglePlay(name),
      toggleLoop: (name) => this.toggleLoop(name),
    })
    this.params.setColors(this.colors)
    this.scheduler = new FrameScheduler(env.requestFrame, env.cancelFrame, (time) => this.frame(time))
    this.backend = new GlBackend(canvas, {
      // A backend failure leaves nothing drawn: say why in the view too.
      onError: (message) => {
        this.overlay?.showMessage(`Space could not draw this view. ${message}`)
        this.report(message)
      },
      onContextLost: () => {
        this.scheduler.cancel()
        options.onContextLost?.()
      },
      onContextRestored: () => {
        this.scheduler.request()
        options.onContextRestored?.()
      },
    })
    if (!this.backend.available) this.overlay.showMessage(NO_WEBGL2_MESSAGE)
    canvas.tabIndex = 0
    this.attached = attachInput(canvas, this.input, {
      context: () => this.inputContext(),
      apply: (view) => this.applyUserView(view),
      startInertia: (velocity) => this.startInertia(velocity),
      stopInertia: () => this.stopInertia(),
      now: () => env.now(),
      prefersReducedMotion: () => env.prefersReducedMotion(),
      hover: (x, y) => this.hoverAt(x, y),
      leave: () => this.hoverAt(null, null),
      press: () => this.setProbe(null),
      click: (x, y) => this.clickAt(x, y),
      escape: () => this.applyPins({ type: 'clear' }),
      grab: (x, y) => this.grab(x, y),
      dragTo: (x, y) => {
        if (!this.dragging) return
        this.pendingDrag = { x, y }
        this.scheduler.request()
      },
      release: () => {
        this.dragging = null
        this.pendingDrag = null
      },
    })
    // A resize redraws at once: ResizeObserver runs after layout and before
    // paint, so drawing here puts the new size and the new frame in the same
    // paint. Waiting for the next animation frame would show the old frame
    // stretched to the new size for one frame (and a screenshot taken then
    // shows labels that no longer match the drawing).
    this.stopObserving = env.observeSize(canvas, () => {
      this.attached.invalidate()
      this.redrawNow()
    })
    // A new devicePixelRatio needs a new backing store even at the same CSS size.
    this.stopPixelRatio = env.observePixelRatio(() => this.redrawNow())
  }

  // Resolve the box, aspect and frame axes; upload; draw. The initial view
  // is the authored camera aimed at the box centre. Later scenes keep the
  // viewer's camera, re-aimed at the new box centre if the box moved, unless
  // the authored camera itself changed. A scene set here has no kernel
  // behind it (a hand-built fixture): no parameters.
  setScene(scene: SpaceScene, config: SpaceRenderConfig): void {
    if (this.disposed) return
    this.dropKernel()
    this.params.setBindings([])
    this.install(scene, config)
    this.scheduler.request()
  }

  // Set a binding's value, as the panel would (for hosts): applied on the
  // next frame, clamped and rounded by the kernel. No event is reported.
  setValue(name: string, value: number): void {
    if (this.disposed || !this.kernel) return
    this.queueValue(name, value, null)
  }

  private install(scene: SpaceScene, config: SpaceRenderConfig): void {
    this.config = config
    const space = config.space
    const box = resolveBox(space, scene.extent)
    const world = worldMap(box, boxHalfExtents(box, space.aspect, scene))
    const authored: SpaceView = { ...space.camera, target: world.centre }
    const first = this.scene === null
    const cameraChanged =
      space.camera.azimuth !== this.space.camera.azimuth ||
      space.camera.elevation !== this.space.camera.elevation ||
      space.camera.zoom !== this.space.camera.zoom ||
      space.projection !== this.space.projection
    if (first || cameraChanged) {
      this.stopInertia()
      this.view = sanitizeView(authored, authored)
    } else if (!sameBox(this.world, world)) {
      this.view = { ...this.view, target: world.centre }
    }
    this.scene = scene
    this.space = space
    this.hoverMode = config.hover ?? 'all'
    this.world = world
    this.authored = sanitizeView(authored, authored)
    this.axes = frameAxes(space, box)
    this.backend.setScene(scene, world, this.colors, { depthcue: space.depthcue })
    const { hidden } = colorbarScales(scene)
    if (hidden > 0) console.info(`space: showing the first 2 colorbars; ${hidden} more colour scale${hidden === 1 ? '' : 's'} not shown`)
    this.updateColorbars()
    // Pins follow the new scene through its picks; the probe is re-read at
    // the cursor on the next frame.
    if (this.hoverMode === 'none') this.applyPins({ type: 'clear' })
    else this.applyPins({ type: 'reevaluate', scene })
    this.setProbe(null)
    if (this.lastHover && this.hoverMode !== 'none' && !this.dragging) this.pendingHover = this.lastHover
  }

  // Build the space kernel from a parsed spec (parseSpec's statements, config
  // and statementLines) and draw its scene. Returns the scene's errors, each
  // with its 1-based line; nothing is thrown, and one bad statement never
  // blanks the rest. `source`, the spec text, titles readouts by their line.
  setSpec(statements: Statement[], config: GraphConfig, lines: readonly number[], source?: string): SceneError[] {
    if (this.disposed) return []
    this.sourceLines = source === undefined ? null : source.split(/\r?\n/)
    let scene: SpaceScene
    this.dropKernel()
    try {
      this.kernel = createSpaceKernel(statements, config, lines)
      scene = this.kernel.scene()
    } catch (error) {
      this.kernel = null
      this.params.setBindings([])
      return [{ line: 0, message: `space could not build this spec: ${error instanceof Error ? error.message : String(error)}` }]
    }
    this.install(scene, config)
    this.params.setBindings(this.kernel.bindings())
    this.syncParams()
    this.scheduler.request()
    return scene.errors
  }

  setPalette(palette: Palette, theme: 'light' | 'dark'): void {
    if (this.disposed) return
    this.colors = spaceColors(palette, theme)
    this.backend.setColors(this.colors)
    this.overlay.setColors(this.colors)
    this.readouts.setColors(this.colors)
    this.params.setColors(this.colors)
    this.overlayKey = ''
    this.updateColorbars()
    this.scheduler.request()
  }

  // Back to the authored view (what double-click and the 0 key do).
  resetView(): void {
    this.setView(this.authored)
  }

  getView(): SpaceView {
    return { ...this.view, target: [...this.view.target] }
  }

  setView(view: SpaceView): void {
    if (this.disposed) return
    const next = sanitizeView(view, this.view)
    this.stopInertia()
    if (sameView(next, this.view)) return
    this.view = next
    this.scheduler.request()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.scheduler.cancel()
    this.attached.detach()
    this.stopObserving()
    this.stopPixelRatio()
    this.backend.dispose()
    this.readouts.dispose()
    this.params.dispose()
    this.colorbars.dispose()
    this.overlay.dispose()
    this.scene = null
    this.kernel = null
  }

  // The kernel and everything that drives it go together.
  private dropKernel(): void {
    this.kernel = null
    this.pendingValues.clear()
    this.playing.clear()
    this.looping.clear()
    this.dragging = null
    this.pendingDrag = null
  }

  private queueValue(name: string, value: number, source: 'slider' | 'play' | 'drag' | null): void {
    if (!this.kernel || !Number.isFinite(value)) return
    this.pendingValues.set(name, { value, source })
    this.scheduler.request()
  }

  private togglePlay(name: string): void {
    if (!this.kernel) return
    if (this.playing.has(name)) this.playing.delete(name)
    else this.playing.set(name, { t0: this.env.now(), mode: this.looping.has(name) ? 'loop' : 'once' })
    this.syncParams()
    this.scheduler.request()
  }

  private toggleLoop(name: string): void {
    if (this.looping.has(name)) this.looping.delete(name)
    else this.looping.add(name)
    const play = this.playing.get(name)
    if (play) play.mode = this.looping.has(name) ? 'loop' : 'once'
    this.syncParams()
  }

  private syncParams(): void {
    const kernel = this.kernel
    if (!kernel) return
    const state = new Map<string, ParamRowState>()
    for (const [name, value] of kernel.values()) state.set(name, { value, playing: this.playing.has(name), loop: this.looping.has(name) })
    this.params.sync(state)
  }

  // A press on a draggable point takes the gesture from the camera.
  private grab(x: number, y: number): boolean {
    const scene = this.scene
    const world = this.world
    const camera = this.camera()
    if (this.disposed || !this.kernel || !scene || !world || !camera) return false
    const hit = pickAt(scene, camera, world, x, y)
    if (!hit || hit.kind !== 'point') return false
    const mark = scene.marks.find((m) => m.source.object === hit.source.object)
    if (!mark || mark.kind !== 'points' || !mark.drag) return false
    this.dragging = { object: hit.source.object }
    this.pendingHover = null
    this.setProbe(null)
    for (const name of mark.drag.params) this.playing.delete(name)
    return true
  }

  // Once per frame: play, the drag's solve, then every queued value in one
  // kernel rebuild. Returns true while something plays.
  private advanceValues(time: number): boolean {
    const kernel = this.kernel
    if (!kernel) return false
    const bindings = new Map(kernel.bindings().map((b) => [b.name, b]))
    let again = false
    for (const [name, play] of this.playing) {
      const binding = bindings.get(name)
      if (!binding) continue
      this.pendingValues.set(name, { value: valueAt(binding, play.t0, time, play.mode), source: 'play' })
      if (finished(play.t0, time, play.mode)) this.playing.delete(name)
      else again = true
    }
    const cursor = this.pendingDrag
    this.pendingDrag = null
    const scene = this.scene
    const world = this.world
    const camera = this.camera()
    if (cursor && this.dragging && scene && world && camera) {
      const object = this.dragging.object
      const mark = scene.marks.find((m) => m.source.object === object)
      if (mark?.kind === 'points' && mark.drag) {
        const values = kernel.values()
        const names = mark.drag.params
        const ranges = names.map((n) => bindings.get(n)!)
        const solution = solveDrag(mark.drag, names.map((n) => values.get(n)!), cursor, camera, world, ranges)
        names.forEach((n, i) => this.pendingValues.set(n, { value: solution.values[i], source: 'drag' }))
      }
    }
    if (this.pendingValues.size > 0) {
      let next = this.scene
      for (const [name, { value, source }] of this.pendingValues) {
        const before = kernel.values().get(name)
        next = kernel.setValue(name, value)
        const after = kernel.values().get(name)
        if (source && after !== undefined && after !== before) this.emit({ type: 'param', name, value: after, source })
      }
      this.pendingValues.clear()
      if (next && next !== this.scene) this.install(next, this.config)
      this.syncParams()
    }
    return again
  }

  // What is under a CSS pixel, under the @hover mode.
  private pickAt(x: number, y: number, camera: CameraMatrices): Hit | null {
    const scene = this.scene
    const world = this.world
    if (!scene || !world) return null
    return pickAt(scene, camera, world, x, y, this.hoverMode === 'points' ? POINTS_ONLY : {})
  }

  private camera(): CameraMatrices | null {
    return this.world ? cameraMatrices(this.view, this.world, this.viewport, this.space.projection) : null
  }

  // A hover move (x, y) or leaving the canvas (null): picked on the next
  // frame, so a burst of moves costs one pick.
  private hoverAt(x: number | null, y: number | null): void {
    if (this.disposed) return
    if (x === null || y === null) {
      this.lastHover = null
      this.pendingHover = null
      this.setProbe(null)
      return
    }
    if (this.hoverMode === 'none') return
    this.lastHover = { x, y }
    this.pendingHover = { x, y }
    this.scheduler.request()
  }

  private setProbe(probe: { hit: Hit; x: number; y: number } | null): void {
    const was = this.probe
    this.probe = probe
    const object = probe ? probe.hit.source.object : null
    if (object !== this.hoverObject) {
      this.hoverObject = object
      this.emit({ type: 'hover', hit: probe ? probe.hit : null })
    }
    if (was || probe) this.scheduler.request()
  }

  private clickAt(x: number, y: number): void {
    if (this.disposed || this.hoverMode === 'none') return
    const camera = this.camera()
    const world = this.world
    if (!camera || !world) return
    const markers = this.pins.pins.map((p) => {
      const s = project(camera, world.toWorld(p.hit.position))
      return { id: p.id, x: s.x, y: s.y }
    })
    this.applyPins({ type: 'click', x, y, hit: this.pickAt(x, y, camera), markers })
  }

  private applyPins(action: PinAction): void {
    const { state, events } = reducePins(this.pins, action)
    if (state === this.pins) return
    this.pins = state
    for (const e of events) this.emit(e)
    this.scheduler.request()
  }

  private emit(event: SpaceEvent): void {
    this.options.onEvent?.(event)
  }

  // The interaction layer's marks, rebuilt only when the points being read or
  // the back walls change.
  private syncInteraction(camera: CameraMatrices, world: WorldMap): void {
    const points = [...(this.probe ? [this.probe.hit.position] : []), ...this.pins.pins.map((p) => p.hit.position)]
    const key = `${wallKey(camera.direction)}|${points.map((p) => p.join(',')).join(';')}`
    if (key === this.overlayKey) return
    this.overlayKey = key
    const marks: Mark[] = interactionMarks(points, world.box, camera.direction, {
      marker: hex(this.colors.palette.hover),
      ink: hex(this.colors.palette.axis),
    })
    this.backend.setOverlay(marks)
  }

  // The probe's and the pins' readout boxes, at the cursor and the markers.
  private syncReadouts(camera: CameraMatrices, world: WorldMap): void {
    const title = (hit: Hit) => readoutTitle(hit.source, this.sourceLines?.[hit.source.line - 1] ?? null)
    const items: ReadoutItem[] = this.pins.pins.map((p) => {
      const s = project(camera, world.toWorld(p.hit.position))
      return { key: `pin:${p.id}`, title: title(p.hit), rows: p.hit.values, x: s.x, y: s.y, pinned: true }
    })
    if (this.probe) items.push({ key: 'probe', title: title(this.probe.hit), rows: this.probe.hit.values, x: this.probe.x, y: this.probe.y, pinned: false })
    this.readouts.sync(items, this.viewport.width, this.viewport.height)
  }

  // The colorbars for the current scene and theme (E5).
  private updateColorbars(): void {
    const scene = this.scene
    const shown = scene ? colorbarScales(scene).shown : []
    this.colorbars.update(shown.map((scale) => colorbarModel(scale, colormapTable(scale.map, this.colors))))
  }

  private redrawNow(): void {
    if (this.disposed) return
    this.scheduler.cancel()
    if (this.frame(this.env.now())) this.scheduler.request()
  }

  // The viewport measured at the last draw or resize: input never reads layout.
  private inputContext(): InputContext | null {
    if (!this.world || this.disposed) return null
    return { view: this.view, authored: this.authored, viewport: this.viewport, world: this.world, projection: this.space.projection }
  }

  private applyUserView(view: SpaceView): void {
    if (sameView(view, this.view)) return
    this.view = view
    this.options.onViewChange?.(this.getView())
    this.scheduler.request()
  }

  private startInertia(velocity: OrbitVelocity): void {
    this.inertia = velocity
    this.lastInertiaTime = null
    this.scheduler.request()
  }

  private stopInertia(): void {
    this.inertia = null
    this.lastInertiaTime = null
  }

  // One frame: advance inertia, then draw. Returns true to run again.
  private frame(time: number): boolean {
    if (this.disposed) return false
    const playing = this.advanceValues(time)
    let again = false
    if (this.inertia) {
      const dt = this.lastInertiaTime === null ? 1000 / 60 : Math.min(64, Math.max(0, time - this.lastInertiaTime))
      const v = this.inertia
      this.view = {
        ...this.view,
        azimuth: wrapAzimuth(this.view.azimuth + v.azimuth * dt),
        elevation: clampElevation(this.view.elevation + v.elevation * dt),
      }
      this.inertia = inertiaStep(v, dt)
      this.lastInertiaTime = time
      again = this.inertia !== null
      if (!again) this.lastInertiaTime = null
      this.options.onViewChange?.(this.getView())
    }
    this.draw()
    return again || playing
  }

  // CSS size and the backing store (CSS size x min(devicePixelRatio, 2)).
  private measure(): void {
    const width = Math.max(1, this.canvas.clientWidth)
    const height = Math.max(1, this.canvas.clientHeight)
    const ratio = Math.min(MAX_PIXEL_RATIO, Math.max(1, this.env.devicePixelRatio()))
    this.viewport = { width, height }
    this.pixelRatio = ratio
    const backingWidth = Math.round(width * ratio)
    const backingHeight = Math.round(height * ratio)
    if (this.canvas.width !== backingWidth) this.canvas.width = backingWidth
    if (this.canvas.height !== backingHeight) this.canvas.height = backingHeight
  }

  private draw(): void {
    this.measure()
    const world = this.world
    const scene = this.scene
    const axes = this.axes
    if (!world || !scene || !axes) return
    try {
      const camera = cameraMatrices(this.view, world, this.viewport, this.space.projection)
      // The probe, once per frame however many moves came in.
      const hover = this.pendingHover
      this.pendingHover = null
      if (hover && !this.input.active) {
        const hit = this.pickAt(hover.x, hover.y, camera)
        this.setProbe(hit ? { hit, x: hover.x, y: hover.y } : null)
      }
      const frame = buildFrame(this.space.frame, world, camera, axes)
      this.backend.setFrame(frame, this.colors)
      this.syncInteraction(camera, world)
      this.backend.draw(camera, this.pixelRatio)
      this.overlay.update(layoutLabels(frame, scene.labels, camera, world))
      this.syncReadouts(camera, world)
    } catch (error) {
      this.report(error instanceof Error ? error.message : String(error))
    }
  }

  private report(message: string): void {
    if (this.options.onError) this.options.onError(message)
    else console.error(message)
  }
}
