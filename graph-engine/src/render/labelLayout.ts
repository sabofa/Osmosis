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
    const bottom = Math.max(axisPx - m, h)
    let right = W - m
    const box = (): PxBox => ({ x: right - w, y: bottom - h, w, h })
    while (labels.some((l) => overlaps(box(), l)) && right - w - step >= 0) right -= step
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
    const left = axisPx + m
    let top = m
    const box = (): PxBox => ({ x: left, y: top, w, h })
    while ((labels.some((l) => overlaps(box(), l)) || (xBox !== null && overlaps(box(), xBox))) && top + h + step <= H) {
      top += step
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
