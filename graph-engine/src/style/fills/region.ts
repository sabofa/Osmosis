import { sampleChain, type Chain } from '../path'
import type { Random } from '../random'
import type { Point } from '../tokens'

// Regions for the fills: an outline flattened to polygons, the even-odd
// inside test, and scanlines — the lines of a hatch family, cut to where
// they cross the region.
//
// Flattening is only for DECIDING where marks go. What the reader sees at
// the region's edge is the pen's clip to the exact outline.

const FLATTEN_STEP = 2

export function regionPolygons(outline: readonly Chain[]): Point[][] {
  return outline.map((chain) => sampleChain(chain, FLATTEN_STEP))
}

// Even-odd: a point is inside when a ray from it crosses the outline an odd
// number of times — which makes a hole a hole whichever way it winds.
export function insideRegion(p: Point, polygons: readonly Point[][]): boolean {
  let inside = false
  for (const polygon of polygons) {
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i]
      const b = polygon[j]
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
    }
  }
  return inside
}

export function boundsOfPolygons(polygons: readonly Point[][]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const polygon of polygons) {
    for (const p of polygon) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }
  return { minX, minY, maxX, maxY }
}

// The frame of a hatch family at `angle` degrees (anticlockwise from the
// page's horizontal; the page's y points down): `along` runs with the
// lines, `across` from one line to the next.
export function hatchFrame(angle: number): { along: Point; across: Point } {
  const theta = (angle * Math.PI) / 180
  return { along: { x: Math.cos(theta), y: -Math.sin(theta) }, across: { x: Math.sin(theta), y: Math.cos(theta) } }
}

export interface Scanline {
  // How far across the family this line is: a whole number of spacings, so
  // the family is anchored to the page, not to the region.
  offset: number
  // Where it is inside the region, as [from, to] along the line.
  intervals: [number, number][]
}

// How far the region reaches across the family's direction, at `angle`: a
// line's `offset` only ever needs to run from `lo` to `hi`.
export function acrossSpan(polygons: readonly Point[][], angle: number): { lo: number; hi: number } {
  const { across } = hatchFrame(angle)
  const dot = (p: Point, u: Point) => p.x * u.x + p.y * u.y
  let lo = Infinity
  let hi = -Infinity
  for (const polygon of polygons) {
    for (const p of polygon) {
      lo = Math.min(lo, dot(p, across))
      hi = Math.max(hi, dot(p, across))
    }
  }
  return { lo, hi }
}

// One line of the family, at any `offset` (not only a multiple of a
// spacing) — the stretches where it crosses the region, as [from, to] along
// it. Pulled out of `scanlines` so a rough hatch (hatch.ts) can place a line
// off its anchored spot without recomputing the whole family.
export function scanlineAt(polygons: readonly Point[][], angle: number, offset: number): [number, number][] {
  const { along, across } = hatchFrame(angle)
  const dot = (p: Point, u: Point) => p.x * u.x + p.y * u.y
  const hits: number[] = []
  for (const polygon of polygons) {
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const ca = dot(polygon[j], across)
      const cb = dot(polygon[i], across)
      // Half-open, so a line through a vertex counts it once.
      if ((ca <= offset && offset < cb) || (cb <= offset && offset < ca)) {
        const f = (offset - ca) / (cb - ca)
        hits.push(dot(polygon[j], along) + f * (dot(polygon[i], along) - dot(polygon[j], along)))
      }
    }
  }
  hits.sort((a, b) => a - b)
  const intervals: [number, number][] = []
  for (let i = 0; i + 1 < hits.length; i += 2) if (hits[i + 1] > hits[i]) intervals.push([hits[i], hits[i + 1]])
  return intervals
}

export function scanlines(polygons: readonly Point[][], angle: number, spacing: number): Scanline[] {
  const { lo, hi } = acrossSpan(polygons, angle)
  const out: Scanline[] = []
  if (!Number.isFinite(lo) || spacing <= 0) return out
  for (let k = Math.ceil(lo / spacing); k * spacing <= hi; k++) {
    const offset = k * spacing
    const intervals = scanlineAt(polygons, angle, offset)
    if (intervals.length > 0) out.push({ offset, intervals })
  }
  return out
}

// The point `s` along a scanline at `offset`.
export function scanPoint(angle: number, offset: number, s: number): Point {
  const { along, across } = hatchFrame(angle)
  return { x: along.x * s + across.x * offset, y: along.y * s + across.y * offset }
}

// ---------------------------------------------------------------------------
// The mark budget
// ---------------------------------------------------------------------------

// How much a fill may draw in ONE region, whatever its spacing: at most this
// many drawing units of shading line (a figure is fitted into 640, so a full
// square of hatching at spacing 8 is about 51k), and at most this many
// stipple dots. Past it the spacing opens out just enough to fit, so an
// author who asks for spacing 3 over a whole figure gets dense shading, not
// megabytes of SVG and a figure that stutters when panned.
export const MARK_BUDGET = { length: 40000, dots: 6000 }

// The total length of a hatch family's lines inside the region.
export function hatchLength(polygons: readonly Point[][], angle: number, spacing: number): number {
  let total = 0
  for (const line of scanlines(polygons, angle, spacing)) for (const [from, to] of line.intervals) total += to - from
  return total
}

// The spacing to draw a family of lines at so its length fits `budget`:
// line length goes as 1 / spacing, so an overrun opens the spacing by the
// same factor.
export function spacingWithin(polygons: readonly Point[][], angle: number, spacing: number, budget: number): number {
  const length = hatchLength(polygons, angle, spacing)
  return length > budget ? spacing * (length / budget) : spacing
}

// ---------------------------------------------------------------------------
// Roughness
// ---------------------------------------------------------------------------

// A flat fill's or a wash's "off register" nudge: a short seeded step in a
// random direction, `random.range(1, 3)` drawing units long at roughness 1,
// scaled down with it. `undefined` at roughness 0, so a fill with no
// roughness draws exactly as before — no shift, no extra random draw.
export function offRegister(random: Random, roughness: number): Point | undefined {
  if (roughness <= 0) return undefined
  const length = random.range(1, 3) * roughness
  const angle = random.range(0, 2 * Math.PI)
  return { x: Math.cos(angle) * length, y: Math.sin(angle) * length }
}
