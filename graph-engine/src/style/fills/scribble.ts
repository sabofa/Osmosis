import type { Random } from '../random'
import type { Chain } from '../path'
import type { Point } from '../tokens'
import { boundsOfPolygons, insideRegion, MARK_BUDGET, regionPolygons, scanlines, spacingWithin } from './region'
import { drift, driftField, roughenRun, secondPassChains, secondPassShare, toChain, turnPoint } from './scribbleRough'
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
//
// This is Ben's "a little wild and unpredictable" fill: above roughness 0
// every turn strays, legs bend, turns sometimes loop, the whole run curves
// rather than zig-zags, and the direction itself drifts across the region —
// all of that is scribbleRough.ts, kept apart from the run-building below,
// which is the same at every roughness. At roughness 0 none of it runs —
// same runs, same polyline, byte for byte.

export interface Run {
  points: Point[]
  last: [number, number]
  side: number
}

// The run-building pass, shared by the main family and the second: touches
// alternate ends of successive stretches, going round a hole by starting a
// new run wherever the next leg would leave the region.
export function buildRuns(polygons: readonly Point[][], angle: number, step: number, r: number, random: Random): Run[] {
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
      const at = turnPoint(angle, line.offset, side === 0 ? from + inset : to - inset, step, r, random)
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
  return done.filter((run) => run.points.length > 1)
}

export const scribble: FillType = {
  draw({ outline, settings, random }) {
    const polygons = regionPolygons(outline)
    const angle = settings.angle
    const r = settings.roughness
    // A second, sparser pass (scribbleRough.ts) shares the budget with the
    // main family. The main family's own share is cut a little further
    // still, (1 − 0.1r), since roughening (turn jitter, bends) inflates a
    // run's own length a little on top of whatever the second pass takes
    // (review round 1).
    const secondShare = secondPassShare(r)
    const mainBudget = MARK_BUDGET.length * (1 - 0.1 * r) * (1 - secondShare)
    const step = spacingWithin(polygons, angle, settings.spacing, mainBudget)
    const box = boundsOfPolygons(polygons)
    const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
    const field = driftField(polygons, angle, r, random)
    const finish = (points: readonly Point[], spacing: number): Point[] => drift(roughenRun(points, spacing, r, random), centre, field)

    const chains: Chain[] = buildRuns(polygons, angle, step, r, random).map((run) => toChain(finish(run.points, step), r))
    chains.push(...secondPassChains(polygons, angle, settings.spacing, r, random, box, finish, buildRuns))

    return { marks: [{ kind: 'lines', chains }] }
  },
}
