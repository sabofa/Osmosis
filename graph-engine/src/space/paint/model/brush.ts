// Brushwork sized for the view (paint-zoom): how a stroke's size and shape follow the zoom.
//
// Zoomed in, a painter's close-up still covers the form, and it is painted with a bigger brush, not with
// the same small dabs further apart. The strokes of a view are `big` times the size the roles were tuned
// at, where big = (the growth that keeps them overlapping, view.ts zoomGrow) x (the brush that follows
// the zoom, view.ts zoomSizeScale). Past a little growth the brush also reads as a brush: longer for its
// width, tapered at both ends, with more and more varied bristles so the ridges stay visible along it.
// At big = 1 (the framing the roles were tuned at) nothing here changes a stroke.

import { MAX_BRISTLES, PATH_POINTS, type ParticleSet } from '../types'
import { clamp, lerp, smooth } from './math'
import { cellId } from './particles'
import { pressure } from './strokes'

// How far a stroke is "close-up": 0 at the tuned size, 1 from about twice that on. The strokes change
// shape over this range, so there is no step between the framings.
export function closeUp(big: number): number {
  return smooth(1.15, 2.2, big)
}

// A close-up stroke is up to this much longer for its width.
const LENGTHEN = 0.9
// ... and its bristles up to this much more varied in load (so the ridges along it stand out).
const RIDGES = 0.45

export const sizedLength = (length: number, big: number): number => length * big * (1 + LENGTHEN * closeUp(big))
export const sizedWidth = (width: number, big: number): number => width * big

// A bigger brush has more bristles, but not in proportion: the ridges between them get coarser, which
// is what shows at a close look (the bristle count of a stroke at the tuned size is the role's own).
export function sizedBristles(bristles: number, big: number): number {
  return clamp(Math.round(bristles * big ** 0.75), 1, MAX_BRISTLES)
}

export const sizedVariance = (variance: number, big: number): number => clamp(variance * (1 + RIDGES * closeUp(big)), 0, 1)

// The width of a brush stroke along its length, at each path point, as a fraction of its width at the
// tuned size: a loaded start, a belly just ahead of the middle, a long taper to a point-ish end. (The
// stroke at the tuned size has pressure() instead: a full-width start and a taper over the last 30%.)
export function closeUpPressure(t: number): number {
  return (0.78 + 0.22 * smooth(0, 0.2, t)) * (1 - 0.7 * smooth(0.48, 1, t)) * (1 + 0.1 * Math.exp(-(((t - 0.3) / 0.2) ** 2)))
}

// The factor from pressure() to closeUpPressure() at each of the PATH_POINTS points.
const RATIO = Array.from({ length: PATH_POINTS }, (_, q) => {
  const t = q / (PATH_POINTS - 1)
  return closeUpPressure(t) / pressure(t)
})

// Reshape the widths of a stroke made at the tuned pressure toward the close-up profile by `big`.
export function reshapeWidths(width: Float32Array, big: number): void {
  const shape = closeUp(big)
  if (shape <= 0) return
  for (let q = 0; q < PATH_POINTS; q++) width[q] = Math.max(0.35, width[q] * lerp(1, RATIO[q], shape))
}

// ---- brush loads at the zoom ----

// (The level itself, loadCellLevel, is in view.ts: it is part of the frame's context.)

// The surface cell of particle i at a cell level: its own (ParticleSet.cell, made at mix.loadCell) at level 0.
export function loadCellOf(set: ParticleSet, i: number, loadCell: number, level: number): number {
  if (level <= 0) return set.cell[i]
  const c = Math.max(1e-6, loadCell) / 2 ** level
  return cellId(Math.floor(set.position[3 * i] / c), Math.floor(set.position[3 * i + 1] / c), Math.floor(set.position[3 * i + 2] / c))
}
