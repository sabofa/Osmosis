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

import type { GraphConfig } from '../parser/config'
import type { Statement } from '../parser/types'
import type { Palette } from '../render/palette'
import { clampElevation, inertiaStep, sanitizeView, wrapAzimuth, type OrbitVelocity } from './camera/controls'
import { cameraMatrices, type Viewport } from './camera/projection'
import { worldMap, type WorldMap } from './camera/world'
import { defaultSpaceConfig, type SpaceConfig, type SpaceView } from './config'
import { boxHalfExtents } from './frame/aspect'
import { resolveBox } from './frame/bounds'
import { buildFrame } from './frame/build'
import { frameAxes } from './frame/ticks'
import type { FrameAxes } from './frame/types'
import { GlBackend } from './gl/backend'
import { NO_WEBGL2_MESSAGE } from './gl/context'
import type { SpaceKernel } from './kernel/api'
import { createSpaceKernel } from './kernel/index'
import type { SceneError, SpaceScene } from './scene/types'
import { spaceColors, type SpaceColors } from './theme'
import { attachInput, InputMachine, type AttachedInput, type InputContext } from './ui/input'
import { layoutLabels } from './ui/layout'
import { Overlay } from './ui/overlay'
import { FrameScheduler, type CancelFrame, type RequestFrame } from './ui/scheduler'

// The part of GraphConfig setScene reads: a GraphConfig is one, and so is a
// bare { space } for hand-built scenes (the review page's fixtures).
export interface SpaceRenderConfig {
  space: SpaceConfig
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

  constructor(canvas: HTMLCanvasElement, options: SpaceRendererOptions, env: SpaceRendererEnv = browserEnv()) {
    this.canvas = canvas
    this.options = options
    this.env = env
    this.colors = spaceColors(options.palette, options.theme)
    this.authored = { ...this.space.camera, target: [0, 0, 0] }
    this.view = { ...this.authored, target: [0, 0, 0] }
    this.overlay = new Overlay(canvas)
    this.overlay.setColors(this.colors)
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
  // the authored camera itself changed.
  setScene(scene: SpaceScene, config: SpaceRenderConfig): void {
    if (this.disposed) return
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
    this.world = world
    this.authored = sanitizeView(authored, authored)
    this.axes = frameAxes(space, box)
    this.backend.setScene(scene, world, this.colors)
    this.scheduler.request()
  }

  // Build the space kernel from a parsed spec (parseSpec's statements, config
  // and statementLines) and draw its scene. Returns the scene's errors, each
  // with its 1-based line; nothing is thrown, and one bad statement never
  // blanks the rest.
  setSpec(statements: Statement[], config: GraphConfig, lines: readonly number[]): SceneError[] {
    if (this.disposed) return []
    let scene: SpaceScene
    try {
      this.kernel = createSpaceKernel(statements, config, lines)
      scene = this.kernel.scene()
    } catch (error) {
      this.kernel = null
      return [{ line: 0, message: `space could not build this spec: ${error instanceof Error ? error.message : String(error)}` }]
    }
    this.setScene(scene, config)
    return scene.errors
  }

  setPalette(palette: Palette, theme: 'light' | 'dark'): void {
    if (this.disposed) return
    this.colors = spaceColors(palette, theme)
    this.backend.setColors(this.colors)
    this.overlay.setColors(this.colors)
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
    this.overlay.dispose()
    this.scene = null
    this.kernel = null
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
    return again
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
      const frame = buildFrame(this.space.frame, world, camera, axes)
      this.backend.setFrame(frame, this.colors)
      this.backend.draw(camera, this.pixelRatio)
      this.overlay.update(layoutLabels(frame, scene.labels, camera, world))
    } catch (error) {
      this.report(error instanceof Error ? error.message : String(error))
    }
  }

  private report(message: string): void {
    if (this.options.onError) this.options.onError(message)
    else console.error(message)
  }
}
