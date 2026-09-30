import { smoothNoise, type Random } from '../random'
import { polylineChain, type Chain } from '../path'
import type { Point } from '../tokens'
import { acrossSpan, MARK_BUDGET, regionPolygons, scanlineAt, scanlines, scanPoint, spacingWithin } from './region'
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
//
// At `roughness` 0 this is exactly the above, byte for byte. Above 0
// (roughenFamily) every line strays a little in place, angle and where it
// ends, and now and then is skipped or broken — a hand's hatching, not a
// plotter's. The pen clips the result to the region's exact outline, so an
// end that runs past the edge never spills (rule 4).
export function hatchFamily({ outline, settings, random }: Pick<FillInput, 'outline' | 'settings' | 'random'>, angle: number, budget = MARK_BUDGET.length): Chain[] {
  const polygons = regionPolygons(outline)
  const spacing = spacingWithin(polygons, angle, settings.spacing, budget)
  if (settings.roughness <= 0) {
    const chains: Chain[] = []
    for (const line of scanlines(polygons, angle, spacing)) {
      for (const [from, to] of line.intervals) chains.push(polylineChain([scanPoint(angle, line.offset, from), scanPoint(angle, line.offset, to)]))
    }
    return chains
  }
  return roughenFamily(polygons, angle, spacing, settings.roughness, random)
}

// A stretch's ends move independently, short of the edge or past it; a
// stretch pulled past its own start (or shorter than about a unit) is
// dropped rather than drawn inverted.
function roughEnds(from: number, to: number, spacing: number, r: number, random: Random): [number, number][] {
  const a = from + random.range(-0.9, 0.6) * r * spacing
  const b = to + random.range(-0.9, 0.6) * r * spacing
  if (b - a < 1) return []
  // Now and then a long stretch breaks into two, with a gap between.
  if (b - a > 6 * spacing && random.next() < 0.12 * r) {
    const gap = random.range(0.5, 1.5) * spacing
    const cut = random.range(a + (b - a) * 0.3, b - (b - a) * 0.3)
    const left: [number, number] = [a, cut - gap / 2]
    const right: [number, number] = [cut + gap / 2, b]
    if (left[1] - left[0] >= 1 && right[1] - right[0] >= 1) return [left, right]
  }
  return [[a, b]]
}

// One stretch's chain: the two points at `offset` on the true line, turned
// by a small angle about their own midpoint — the pen resting at a slightly
// different tilt from one stroke to the next.
function stretchChain(angle: number, offset: number, from: number, to: number, r: number, random: Random): Chain {
  const p = scanPoint(angle, offset, from)
  const q = scanPoint(angle, offset, to)
  const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
  const theta = (random.range(-6, 6) * r * Math.PI) / 180
  const turn = (point: Point): Point => {
    const dx = point.x - mid.x
    const dy = point.y - mid.y
    return { x: mid.x + dx * Math.cos(theta) - dy * Math.sin(theta), y: mid.y + dx * Math.sin(theta) + dy * Math.cos(theta) }
  }
  return polylineChain([turn(p), turn(q)])
}

function roughenFamily(polygons: readonly Point[][], angle: number, spacing: number, r: number, random: Random): Chain[] {
  const { lo, hi } = acrossSpan(polygons, angle)
  const chains: Chain[] = []
  if (!Number.isFinite(lo) || spacing <= 0) return chains
  // The spacing bunches and opens slowly across the family: each step is the
  // last, scaled by up to +-25% of a slow noise over how far across the
  // family this line is.
  const count = Math.max(1, Math.round((hi - lo) / spacing))
  const bunching = smoothNoise(random, 4)
  let offset = Math.ceil(lo / spacing) * spacing
  let k = 0
  while (offset <= hi) {
    const skipped = random.next() < 0.06 * r
    const place = offset + random.range(-0.3, 0.3) * r * spacing
    if (!skipped) {
      for (const [from, to] of scanlineAt(polygons, angle, place)) {
        for (const [a, b] of roughEnds(from, to, spacing, r, random)) chains.push(stretchChain(angle, place, a, b, r, random))
      }
    }
    offset += spacing * (1 + 0.25 * r * bunching(k / count))
    k++
  }
  return chains
}

export const hatch: FillType = {
  draw: (input) => ({ marks: [{ kind: 'lines', chains: hatchFamily(input, input.settings.angle) }] }),
}
