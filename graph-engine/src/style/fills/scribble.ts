import { smoothNoise, type Random } from '../random'
import { polylineChain, smoothThrough, type Chain } from '../path'
import type { Point } from '../tokens'
import { boundsOfPolygons, hatchFrame, insideRegion, MARK_BUDGET, regionPolygons, scanlines, scanPoint, spacingWithin } from './region'
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
// rather than zig-zags, and the direction itself drifts across the region.
// At roughness 0 none of that runs — same runs, same polyline, byte for
// byte.

interface Run {
  points: Point[]
  last: [number, number]
  side: number
}

// A turn point on a scanline, at `offset` and `s` along it — moved, above
// roughness 0, along the scan direction and across it, a hand's turn never
// landing quite where it meant to.
function turnPoint(angle: number, offset: number, s: number, spacing: number, r: number, random: Random): Point {
  if (r <= 0) return scanPoint(angle, offset, s)
  const across = random.range(-0.45, 0.45) * r * spacing
  const along = random.range(-0.8, 0.8) * r * spacing
  return scanPoint(angle, offset + across, s + along)
}

// The run-building pass, shared by the main family and the second: touches
// alternate ends of successive stretches, going round a hole by starting a
// new run wherever the next leg would leave the region.
function buildRuns(polygons: readonly Point[][], angle: number, step: number, r: number, random: Random): Run[] {
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

// A turn replaced by a small loop, now and then — a hand's flourish. Each
// loop is 3 or 4 points on a small circle, spliced in before the turn itself.
function withLoops(points: readonly Point[], spacing: number, r: number, random: Random): Point[] {
  const out: Point[] = []
  for (const p of points) {
    if (random.next() < 0.2 * r) {
      const radius = random.range(0.3, 0.6) * spacing
      const count = random.int(3, 4)
      const start = random.range(0, 2 * Math.PI)
      for (let i = 0; i < count; i++) {
        const a = start + (i / count) * 2 * Math.PI
        out.push({ x: p.x + Math.cos(a) * radius, y: p.y + Math.sin(a) * radius })
      }
    }
    out.push(p)
  }
  return out
}

// A midpoint pushed sideways on every leg between consecutive turns — the
// unevenness of a hand's own zig-zag, capped so it never bends further than
// about a spacing.
function withLegBends(points: readonly Point[], spacing: number, r: number, random: Random): Point[] {
  if (points.length < 2) return points.slice()
  const out: Point[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const legLength = Math.hypot(b.x - a.x, b.y - a.y)
    if (legLength > 1e-6) {
      const push = Math.max(-1.2 * spacing, Math.min(1.2 * spacing, random.gauss() * 0.18 * r * legLength))
      out.push({ x: (a.x + b.x) / 2 - ((b.y - a.y) / legLength) * push, y: (a.y + b.y) / 2 + ((b.x - a.x) / legLength) * push })
    }
    out.push(b)
  }
  return out
}

// A run's points, roughened: loops spliced in, then a bend on every
// resulting leg. Nothing at roughness 0.
function roughenRun(points: readonly Point[], spacing: number, r: number, random: Random): Point[] {
  if (r <= 0) return points.slice()
  return withLegBends(withLoops(points, spacing, r, random), spacing, r, random)
}

// The drift: a smooth, seeded field turning every point a little about the
// region's centre, the angle varying with how far along the family's own
// direction the point sits — so the hand's angle wanders across the region
// rather than jittering point to point. `null` at roughness 0 (no field, no
// random draw).
function driftField(polygons: readonly Point[][], angle: number, r: number, random: Random): ((p: Point) => number) | null {
  if (r <= 0) return null
  const { along } = hatchFrame(angle)
  const project = (p: Point) => p.x * along.x + p.y * along.y
  let lo = Infinity
  let hi = -Infinity
  for (const polygon of polygons) for (const p of polygon) {
    lo = Math.min(lo, project(p))
    hi = Math.max(hi, project(p))
  }
  const span = Math.max(1e-6, hi - lo)
  const noise = smoothNoise(random, 4)
  const swing = (15 * Math.PI) / 180
  return (p) => swing * r * noise(Math.min(1, Math.max(0, (project(p) - lo) / span)))
}

function drift(points: readonly Point[], centre: Point, field: ((p: Point) => number) | null): Point[] {
  if (!field) return points.slice()
  return points.map((p) => {
    const theta = field(p)
    const dx = p.x - centre.x
    const dy = p.y - centre.y
    return { x: centre.x + dx * Math.cos(theta) - dy * Math.sin(theta), y: centre.y + dx * Math.sin(theta) + dy * Math.cos(theta) }
  })
}

// A run's points as a chain: a smooth curve through them above roughness 0
// (rounded turns, a hand's flourish rather than a zig-zag's sharp V), the
// plain polyline at 0.
function toChain(points: readonly Point[], r: number): Chain {
  return r > 0 ? { pieces: smoothThrough(points, false), closed: false } : polylineChain(points)
}

export const scribble: FillType = {
  draw({ outline, settings, random }) {
    const polygons = regionPolygons(outline)
    const angle = settings.angle
    const r = settings.roughness
    // A second, sparser pass (below) shares the budget: the main family
    // keeps two thirds of it when there will be one.
    const mainBudget = r > 0.3 ? (2 / 3) * MARK_BUDGET.length : MARK_BUDGET.length
    const step = spacingWithin(polygons, angle, settings.spacing, mainBudget)
    const box = boundsOfPolygons(polygons)
    const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
    const field = driftField(polygons, angle, r, random)
    const finish = (points: readonly Point[], spacing: number): Point[] => drift(roughenRun(points, spacing, r, random), centre, field)

    const chains: Chain[] = buildRuns(polygons, angle, step, r, random).map((run) => toChain(finish(run.points, step), r))

    // At higher roughness, a second, sparser scribble goes over a patch of
    // the first — another angle, wider spacing, split where it leaves a
    // random disc so it reads as a patch rather than a second whole fill.
    if (r > 0.3) {
      const angle2 = angle + random.range(25, 60)
      const step2 = spacingWithin(polygons, angle2, settings.spacing * 1.6, MARK_BUDGET.length / 3)
      const discCentre = { x: box.minX + random.next() * (box.maxX - box.minX), y: box.minY + random.next() * (box.maxY - box.minY) }
      const discRadius = random.range(0.3, 0.6) * Math.max(box.maxX - box.minX, box.maxY - box.minY)
      const inDisc = (p: Point) => Math.hypot(p.x - discCentre.x, p.y - discCentre.y) <= discRadius
      for (const run of buildRuns(polygons, angle2, step2, r, random)) {
        const points = finish(run.points, step2)
        let segment: Point[] = []
        for (const p of points) {
          if (inDisc(p)) segment.push(p)
          else {
            if (segment.length > 1) chains.push(toChain(segment, r))
            segment = []
          }
        }
        if (segment.length > 1) chains.push(toChain(segment, r))
      }
    }
    return { marks: [{ kind: 'lines', chains }] }
  },
}
