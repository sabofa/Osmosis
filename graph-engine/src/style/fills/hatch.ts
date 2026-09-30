import { polylineChain, type Chain } from '../path'
import { regionPolygons, scanlines, scanPoint } from './region'
import type { FillInput, FillType } from './types'

// HATCH — parallel lines at `angle`, `spacing` apart, drawn in the current
// line type (so pencil hatching is pencil, ink hatching ink) and clipped to
// the region by the pen.
//
// Built from the region's scanlines: each line of the family is cut to the
// stretches where it is inside the region, so a line never crosses a hole,
// and each stretch is one stroke. The family is anchored to the page (every
// line a whole number of spacings from the origin), so two touching regions
// hatch as one.

export function hatchFamily({ outline, settings }: Pick<FillInput, 'outline' | 'settings'>, angle: number): Chain[] {
  const chains: Chain[] = []
  for (const line of scanlines(regionPolygons(outline), angle, settings.spacing)) {
    for (const [from, to] of line.intervals) chains.push(polylineChain([scanPoint(angle, line.offset, from), scanPoint(angle, line.offset, to)]))
  }
  return chains
}

export const hatch: FillType = {
  draw: (input) => ({ marks: [{ kind: 'lines', chains: hatchFamily(input, input.settings.angle) }] }),
}
