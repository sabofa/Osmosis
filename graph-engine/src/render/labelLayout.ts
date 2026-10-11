import type { Vec2 } from '../scene/types'
import { TITLE } from '../plot/frame/tuning'

export interface LabelPlacement {
  position: Vec2
  width: number
  height: number
}

// A label's position AND its own on-screen size are both derived from a
// fixed *pixel* target (see SceneRenderer.ts's pixelToWorld) — "raw" here
// means "that fixed-pixel target already converted to world units at the
// current zoom," which grows without bound as you zoom out. `maxOffset`
// (world units, or null/undefined for "no cap") is the furthest the label
// is allowed to sit from its anchor point.
//
// The first version of this fix only capped the *offset* — the label
// stopped moving further away once the cap engaged, but kept rendering at
// its full fixed pixel width/height regardless, so a label sitting right
// next to a vertex that had shrunk to a few screen pixels was *still* many
// times bigger than the thing it was labeling. That still reads as "not
// attached to its point," just from a different cause. Shrinking width and
// height by the exact same ratio the offset itself gets clamped by is what
// actually keeps a label looking attached: it shrinks down *with* whatever
// it's labeling instead of independently staying oversized.
export function clampedLabelPlacement(
  worldPos: Vec2,
  direction: Vec2,
  rawOffset: number,
  rawWidth: number,
  rawHeight: number,
  maxOffset: number | null | undefined
): LabelPlacement {
  const clampRatio = maxOffset != null && rawOffset > 0 ? Math.min(1, maxOffset / rawOffset) : 1
  const offset = rawOffset * clampRatio
  return {
    position: { x: worldPos.x + direction.x * offset, y: worldPos.y + direction.y * offset },
    width: rawWidth * clampRatio,
    height: rawHeight * clampRatio,
  }
}

// The same clamp for an anisotropic view: the fixed-pixel offset is a world vector (direction scaled per axis
// by world-per-pixel), and the box is its own width/height in world units along x and y.
export function clampedLabelPlacementXY(
  worldPos: Vec2,
  direction: Vec2,
  offsetWorld: Vec2,
  rawWidth: number,
  rawHeight: number,
  maxOffset: number | null | undefined
): LabelPlacement {
  const dx = direction.x * offsetWorld.x
  const dy = direction.y * offsetWorld.y
  const rawOffset = Math.hypot(dx, dy)
  const clampRatio = maxOffset != null && rawOffset > 0 ? Math.min(1, maxOffset / rawOffset) : 1
  return {
    position: { x: worldPos.x + dx * clampRatio, y: worldPos.y + dy * clampRatio },
    width: rawWidth * clampRatio,
    height: rawHeight * clampRatio,
  }
}

export interface PxBox {
  x: number
  y: number
  w: number
  h: number
}

export interface TitlePlacement {
  axis: 'x' | 'y'
  text: string
  /** World position (view plane) of the anchor point. */
  at: { x: number; y: number }
  align: 'start' | 'end'
  baseline: 'top' | 'bottom' | 'middle'
  rotate: boolean
}

interface TitleBounds {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const overlaps = (a: PxBox, b: PxBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Estimated pixel boxes (from the view's top-left) of labels centred on their plane anchors. */
export function labelBoxesPx(
  labels: { label: string; at: { x: number; y: number } }[],
  bounds: TitleBounds,
  widthPx: number,
  heightPx: number,
): PxBox[] {
  const spanX = bounds.xMax - bounds.xMin || 1
  const spanY = bounds.yMax - bounds.yMin || 1
  return labels.map((l) => {
    const w = l.label.length * TITLE.charPx
    const cx = ((l.at.x - bounds.xMin) / spanX) * widthPx
    const cy = ((bounds.yMax - l.at.y) / spanY) * heightPx
    return { x: cx - w / 2, y: cy - TITLE.heightPx / 2, w, h: TITLE.heightPx }
  })
}

/**
 * Shift label centres inward so every estimated label box (same width as labelBoxesPx) lies inside the view.
 * A label wider than the view is centred. Positions are (u,v) plane coordinates; returns new objects.
 */
export function keepLabelsInside<T extends { label: string; at: { x: number; y: number } }>(
  labels: readonly T[],
  bounds: TitleBounds,
  widthPx: number,
  heightPx: number,
): T[] {
  const spanX = bounds.xMax - bounds.xMin
  const spanY = bounds.yMax - bounds.yMin
  if (!(spanX > 0 && spanY > 0 && widthPx > 0 && heightPx > 0) || !Number.isFinite(spanX + spanY)) return labels.slice()
  const perX = spanX / widthPx
  const perY = spanY / heightPx
  return labels.map((l) => {
    const halfW = (l.label.length * TITLE.charPx) / 2
    const halfH = TITLE.heightPx / 2
    const cx = halfW * 2 >= widthPx ? widthPx / 2 : clamp((l.at.x - bounds.xMin) / perX, halfW, widthPx - halfW)
    const cy = halfH * 2 >= heightPx ? heightPx / 2 : clamp((bounds.yMax - l.at.y) / perY, halfH, heightPx - halfH)
    return { ...l, at: { x: bounds.xMin + cx * perX, y: bounds.yMax - cy * perY } }
  })
}

// Textbook axis titles: x at the right end of the x axis, just above its line
// (above the bottom edge when the axis is off-screen); y at the top end of the
// y axis, just right of its line (inside the left edge when off-screen). A title
// that lands on a tick label slides along its own axis until clear or the view
// runs out: x leftwards, y downwards, in half-title-height steps.
export function titleLayout(opts: {
  bounds: TitleBounds
  widthPx: number
  heightPx: number
  titles: { x: string; y: string }
  labelBoxesPx: PxBox[]
}): TitlePlacement[] {
  const { bounds, widthPx: W, heightPx: H, titles, labelBoxesPx: labels } = opts
  // A view with no extent (zero or non-finite spans or size) has nowhere to put a title.
  const ok = (v: number) => Number.isFinite(v) && v > 0
  if (!ok(bounds.xMax - bounds.xMin) || !ok(bounds.yMax - bounds.yMin) || !ok(W) || !ok(H)) return []
  const perX = (bounds.xMax - bounds.xMin) / W
  const perY = (bounds.yMax - bounds.yMin) / H
  const m = TITLE.marginPx
  const h = TITLE.heightPx
  const step = h / 2
  const out: TitlePlacement[] = []
  let xBox: PxBox | null = null

  if (titles.x !== '') {
    const w = titles.x.length * TITLE.charPx
    const axisPx = ((bounds.yMax - clamp(0, bounds.yMin, bounds.yMax)) / (bounds.yMax - bounds.yMin)) * H
    let bottom = Math.max(axisPx - m, h)
    let right = W - m
    const box = (): PxBox => ({ x: right - w, y: bottom - h, w, h })
    while (labels.some((l) => overlaps(box(), l)) && right - w - step >= 0) right -= step
    if (labels.some((l) => overlaps(box(), l))) {
      // No clear spot along the row: back to the right end and climb past the labels.
      right = W - m
      while (labels.some((l) => overlaps(box(), l)) && bottom - step >= h) bottom -= step
    }
    xBox = box()
    out.push({
      axis: 'x',
      text: titles.x,
      at: { x: bounds.xMin + right * perX, y: bounds.yMax - bottom * perY },
      align: 'end',
      baseline: 'bottom',
      rotate: false,
    })
  }

  if (titles.y !== '') {
    const w = titles.y.length * TITLE.charPx
    const axisPx = ((clamp(0, bounds.xMin, bounds.xMax) - bounds.xMin) / (bounds.xMax - bounds.xMin)) * W
    let left = axisPx + m
    let top = m
    const box = (): PxBox => ({ x: left, y: top, w, h })
    while ((labels.some((l) => overlaps(box(), l)) || (xBox !== null && overlaps(box(), xBox))) && top + h + step <= H) {
      top += step
    }
    const blocked = () => labels.some((l) => overlaps(box(), l)) || (xBox !== null && overlaps(box(), xBox))
    if (blocked()) {
      // No clear spot down the column: back to the top and move right past the labels.
      top = m
      while (blocked() && left + step + w <= W) left += step
    }
    out.push({
      axis: 'y',
      text: titles.y,
      at: { x: bounds.xMin + left * perX, y: bounds.yMax - top * perY },
      align: 'start',
      baseline: 'top',
      rotate: false,
    })
  }
  return out
}
