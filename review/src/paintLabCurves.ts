// The point maths behind the curve editors (spec §11; curves.ts is the curve
// itself). Pure: every move, add and remove returns new points, and the
// constraints live here, so the editor's widget only turns pointer events into
// these calls (graph-engine/src/space/paint/lab/curves.test.ts tests them).
//
// A curve is points [x, y] over x in 0..1, sorted by x. The first and last
// points are its endpoints: they move in y only, and are never removed, since
// an endpoint fixes the span and nothing could put it back.

import type { CurvePoints } from '../../graph-engine/src/space/paint/curves'

// The closest two neighbouring points may come in x.
export const MIN_GAP = 0.01

export interface YRange {
  yMin: number
  yMax: number
}

// Four decimals: a drag leaves no float noise in the saved JSON.
const round = (v: number) => Math.round(v * 1e4) / 1e4
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Point `index` moved to (x, y): x kept strictly between its neighbours (an
// endpoint keeps its x), y inside the editor's range. The same array comes
// back for an index that is not there or a pointer that is not a number.
export function movePoint(points: CurvePoints, index: number, x: number, y: number, range: YRange): CurvePoints {
  if (!Number.isInteger(index) || index < 0 || index >= points.length || !Number.isFinite(x) || !Number.isFinite(y)) return points
  const last = points.length - 1
  const nx = index === 0 || index === last ? points[index][0] : clamp(x, points[index - 1][0] + MIN_GAP, points[index + 1][0] - MIN_GAP)
  const next = points.map((p) => [p[0], p[1]] as [number, number])
  next[index] = [round(nx), round(clamp(y, range.yMin, range.yMax))]
  return next
}

// Point `index` moved by (dx, dy), under the same constraints.
export function nudgePoint(points: CurvePoints, index: number, dx: number, dy: number, range: YRange): CurvePoints {
  const p = points[index]
  return p ? movePoint(points, index, p[0] + dx, p[1] + dy, range) : points
}

// A new point at (x, y), in x order, and its index. Refused (index -1, the same
// points) at or beyond the endpoints, and within MIN_GAP of a point already there.
export function addPoint(points: CurvePoints, x: number, y: number, range: YRange): { points: CurvePoints; index: number } {
  const refused = { points, index: -1 }
  if (!Number.isFinite(x) || !Number.isFinite(y) || points.length < 2) return refused
  if (x <= points[0][0] || x >= points[points.length - 1][0]) return refused
  if (points.some((p) => Math.abs(p[0] - x) < MIN_GAP)) return refused
  const index = points.findIndex((p) => p[0] > x)
  const next = points.map((p) => [p[0], p[1]] as [number, number])
  next.splice(index, 0, [round(x), round(clamp(y, range.yMin, range.yMax))])
  return { points: next, index }
}

// An interior point of a curve that keeps at least two points.
export function canRemove(points: CurvePoints, index: number): boolean {
  return points.length > 2 && Number.isInteger(index) && index > 0 && index < points.length - 1
}

export function removePoint(points: CurvePoints, index: number): CurvePoints {
  return canRemove(points, index) ? points.filter((_, i) => i !== index).map((p) => [p[0], p[1]] as [number, number]) : points
}

// The plot rectangle inside an editor's SVG, in SVG units.
export interface PlotBox {
  left: number
  top: number
  width: number
  height: number
}

export const plotX = (box: PlotBox, x: number) => box.left + x * box.width
// y runs up the screen: yMax at the top of the box.
export const plotY = (box: PlotBox, range: YRange, y: number) => box.top + (box.height * (range.yMax - y)) / (range.yMax - range.yMin)
export const curveX = (box: PlotBox, px: number) => (px - box.left) / box.width
export const curveY = (box: PlotBox, range: YRange, py: number) => range.yMax - ((py - box.top) / box.height) * (range.yMax - range.yMin)
