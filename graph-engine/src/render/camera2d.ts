import * as THREE from 'three'
import type { Bounds } from './marchingSquares'

// Orthographic pan/zoom camera for the 2D view. Tracks world-space center +
// visible height; width follows from the canvas aspect ratio. Kept separate
// from SceneRenderer so a phase-2 3D orbit camera can sit alongside it without
// touching this file.
export class Camera2D {
  readonly camera: THREE.OrthographicCamera
  private centerX = 0
  private centerY = 0
  private viewHeight = 12
  private aspect: number

  constructor(width: number, height: number, initialBounds?: Bounds) {
    this.aspect = width / height
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
    if (initialBounds) {
      this.centerX = (initialBounds.xMin + initialBounds.xMax) / 2
      this.centerY = (initialBounds.yMin + initialBounds.yMax) / 2
      // Fit the requested window inside the view regardless of aspect ratio.
      this.viewHeight = Math.max(initialBounds.yMax - initialBounds.yMin, (initialBounds.xMax - initialBounds.xMin) / this.aspect)
    }
    this.updateProjection()
  }

  private updateProjection() {
    const viewWidth = this.viewHeight * this.aspect
    this.camera.left = this.centerX - viewWidth / 2
    this.camera.right = this.centerX + viewWidth / 2
    this.camera.top = this.centerY + this.viewHeight / 2
    this.camera.bottom = this.centerY - this.viewHeight / 2
    this.camera.updateProjectionMatrix()
  }

  resize(width: number, height: number) {
    this.aspect = width / height
    this.updateProjection()
  }

  // Pan by a delta in screen pixels.
  panByPixels(dxPx: number, dyPx: number, canvasHeightPx: number) {
    const worldPerPixel = this.viewHeight / canvasHeightPx
    this.centerX -= dxPx * worldPerPixel
    this.centerY += dyPx * worldPerPixel
    this.updateProjection()
  }

  // Zoom around a screen-space anchor point (keeps the point under the cursor fixed).
  zoomAt(factor: number, anchorXPx: number, anchorYPx: number, canvasWidthPx: number, canvasHeightPx: number) {
    const before = this.screenToWorld(anchorXPx, anchorYPx, canvasWidthPx, canvasHeightPx)
    this.viewHeight *= factor
    this.viewHeight = Math.min(Math.max(this.viewHeight, 1e-3), 1e6)
    this.updateProjection()
    const after = this.screenToWorld(anchorXPx, anchorYPx, canvasWidthPx, canvasHeightPx)
    this.centerX += before.x - after.x
    this.centerY += before.y - after.y
    this.updateProjection()
  }

  screenToWorld(xPx: number, yPx: number, widthPx: number, heightPx: number): { x: number; y: number } {
    const nx = xPx / widthPx // 0..1 left->right
    const ny = yPx / heightPx // 0..1 top->bottom
    return {
      x: this.camera.left + nx * (this.camera.right - this.camera.left),
      y: this.camera.top - ny * (this.camera.top - this.camera.bottom),
    }
  }

  // Inverse of screenToWorld — used to place HTML overlays (hover tooltip) at
  // a world-space point.
  worldToScreen(x: number, y: number, widthPx: number, heightPx: number): { x: number; y: number } {
    const nx = (x - this.camera.left) / (this.camera.right - this.camera.left)
    const ny = (this.camera.top - y) / (this.camera.top - this.camera.bottom)
    return { x: nx * widthPx, y: ny * heightPx }
  }

  // World units per screen pixel — for converting a pixel hit-radius into a
  // world-space distance for hover hit-testing.
  worldPerPixel(canvasHeightPx: number): number {
    return this.viewHeight / canvasHeightPx
  }

  getBounds(): Bounds {
    return { xMin: this.camera.left, xMax: this.camera.right, yMin: this.camera.bottom, yMax: this.camera.top }
  }
}
