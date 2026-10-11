import * as THREE from 'three'
import type { Bounds } from './marchingSquares'
import { anchoredCamera, basePxPerUnit, panByScreen } from '../view2d'
import type { Size } from '../view2d'
import {
  boundsOf,
  frameAxes,
  frameRect,
  plotCameraOf,
  plotToScreen,
  PLOT_LIMITS,
  pxPerUnitXY,
  screenToPlot,
  startView,
  type PlotAspect,
  type PlotView,
  type PlotWindow,
} from '../plot/view/plotView'

// Orthographic pan/zoom camera for the 2D view: a facade over the pure PlotView
// (plot/view/plotView.ts), at the authored aspect (null = equal). The state is the PlotView over a
// fixed @bounds window; the three camera is derived from boundsOf() after every
// move. hover.ts, grid.ts and SceneRenderer keep the method names below.
export class Camera2D {
  readonly camera: THREE.OrthographicCamera
  private win: PlotWindow
  private view: PlotView
  private screen: Size
  private aspectOf: PlotAspect | null
  // Renderer-relative float32: scene content is drawn relative to this plot-space point (the group positions and the
  // camera sit on it, so three's float64 matrices cancel it) and the camera bounds below are relative to it too.
  private originPoint = { x: 0, y: 0 }

  constructor(width: number, height: number, initialBounds?: Bounds, aspect: PlotAspect | null = null) {
    this.screen = { width, height }
    this.aspectOf = aspect
    this.win = this.windowOf(initialBounds)
    this.view = startView(this.win, aspect, this.screen)
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
    this.updateProjection()
  }

  // Without a window, the old default: 12 units tall, the width follows the canvas.
  private windowOf(b?: Bounds): PlotWindow {
    const { width, height } = this.screen
    return b
      ? { uMin: b.xMin, uMax: b.xMax, vMin: b.yMin, vMax: b.yMax }
      : { uMin: (-6 * width) / height, uMax: (6 * width) / height, vMin: -6, vMax: 6 }
  }

  /** A new authored frame (@bounds / @aspect edited): the window and aspect change and the view goes to its start. */
  setFrame(bounds: Bounds | undefined, aspect: PlotAspect | null) {
    this.aspectOf = aspect
    this.win = this.windowOf(bounds)
    this.view = startView(this.win, aspect, this.screen)
    this.updateProjection()
  }

  private updateProjection() {
    const b = boundsOf(this.view, this.win, this.screen)
    const o = this.originPoint
    this.camera.position.set(o.x, o.y, 0)
    this.camera.left = b.uMin - o.x
    this.camera.right = b.uMax - o.x
    this.camera.top = b.vMax - o.y
    this.camera.bottom = b.vMin - o.y
    this.camera.updateProjectionMatrix()
  }

  /** The plot-space point scene content is built relative to; chosen at each scene rebuild. */
  origin(): { x: number; y: number } {
    return this.originPoint
  }

  /** Re-centre the render origin (the camera bounds follow); the caller rebuilds content relative to it. */
  setOrigin(x: number, y: number) {
    this.originPoint = { x, y }
    this.updateProjection()
  }

  // The view state, for the input controller (render/viewController.ts), which moves it by view2d's motion.
  getView(): PlotView {
    return this.view
  }

  setView(view: PlotView) {
    this.view = view
    this.updateProjection()
  }

  frame() {
    return frameRect(this.win, this.view.a, this.view.b)
  }

  plotWindow(): PlotWindow {
    return this.win
  }

  screenSize(): Size {
    return this.screen
  }

  /** The authored aspect; one-axis zoom may change the unit ratio only when it is not equal. */
  aspect(): PlotAspect | null {
    return this.aspectOf
  }

  /** The fitted start view at the authored unit ratio. */
  startView(): PlotView {
    return startView(this.win, this.aspectOf, this.screen)
  }

  private base(screen: Size = this.screen): number {
    return basePxPerUnit(frameRect(this.win, this.view.a, this.view.b), screen)
  }

  // The canvas height stays the same number of world units, as it always has.
  resize(width: number, height: number) {
    const next = { width, height }
    if (this.aspectOf?.kind === 'auto') {
      // Auto: the frame is the screen's own shape, so a, b follow the new size (zoom and centre hold).
      const { a, b } = frameAxes(this.win, this.aspectOf, next)
      this.view = { ...this.view, a, b }
      this.screen = next
      this.updateProjection()
      return
    }
    const keep = this.screen.height > 0 && height > 0 ? height / this.screen.height : 1
    this.view = { ...this.view, zoom: (this.view.zoom * this.base() * keep) / this.base(next) }
    this.screen = next
    this.updateProjection()
  }

  // Pan by a delta in screen pixels.
  panByPixels(dxPx: number, dyPx: number, canvasHeightPx: number) {
    const screen = { width: this.screen.width, height: canvasHeightPx }
    const frame = frameRect(this.win, this.view.a, this.view.b)
    const cam = panByScreen(plotCameraOf(this.view), dxPx, dyPx, frame, screen)
    this.view = { ...this.view, cu: cam.cx / this.view.a, cv: -cam.cy / this.view.b }
    this.updateProjection()
  }

  // Zoom around a screen-space anchor point (keeps the point under the cursor fixed).
  zoomAt(factor: number, anchorXPx: number, anchorYPx: number, canvasWidthPx: number, canvasHeightPx: number) {
    const screen = { width: canvasWidthPx, height: canvasHeightPx }
    const at = { x: anchorXPx, y: anchorYPx }
    const anchor = screenToPlot(this.view, this.win, screen, at)
    const zoom = Math.min(PLOT_LIMITS.zoomMax, Math.max(PLOT_LIMITS.zoomMin, this.view.zoom / factor))
    const frame = frameRect(this.win, this.view.a, this.view.b)
    const cam = anchoredCamera({ x: this.view.a * anchor.x, y: -this.view.b * anchor.y }, at, zoom, frame, screen)
    this.view = { ...this.view, cu: cam.cx / this.view.a, cv: -cam.cy / this.view.b, zoom }
    this.updateProjection()
  }

  screenToWorld(xPx: number, yPx: number, widthPx: number, heightPx: number): { x: number; y: number } {
    return screenToPlot(this.view, this.win, { width: widthPx, height: heightPx }, { x: xPx, y: yPx })
  }

  // Inverse of screenToWorld — used to place HTML overlays (hover tooltip) at
  // a world-space point.
  worldToScreen(x: number, y: number, widthPx: number, heightPx: number): { x: number; y: number } {
    return plotToScreen(this.view, this.win, { width: widthPx, height: heightPx }, { x, y })
  }

  // World units per screen pixel — for converting a pixel hit-radius into a
  // world-space distance for hover hit-testing.
  // Only for a consumer that genuinely needs one number (density); sizes use worldPerPixelXY.
  worldPerPixel(canvasHeightPx: number): number {
    return this.worldPerPixelXY(canvasHeightPx).x
  }

  // World units per screen pixel along each axis; they differ when the plot's x and y px-per-unit do.
  worldPerPixelXY(canvasHeightPx: number): { x: number; y: number } {
    const ppu = pxPerUnitXY(this.view, this.win, { width: this.screen.width, height: canvasHeightPx })
    return { x: 1 / ppu.x, y: 1 / ppu.y }
  }

  getBounds(): Bounds {
    const b = boundsOf(this.view, this.win, this.screen)
    return { xMin: b.uMin, xMax: b.uMax, yMin: b.vMin, yMax: b.vMax }
  }
}
