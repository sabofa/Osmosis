// From the scene contract to the three.js renderer's primitives (calc P2, P3). The
// scene speaks in chains, bands, region outlines, typed marks and unclipped lines;
// the renderer draws ribbons (one per chain, dashed when the curve is), triangle
// fills and point-like marks. Pure, so it is tested without WebGL.
import * as THREE from 'three'
import { chainPoints } from '../scene/chains'
import type { Bounds, Chain, SceneObject, Vec2 } from '../scene/types'
import { clipLineToBounds } from './clipLine'

export type GeometryItem =
  | { kind: 'curve'; points: Vec2[]; dashed?: boolean; color?: string | null }
  | { kind: 'segment'; from: Vec2; to: Vec2; dashed?: boolean; color?: string | null }
  | { kind: 'segments'; pairs: [Vec2, Vec2][]; dashed?: boolean; color?: string | null }
  // A filled area as a flat triangle list (groups of 3 points): what a region
  // outline and a band both become.
  | { kind: 'region'; triangles: Vec2[]; color?: string | null }

// A ring of an outline, with what the nesting needs of it: its box and its area.
interface Ring {
  points: Vec2[]
  minX: number
  maxX: number
  minY: number
  maxY: number
  area: number
}

function ringOf(points: Vec2[]): Ring {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let twiceArea = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const q = points[(i + 1) % points.length]
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
    twiceArea += p.x * q.y - q.x * p.y
  }
  return { points, minX, maxX, minY, maxY, area: Math.abs(twiceArea) / 2 }
}

// Where a point lies against a ring: 1 inside, -1 outside, 0 on its boundary. The boundary is only what
// is exactly on it, which is what two rings that touch at a vertex share; it keeps such a vertex from
// being counted as inside a ring it merely touches.
function locate(ring: Ring, x: number, y: number): -1 | 0 | 1 {
  const points = ring.points
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]
    const b = points[j]
    if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) === 0 && x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x) && y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y)) return 0
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside ? 1 : -1
}

// Whether `outer` holds `inner`. The outline's rings do not cross (an outline is assembled from edges
// that meet only at vertices), so one point of `inner` decides it; a point it shares with `outer` says
// nothing, so the next is tried: each vertex, and if every vertex lies on `outer` (a diamond on the middles
// of a square's edges), the middle of each edge, which does not. A ring cannot hold one that is not smaller
// than it, nor one outside its box. Two rings that coincide, or one that lies along the other everywhere,
// cannot arise: the shared edges of an outline cancel before it is chained into rings.
function holds(outer: Ring, inner: Ring): boolean {
  if (outer.area <= inner.area) return false
  if (inner.minX < outer.minX || inner.maxX > outer.maxX || inner.minY < outer.minY || inner.maxY > outer.maxY) return false
  for (const p of inner.points) {
    const where = locate(outer, p.x, p.y)
    if (where !== 0) return where === 1
  }
  for (let i = 0; i < inner.points.length; i++) {
    const a = inner.points[i]
    const b = inner.points[(i + 1) % inner.points.length]
    const where = locate(outer, (a.x + b.x) / 2, (a.y + b.y) / 2)
    if (where !== 0) return where === 1
  }
  return false
}

// A ring to start earcut with. The earcut bundled with three (3.0.1) leaves its first vertex out of the box
// it hashes the ring's vertices into (its bounding-box loop starts at the second), so a ring that starts at a
// vertex that alone reaches an extreme of x or y puts that vertex outside the box: its hash key is garbage,
// and the triangulation accepts ears that hold other vertices and overflows the polygon. That only happens
// past 80 vertices (below, it does not hash), but a start means nothing to the shape, so it is always moved:
// to the first vertex that is not the only one at an extreme. A ring of four or fewer vertices can have every
// vertex the only one at some extreme (a diamond, a triangle); it starts at the middle of its first edge.
function startedAwayFromExtremes(points: readonly Vec2[]): readonly Vec2[] {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  let atMinX = 0
  let atMaxX = 0
  let atMinY = 0
  let atMaxY = 0
  for (const p of points) {
    if (p.x === minX) atMinX++
    if (p.x === maxX) atMaxX++
    if (p.y === minY) atMinY++
    if (p.y === maxY) atMaxY++
  }
  const only = (p: Vec2) => (p.x === minX && atMinX === 1) || (p.x === maxX && atMaxX === 1) || (p.y === minY && atMinY === 1) || (p.y === maxY && atMaxY === 1)
  const start = points.findIndex((p) => !only(p))
  if (start === 0) return points
  if (start > 0) return [...points.slice(start), ...points.slice(0, start)]
  const [a, b] = points
  return [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ...points.slice(1), a]
}

// A polygon with holes as triangles (groups of three points), by three's triangulation. The outer ring is
// started away from its extremes (see startedAwayFromExtremes); holes are not, as earcut hashes only the
// outer ring's box.
function triangulate(outerRing: readonly Vec2[], holes: readonly (readonly Vec2[])[]): Vec2[] {
  // A ring that closes by repeating its first vertex would let that vertex count twice at its extreme, and
  // the start guard would keep it as the start: drop the repeat, a ring closes by itself.
  const last = outerRing[outerRing.length - 1]
  const outer = outerRing.length > 1 && last.x === outerRing[0].x && last.y === outerRing[0].y ? outerRing.slice(0, -1) : outerRing
  const contour = startedAwayFromExtremes(outer).map((p) => new THREE.Vector2(p.x, p.y))
  const holeContours = holes.map((hole) => hole.map((p) => new THREE.Vector2(p.x, p.y)))
  const faces = THREE.ShapeUtils.triangulateShape(contour, holeContours)
  // the faces index the contour followed by each hole, after the call has tidied them
  const vertices = [...contour]
  for (const hole of holeContours) for (const v of hole) vertices.push(v)
  const triangles: Vec2[] = []
  for (const [a, b, c] of faces) triangles.push({ x: vertices[a].x, y: vertices[a].y }, { x: vertices[b].x, y: vertices[b].y }, { x: vertices[c].x, y: vertices[c].y })
  return triangles
}

// For each ring, the rings that hold it, so its depth is how many there are. A region of many separate
// pieces (a checkerboard) is thousands of rings, and asking every ring about every other is quadratic, so
// the rings are indexed on a grid by the cells their boxes cover: whatever holds a ring has a box that
// covers the cell the ring's own box centres in, and only those are asked.
function holdersOf(rings: readonly Ring[]): number[][] {
  const holders: number[][] = rings.map(() => [])
  if (rings.length < 2) return holders
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const r of rings) {
    if (r.minX < minX) minX = r.minX
    if (r.maxX > maxX) maxX = r.maxX
    if (r.minY < minY) minY = r.minY
    if (r.maxY > maxY) maxY = r.maxY
  }
  const cells = Math.min(128, Math.ceil(Math.sqrt(rings.length)))
  const cellOf = (v: number, lo: number, hi: number) => (hi > lo ? Math.min(cells - 1, Math.floor(((v - lo) / (hi - lo)) * cells)) : 0)
  const grid: number[][] = Array.from({ length: cells * cells }, () => [])
  rings.forEach((r, j) => {
    const x1 = cellOf(r.maxX, minX, maxX)
    const y1 = cellOf(r.maxY, minY, maxY)
    for (let cy = cellOf(r.minY, minY, maxY); cy <= y1; cy++) for (let cx = cellOf(r.minX, minX, maxX); cx <= x1; cx++) grid[cy * cells + cx].push(j)
  })
  rings.forEach((inner, i) => {
    const cx = cellOf((inner.minX + inner.maxX) / 2, minX, maxX)
    const cy = cellOf((inner.minY + inner.maxY) / 2, minY, maxY)
    for (const j of grid[cy * cells + cx]) if (j !== i && holds(rings[j], inner)) holders[i].push(j)
  })
  return holders
}

// The triangles that fill an even-odd outline. Rings are nested by containment: a ring held by an even
// number of others (none, two, ...) is an outer ring, and one held by an odd number is a hole in the
// nearest ring that holds it, which is the one of the next shallower depth with the least area. Each outer
// ring is then triangulated with its holes. A ring's direction means nothing, so a ring in a hole is
// filled again whichever way it runs.
function outlineTriangles(outline: readonly Chain[]): Vec2[] {
  const rings: Ring[] = []
  for (const chain of outline) {
    const points = chainPoints(chain)
    // a ring that repeats its first vertex as its last (a polygon written closed) is the same ring
    const last = points[points.length - 1]
    if (points.length > 1 && last.x === points[0].x && last.y === points[0].y) points.pop()
    // a ring with a vertex that is not a number cannot be nested or triangulated; it is left out rather than
    // allowed to take the frame down (the contact sheet is what looks for such a number in a scene)
    if (points.length >= 3 && points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) rings.push(ringOf(points))
  }
  const holders = holdersOf(rings)
  // outer rings (even depth) each with the holes (odd depth) that belong to it
  const holesOf = new Map<number, number[]>()
  for (let i = 0; i < rings.length; i++) if (holders[i].length % 2 === 0) holesOf.set(i, [])
  for (let i = 0; i < rings.length; i++) {
    if (holders[i].length % 2 === 0) continue
    let parent = -1
    for (const j of holders[i]) {
      if (holders[j].length === holders[i].length - 1 && (parent < 0 || rings[j].area < rings[parent].area)) parent = j
    }
    if (parent >= 0) holesOf.get(parent)?.push(i)
  }
  const triangles: Vec2[] = []
  for (const [outerIndex, holeIndices] of holesOf) {
    // pushed one at a time: a spread of a long triangle list would overflow the call stack
    for (const vertex of triangulate(rings[outerIndex].points, holeIndices.map((h) => rings[h].points))) triangles.push(vertex)
  }
  return triangles
}

export function toRenderItems(objects: readonly SceneObject[], bounds: Bounds): { geometry: GeometryItem[]; misc: SceneObject[] } {
  const geometry: GeometryItem[] = []
  const misc: SceneObject[] = []
  for (const obj of objects) {
    switch (obj.kind) {
      case 'curve':
        for (const chain of obj.chains) {
          const points = chainPoints(chain)
          if (points.length < 2) continue
          if (chain.closed) points.push(points[0])
          geometry.push({ kind: 'curve', points, dashed: obj.dashed, color: obj.color })
        }
        break
      case 'band': {
        const triangles: Vec2[] = []
        for (const chain of obj.outline) {
          const points = chainPoints(chain)
          if (points.length < 3) continue
          for (const vertex of triangulate(points, [])) triangles.push(vertex)
        }
        if (triangles.length > 0) geometry.push({ kind: 'region', triangles, color: obj.color })
        break
      }
      // A region is an outline, filled even-odd. Its boundary is not drawn here: the
      // curves that lie along it are objects of their own, listed in `boundary`.
      case 'region': {
        const triangles = outlineTriangles(obj.outline)
        if (triangles.length > 0) geometry.push({ kind: 'region', triangles, color: obj.color })
        break
      }
      // A constructed or guide line is stored unclipped (see scene/types.ts); how
      // much of it to draw is a fact about the current view, so it is clipped
      // here, at draw time, against the camera's live bounds. One that misses the
      // view drops out.
      case 'line': {
        const span = clipLineToBounds(obj.through, obj.direction, obj.extent, bounds)
        if (span) geometry.push({ kind: 'segment', from: span[0], to: span[1], dashed: obj.role === 'asymptote', color: obj.color })
        break
      }
      case 'segment':
      case 'segments':
        geometry.push(obj)
        break
      default:
        misc.push(obj)
    }
  }
  return { geometry, misc }
}
