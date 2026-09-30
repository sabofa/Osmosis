import { sampleChain, type Chain } from '../path'
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

export function scanlines(polygons: readonly Point[][], angle: number, spacing: number): Scanline[] {
  const { along, across } = hatchFrame(angle)
  const dot = (p: Point, u: Point) => p.x * u.x + p.y * u.y
  let lo = Infinity
  let hi = -Infinity
  for (const polygon of polygons) {
    for (const p of polygon) {
      lo = Math.min(lo, dot(p, across))
      hi = Math.max(hi, dot(p, across))
    }
  }
  const out: Scanline[] = []
  if (!Number.isFinite(lo) || spacing <= 0) return out
  for (let k = Math.ceil(lo / spacing); k * spacing <= hi; k++) {
    const offset = k * spacing
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
    if (intervals.length > 0) out.push({ offset, intervals })
  }
  return out
}

// The point `s` along a scanline at `offset`.
export function scanPoint(angle: number, offset: number, s: number): Point {
  const { along, across } = hatchFrame(angle)
  return { x: along.x * s + across.x * offset, y: along.y * s + across.y * offset }
}
