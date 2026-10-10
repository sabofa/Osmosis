import * as THREE from 'three'
import type { GraphConfig, StepMode } from '../parser/config'
import type { Bounds } from './marchingSquares'
import { AxisLabelPool } from './axisLabelPool'
import { frameTicks, labelAnchors, type Tick } from '../plot/frame/ticks'
import { scaleOf, type Scale } from '../plot/frame/scale'
import { labelBoxesPx, titleLayout, type TitlePlacement } from './labelLayout'
import { TITLE } from '../plot/frame/tuning'

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
export function niceStep(worldSpan: number, targetDivisions: number): number {
  const rough = worldSpan / targetDivisions
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)))
  const residual = rough / magnitude
  const step = residual >= 8 ? 5 : residual >= 5 ? 2 : 1
  return step * magnitude
}

// How many gridlines a view may hold before "fixed" gives up and falls back to
// a nice step. Well past unreadable — this exists only to stop a pathological
// spec from asking for tens of thousands of lines, not to second-guess an
// author who wants a dense grid.
const FIXED_MAX_DIVISIONS = 1000

// The author's step doubles as the view zooms out (base -> 2*base -> 4*base
// -> ...) so every step on the ladder stays a whole multiple of the base:
// 8 -> 16 -> 32 -> 64 -> 128, not 8 -> 64 -> 512. That is the difference from
// `nice`, which would replace an author's 8 with a 10.
//
// Zooming in, the base is a FLOOR, never subdivided. This mode exists so an
// author can withhold coordinates: @xstep: 8 means 8 is the finest grid that
// will ever be drawn, no matter how far in the learner zooms. A grid that
// subdivided back toward single units would hand the learner the exact
// values the question was designed to hide. The floor is the feature, not a
// gap to close.
function geometricStep(base: number, worldSpan: number, targetDivisions: number): number {
  const ideal = worldSpan / targetDivisions
  // Nearest whole doubling of `base` to the ideal spacing, found in log2
  // space so "nearest" means nearest multiplicative step. Clamped at 0 so the
  // step never drops below the base itself.
  const exponent = Math.max(0, Math.round(Math.log2(ideal / base)))
  return base * Math.pow(2, exponent)
}

// An author's fixed @xstep/@ystep is the step at the zoom the spec was
// written for, not a promise to draw a line every 0.25 units at any zoom.
// What happens outside that band depends on @step-mode.
const MIN_DIVISIONS = 3
const MAX_DIVISIONS = 14
export function resolveStep(
  fixed: number | null,
  worldSpan: number,
  targetDivisions: number,
  mode: StepMode = 'nice'
): number {
  if (fixed === null || !(fixed > 0) || !(worldSpan > 0)) return niceStep(worldSpan, targetDivisions)

  if (mode === 'fixed') {
    return worldSpan / fixed <= FIXED_MAX_DIVISIONS ? fixed : niceStep(worldSpan, targetDivisions)
  }

  if (mode === 'geometric') {
    // A base of 1 has no geometric progression to walk (1^k is always 1), so
    // there is nothing this mode can do that `nice` does not do better.
    if (fixed === 1) return niceStep(worldSpan, targetDivisions)
    return geometricStep(fixed, worldSpan, targetDivisions)
  }

  const divisions = worldSpan / fixed
  if (divisions >= MIN_DIVISIONS && divisions <= MAX_DIVISIONS) return fixed
  return niceStep(worldSpan, targetDivisions)
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

// The major gridline interval grid.ts draws (see draw()'s majorStepX) — reused
// so "@labels: coarse" means exactly "the lines that are already drawn
// stronger", rather than a second, unrelated notion of coarse.
const MAJOR_EVERY = 5

// Whether the nth gridline (counting from the first one drawn in the current
// view) gets a tick label. Pure, so the rule is testable without standing up a
// three.js scene.
export function shouldLabel(index: number, config: GraphConfig): boolean {
  if (config.labels === 'none') return false
  const every = config.labelEvery > 1 ? config.labelEvery : config.labels === 'coarse' ? MAJOR_EVERY : 1
  return index % every === 0
}

export interface GridLabel {
  value: number // world value of the tick
  label: string
  kind: 'major' | 'minor'
  at: { x: number; y: number } // where the label is drawn, in the plane the camera views
}

export interface GridPlan {
  // Line positions in the plane the camera views (transformed coordinates on a log axis).
  faintX: number[]
  faintY: number[]
  strongX: number[]
  strongY: number[]
  labelsX: GridLabel[]
  labelsY: GridLabel[]
  titles: TitlePlacement[]
}

interface AxisLines {
  faint: number[]
  strong: number[]
}

// Linear axis: every tick is a faint line, every 5th step a strong one (the old
// "ruled paper" walk, kept verbatim so linear output does not move).
function linearLines(min: number, max: number, step: number, ticks: Tick[]): AxisLines {
  const faint = ticks.map((t) => t.value)
  const strong: number[] = []
  const majorStep = step * MAJOR_EVERY
  const start = Math.ceil(min / majorStep) * majorStep
  for (let v = start; v <= max; v += majorStep) strong.push(v)
  return { faint, strong }
}

// Pi axis: the same every-5th-step rule, counted in steps from zero.
function piLines(ticks: Tick[]): AxisLines {
  const faint = ticks.map((t) => t.value)
  if (ticks.length < 2) return { faint, strong: [] }
  const step = ticks[1].value - ticks[0].value
  const strong = ticks.filter((t) => Math.abs(Math.round(t.value / step) % MAJOR_EVERY) === 0).map((t) => t.value)
  return { faint, strong }
}

function axisLines(
  axis: 'x' | 'y',
  bounds: Bounds,
  config: GraphConfig,
  ticks: Tick[],
  scale: Scale,
): AxisLines {
  if (ticks.length === 0) return { faint: [], strong: [] }
  if (scale.kind === 'log') {
    return {
      faint: ticks.filter((t) => t.kind === 'minor').map((t) => scale.forward(t.value)),
      strong: ticks.filter((t) => t.kind === 'major').map((t) => scale.forward(t.value)),
    }
  }
  if (config.space.ticks[axis]?.pi) return piLines(ticks)
  const min = axis === 'x' ? bounds.xMin : bounds.yMin
  const max = axis === 'x' ? bounds.xMax : bounds.yMax
  const step = resolveStep(axis === 'x' ? config.xstep : config.ystep, max - min, 6, config.stepMode)
  return linearLines(min, max, step, ticks)
}

// Everything the grid draws, as data: line positions and positioned labels.
// `bounds` are the camera's (the plane being viewed); on a log axis that plane is
// (log10 x, log10 y), so ticks are computed on the world values and drawn at
// scale.forward(value). `margins` inset pinned labels (plane units); `offset` is
// how far below / left of its axis an on-axis label sits.
export function gridPlan(
  bounds: Bounds,
  config: GraphConfig,
  size: { widthPx: number; heightPx: number },
  margins: { x: number; y: number },
  offset: { x: number; y: number },
): GridPlan {
  const sx = scaleOf(config.scales.x)
  const sy = scaleOf(config.scales.y)
  const world: Bounds = {
    xMin: sx.inverse(bounds.xMin),
    xMax: sx.inverse(bounds.xMax),
    yMin: sy.inverse(bounds.yMin),
    yMax: sy.inverse(bounds.yMax),
  }
  const ticks = frameTicks({ bounds: world, ...size }, config)
  const lx = axisLines('x', bounds, config, ticks.x, sx)
  const ly = axisLines('y', bounds, config, ticks.y, sy)

  const labelsX: GridLabel[] = []
  const labelsY: GridLabel[] = []
  if (config.axes && config.labels !== 'none') {
    const anchors = labelAnchors(ticks, { bounds, ...size }, margins, config.scales)
    for (const a of anchors.x) {
      if (a.label === '') continue
      const onAxis = sy.kind === 'linear' && a.at.y === 0
      if (onAxis && a.label === '0') continue // "0" comes from the y-axis pass
      labelsX.push({ ...a, at: { x: sx.forward(a.at.x), y: onAxis ? a.at.y - offset.y : a.at.y } })
    }
    for (const a of anchors.y) {
      if (a.label === '') continue
      const onAxis = sx.kind === 'linear' && a.at.x === 0
      labelsY.push({ ...a, at: { x: onAxis ? a.at.x - offset.x : a.at.x, y: sy.forward(a.at.y) } })
    }
  }
  const titles = config.axes
    ? titleLayout({
        bounds,
        widthPx: size.widthPx,
        heightPx: size.heightPx,
        titles: config.space.titles,
        labelBoxesPx: labelBoxesPx([...labelsX, ...labelsY], bounds, size.widthPx, size.heightPx),
      })
    : []
  return { faintX: lx.faint, faintY: ly.faint, strongX: lx.strong, strongY: ly.strong, labelsX, labelsY, titles }
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
  private titleLabels: AxisLabelPool

  constructor(palette: GridPalette) {
    this.gridLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: palette.grid }))
    this.gridLinesMajor = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: palette.gridStrong }))
    this.axisLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: palette.axis }))
    this.xLabels = new AxisLabelPool(hexToCss(palette.axis))
    this.yLabels = new AxisLabelPool(hexToCss(palette.axis))
    this.titleLabels = new AxisLabelPool(hexToCss(palette.axis), true)
    this.group.add(this.gridLines, this.gridLinesMajor, this.axisLines, this.xLabels.group, this.yLabels.group, this.titleLabels.group)
  }

  setPalette(palette: GridPalette) {
    ;(this.gridLines.material as THREE.LineBasicMaterial).color.setHex(palette.grid)
    ;(this.gridLinesMajor.material as THREE.LineBasicMaterial).color.setHex(palette.gridStrong)
    ;(this.axisLines.material as THREE.LineBasicMaterial).color.setHex(palette.axis)
    this.xLabels.setColor(hexToCss(palette.axis))
    this.yLabels.setColor(hexToCss(palette.axis))
    this.titleLabels.setColor(hexToCss(palette.axis))
  }

  // pixelToWorld converts a fixed on-screen pixel size to world units at the
  // current zoom — same convention SceneRenderer uses for point/marker sizes
  // — so tick labels stay a constant, readable pixel size instead of
  // shrinking/growing with the plotted geometry as you zoom.
  // `sizePx` is the canvas size; without it the pixel size is inferred from
  // pixelToWorld(1) (density only, so an approximation is harmless).
  draw(
    bounds: Bounds,
    config: GraphConfig,
    pixelToWorld: (px: number) => number,
    sizePx?: { widthPx: number; heightPx: number },
  ) {
    if (config.grid) {
      const perPx = pixelToWorld(1)
      const size = sizePx ?? {
        widthPx: (bounds.xMax - bounds.xMin) / perPx,
        heightPx: (bounds.yMax - bounds.yMin) / perPx,
      }
      const plan = gridPlan(
        bounds,
        config,
        size,
        { x: pixelToWorld(20), y: pixelToWorld(14) },
        { x: pixelToWorld(14), y: pixelToWorld(14) },
      )

      const positions: number[] = []
      for (const x of plan.faintX) positions.push(x, bounds.yMin, 0, x, bounds.yMax, 0)
      for (const y of plan.faintY) positions.push(bounds.xMin, y, 0, bounds.xMax, y, 0)
      updateGeometryPositions(this.gridLines.geometry, positions)
      this.gridLines.visible = positions.length > 0

      const majorPositions: number[] = []
      for (const x of plan.strongX) majorPositions.push(x, bounds.yMin, 0, x, bounds.yMax, 0)
      for (const y of plan.strongY) majorPositions.push(bounds.xMin, y, 0, bounds.xMax, y, 0)
      updateGeometryPositions(this.gridLinesMajor.geometry, majorPositions)
      this.gridLinesMajor.visible = majorPositions.length > 0

      // Tick labels (text, thinning and position) come from gridPlan: they ride
      // the same ticks as the grid lines, sit by the x=0/y=0 axes when those are
      // in view and pin to the nearest edge when not. Only drawn when axes are on.
      if (config.axes && config.labels !== 'none') {
        const labelScaleX = pixelToWorld(34)
        const labelScaleY = pixelToWorld(16)
        let xIndex = 0
        for (const l of plan.labelsX) this.xLabels.place(xIndex++, l.label, l.at.x, l.at.y, labelScaleX, labelScaleY)
        this.xLabels.hideFrom(xIndex)
        let yIndex = 0
        for (const l of plan.labelsY) this.yLabels.place(yIndex++, l.label, l.at.x, l.at.y, labelScaleX, labelScaleY)
        this.yLabels.hideFrom(yIndex)
      } else {
        this.xLabels.hideFrom(0)
        this.yLabels.hideFrom(0)
      }

      // Axis titles (@titles) are placed by gridPlan; this only draws them.
      let titleIndex = 0
      for (const t of plan.titles) {
        this.titleLabels.placeAnchored(titleIndex++, t.text, t.at.x, t.at.y, pixelToWorld(TITLE.heightPx), t.align, t.baseline)
      }
      this.titleLabels.hideFrom(titleIndex)
    } else {
      this.gridLines.visible = false
      this.gridLinesMajor.visible = false
      this.xLabels.hideFrom(0)
      this.yLabels.hideFrom(0)
      this.titleLabels.hideFrom(0)
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
    this.titleLabels.dispose()
  }
}
