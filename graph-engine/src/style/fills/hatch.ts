import { polylineChain, type Chain } from '../path'
import { MARK_BUDGET, regionPolygons, scanlines, scanPoint, spacingWithin } from './region'
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

//
// `budget` is this family's share of the region's mark budget (region.ts):
// past it the spacing opens out until the family fits.
export function hatchFamily({ outline, settings }: Pick<FillInput, 'outline' | 'settings'>, angle: number, budget = MARK_BUDGET.length): Chain[] {
  const chains: Chain[] = []
  const polygons = regionPolygons(outline)
  const spacing = spacingWithin(polygons, angle, settings.spacing, budget)
  for (const line of scanlines(polygons, angle, spacing)) {
    for (const [from, to] of line.intervals) chains.push(polylineChain([scanPoint(angle, line.offset, from), scanPoint(angle, line.offset, to)]))
  }
  return chains
}

export const hatch: FillType = {
  draw: (input) => ({ marks: [{ kind: 'lines', chains: hatchFamily(input, input.settings.angle) }] }),
}
