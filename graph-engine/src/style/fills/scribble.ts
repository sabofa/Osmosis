import { polylineChain, type Chain } from '../path'
import type { Point } from '../tokens'
import { insideRegion, regionPolygons, scanlines, scanPoint } from './region'
import type { FillType } from './types'

// SCRIBBLE — shading by hand: one continuous zig-zag going back and forth
// across the region at `angle`, `spacing` between its turns, the way a pen
// fills a shape without lifting.
//
// Built on the region's scanlines. A run of the zig-zag touches alternate
// ends of successive stretches, each turn pulled in from the edge by a
// seeded amount (a hand never quite reaches the line). A run ends, and a new
// one starts, wherever the next leg would leave the region, so a scribble
// goes round a hole rather than over it. Drawn in the current line type and
// clipped to the region by the pen.

interface Run {
  points: Point[]
  last: [number, number]
  side: number
}

export const scribble: FillType = {
  draw({ outline, settings, random }) {
    const polygons = regionPolygons(outline)
    const angle = settings.angle
    const step = settings.spacing
    const legInside = (a: Point, b: Point) =>
      [0.25, 0.5, 0.75].every((f) => insideRegion({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, polygons))

    let open: Run[] = []
    const done: Run[] = []
    for (const line of scanlines(polygons, angle, step)) {
      const next: Run[] = []
      for (const [from, to] of line.intervals) {
        const inset = Math.min((to - from) / 3, step * random.range(0.05, 0.45))
        // Continue the first open run whose last stretch overlaps this one.
        const index = open.findIndex((run) => run.last[0] < to && from < run.last[1])
        const run = index >= 0 ? open.splice(index, 1)[0] : null
        const side = run ? 1 - run.side : 0
        const at = scanPoint(angle, line.offset, side === 0 ? from + inset : to - inset)
        if (run && legInside(run.points[run.points.length - 1], at)) {
          run.points.push(at)
          run.last = [from, to]
          run.side = side
          next.push(run)
        } else {
          if (run) done.push(run)
          next.push({ points: [at], last: [from, to], side })
        }
      }
      done.push(...open)
      open = next
    }
    done.push(...open)
    const chains: Chain[] = done.filter((run) => run.points.length > 1).map((run) => polylineChain(run.points))
    return { marks: [{ kind: 'lines', chains }] }
  },
}
