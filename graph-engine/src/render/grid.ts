import * as THREE from 'three'
import type { GraphConfig } from '../parser/config'
import type { Bounds } from './marchingSquares'
import { AxisLabelPool } from './axisLabelPool'
import { formatCoord } from '../scene/format'

function hexToCss(color: number): string {
  return '#' + color.toString(16).padStart(6, '0')
}

export interface GridPalette {
  axis: number
  grid: number
  gridStrong: number
}

// "Nice" grid step (1/2/5 * 10^n) for a given target pixel spacing.
// residual always lands in [1, 10) here. The default even 1-2-5 split
// (thresholds at 2 and 5, so widths 1/3/5) makes '5' the step that survives
// the widest zoom range and '1' the one that changes soonest — backwards
// from what's wanted when '1' is the step actually being read most: it
// should be the one that persists longest before ticking over, '2' the
// next-longest, '5' comparatively brief. Thresholds at 5 and 8 give widths
// 4/3/2 — skewed toward 1 without 5 disappearing entirely.
function niceStep(worldSpan: number, targetDivisions: number): number {
  const rough = worldSpan / targetDivisions
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)))
  const residual = rough / magnitude
  const step = residual >= 8 ? 5 : residual >= 5 ? 2 : 1
  return step * magnitude
}

function updateGeometryAttribute(geometry: THREE.BufferGeometry, name: string, data: number[], itemSize: number) {
  const attr = geometry.getAttribute(name) as THREE.BufferAttribute | undefined
  if (!attr || attr.array.length < data.length) {
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(data, itemSize))
  } else {
    ;(attr.array as Float32Array).set(data)
    attr.needsUpdate = true
  }
  if (name === 'position') {
    geometry.setDrawRange(0, data.length / itemSize)
    geometry.computeBoundingSphere()
  }
}

function updateGeometryPositions(geometry: THREE.BufferGeometry, positions: number[]) {
  updateGeometryAttribute(geometry, 'position', positions, 3)
}

// Owns the axis/grid line meshes and redraws them against the current camera
// bounds. Split out of SceneRenderer since grid drawing is synchronous and
// cheap (unlike the rest of a scene rebuild — see geometryGroup.ts) and has
// no dependency on anything else the renderer owns.
//
// Two-tier "ruled paper" grid — a subtle minor line every step, a stronger
// major line every 5th step — rather than one uniform grid, so the spacing
// reads at a glance without counting lines.
export class GridRenderer {
  readonly group = new THREE.Group()
  private gridLines: THREE.LineSegments
  private gridLinesMajor: THREE.LineSegments
  private axisLines: THREE.LineSegments
  private xLabels: AxisLabelPool
  private yLabels: AxisLabelPool

  constructor(palette: GridPalette) {
    this.gridLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: palette.grid }))
    this.gridLinesMajor = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: palette.gridStrong }))
    this.axisLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: palette.axis }))
    this.xLabels = new AxisLabelPool(hexToCss(palette.axis))
    this.yLabels = new AxisLabelPool(hexToCss(palette.axis))
    this.group.add(this.gridLines, this.gridLinesMajor, this.axisLines, this.xLabels.group, this.yLabels.group)
  }

  setPalette(palette: GridPalette) {
    ;(this.gridLines.material as THREE.LineBasicMaterial).color.setHex(palette.grid)
    ;(this.gridLinesMajor.material as THREE.LineBasicMaterial).color.setHex(palette.gridStrong)
    ;(this.axisLines.material as THREE.LineBasicMaterial).color.setHex(palette.axis)
    this.xLabels.setColor(hexToCss(palette.axis))
    this.yLabels.setColor(hexToCss(palette.axis))
  }

  // pixelToWorld converts a fixed on-screen pixel size to world units at the
  // current zoom — same convention SceneRenderer uses for point/marker sizes
  // — so tick labels stay a constant, readable pixel size instead of
  // shrinking/growing with the plotted geometry as you zoom.
  draw(bounds: Bounds, config: GraphConfig, pixelToWorld: (px: number) => number) {
    if (config.grid) {
      const stepX = config.xstep ?? niceStep(bounds.xMax - bounds.xMin, 6)
      const stepY = config.ystep ?? niceStep(bounds.yMax - bounds.yMin, 6)

      const positions: number[] = []
      const startX = Math.ceil(bounds.xMin / stepX) * stepX
      for (let x = startX; x <= bounds.xMax; x += stepX) {
        positions.push(x, bounds.yMin, 0, x, bounds.yMax, 0)
      }
      const startY = Math.ceil(bounds.yMin / stepY) * stepY
      for (let y = startY; y <= bounds.yMax; y += stepY) {
        positions.push(bounds.xMin, y, 0, bounds.xMax, y, 0)
      }
      updateGeometryPositions(this.gridLines.geometry, positions)
      this.gridLines.visible = positions.length > 0

      const majorStepX = stepX * 5
      const majorStepY = stepY * 5
      const majorPositions: number[] = []
      const majorStartX = Math.ceil(bounds.xMin / majorStepX) * majorStepX
      for (let x = majorStartX; x <= bounds.xMax; x += majorStepX) {
        majorPositions.push(x, bounds.yMin, 0, x, bounds.yMax, 0)
      }
      const majorStartY = Math.ceil(bounds.yMin / majorStepY) * majorStepY
      for (let y = majorStartY; y <= bounds.yMax; y += majorStepY) {
        majorPositions.push(bounds.xMin, y, 0, bounds.xMax, y, 0)
      }
      updateGeometryPositions(this.gridLinesMajor.geometry, majorPositions)
      this.gridLinesMajor.visible = majorPositions.length > 0

      // Tick labels ride the same "nice" minor step as the grid lines
      // themselves (1/2/5 × 10^n) — matches the progression as you zoom
      // (…1, 2, 5, 10, 20, 50, 100…) rather than the ×5 major-gridline
      // spacing, which would read as a coarser sequence than the visible
      // minor lines. Only drawn when axes are on, since labels are placed
      // relative to the x=0/y=0 lines.
      if (config.axes) {
        const labelOffsetX = pixelToWorld(14)
        const labelOffsetY = pixelToWorld(14)
        const showXLabels = bounds.yMin <= 0 && 0 <= bounds.yMax
        const showYLabels = bounds.xMin <= 0 && 0 <= bounds.xMax
        const labelScaleX = pixelToWorld(34)
        const labelScaleY = pixelToWorld(16)

        let xIndex = 0
        if (showXLabels) {
          for (let x = startX; x <= bounds.xMax; x += stepX) {
            if (Math.abs(x) < stepX / 1e6) continue // "0" comes from the y-axis pass below
            this.xLabels.place(xIndex++, formatCoord(x), x, -labelOffsetY, labelScaleX, labelScaleY)
          }
        }
        this.xLabels.hideFrom(xIndex)

        let yIndex = 0
        if (showYLabels) {
          for (let y = startY; y <= bounds.yMax; y += stepY) {
            const text = Math.abs(y) < stepY / 1e6 ? '0' : formatCoord(y)
            this.yLabels.place(yIndex++, text, -labelOffsetX, y, labelScaleX, labelScaleY)
          }
        }
        this.yLabels.hideFrom(yIndex)
      } else {
        this.xLabels.hideFrom(0)
        this.yLabels.hideFrom(0)
      }
    } else {
      this.gridLines.visible = false
      this.gridLinesMajor.visible = false
      this.xLabels.hideFrom(0)
      this.yLabels.hideFrom(0)
    }

    if (config.axes) {
      const axisPositions = [bounds.xMin, 0, 0, bounds.xMax, 0, 0, 0, bounds.yMin, 0, 0, bounds.yMax, 0]
      updateGeometryPositions(this.axisLines.geometry, axisPositions)
      this.axisLines.visible = true
    } else {
      this.axisLines.visible = false
    }
  }

  dispose() {
    this.gridLines.geometry.dispose()
    ;(this.gridLines.material as THREE.Material).dispose()
    this.gridLinesMajor.geometry.dispose()
    ;(this.gridLinesMajor.material as THREE.Material).dispose()
    this.axisLines.geometry.dispose()
    ;(this.axisLines.material as THREE.Material).dispose()
    this.xLabels.dispose()
    this.yLabels.dispose()
  }
}
