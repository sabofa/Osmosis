import type { Vec2 } from '../scene/types'

export interface Bounds {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

// Edge indices per cell: 0=bottom, 1=right, 2=top, 3=left.
// table[mask] lists which edge pairs get a segment, where mask bit i is set
// when corner i (0=BL, 1=BR, 2=TR, 3=TL) evaluates positive.
const EDGE_TABLE: readonly (readonly [number, number])[][] = [
  [],
  [[3, 0]],
  [[0, 1]],
  [[3, 1]],
  [[1, 2]],
  [
    [3, 0],
    [1, 2],
  ],
  [[0, 2]],
  [[3, 2]],
  [[3, 2]],
  [[0, 2]],
  [
    [3, 0],
    [1, 2],
  ],
  [[1, 2]],
  [[3, 1]],
  [[0, 1]],
  [[3, 0]],
  [],
]

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// Point where the zero-crossing falls between two corners with values va, vb.
function crossing(pa: Vec2, va: number, pb: Vec2, vb: number): Vec2 {
  const t = va === vb ? 0.5 : va / (va - vb)
  return { x: lerp(pa.x, pb.x, t), y: lerp(pa.y, pb.y, t) }
}

// Traces F(x,y) = 0 over the given bounds via marching squares, returning a
// flat list of independent 2-point segments (not a connected polyline — cheap
// to build as THREE.LineSegments).
export function traceImplicitCurve(f: (x: number, y: number) => number, bounds: Bounds, resolution: number): Vec2[][] {
  const { xMin, xMax, yMin, yMax } = bounds
  const nx = resolution
  const ny = resolution
  const dx = (xMax - xMin) / nx
  const dy = (yMax - yMin) / ny

  const xs = Array.from({ length: nx + 1 }, (_, i) => xMin + i * dx)
  const ys = Array.from({ length: ny + 1 }, (_, j) => yMin + j * dy)
  const grid: number[][] = ys.map((y) => xs.map((x) => f(x, y)))

  const segments: Vec2[][] = []

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v0 = grid[j][i] // BL
      const v1 = grid[j][i + 1] // BR
      const v2 = grid[j + 1][i + 1] // TR
      const v3 = grid[j + 1][i] // TL
      const mask = (v0 > 0 ? 1 : 0) | (v1 > 0 ? 2 : 0) | (v2 > 0 ? 4 : 0) | (v3 > 0 ? 8 : 0)
      const pairs = EDGE_TABLE[mask]
      if (pairs.length === 0) continue

      const bl: Vec2 = { x: xs[i], y: ys[j] }
      const br: Vec2 = { x: xs[i + 1], y: ys[j] }
      const tr: Vec2 = { x: xs[i + 1], y: ys[j + 1] }
      const tl: Vec2 = { x: xs[i], y: ys[j + 1] }

      const edgePoint = (edge: number): Vec2 => {
        if (edge === 0) return crossing(bl, v0, br, v1)
        if (edge === 1) return crossing(br, v1, tr, v2)
        if (edge === 2) return crossing(tl, v3, tr, v2)
        return crossing(bl, v0, tl, v3)
      }

      for (const [a, b] of pairs) {
        segments.push([edgePoint(a), edgePoint(b)])
      }
    }
  }

  return segments
}

export interface ImplicitRegion {
  // Flat triangle list (groups of 3) for the filled area.
  triangles: Vec2[]
  // Same boundary as traceImplicitCurve, computed from the same grid pass —
  // guarantees the fill's edge lines up with the traced boundary exactly,
  // rather than a separately-resolved mask blocking out at the cell
  // granularity (which visibly doesn't match a finer boundary trace).
  boundarySegments: Vec2[][]
}

// Fills F(x,y) > 0 (or wherever the caller's f already encodes the
// inequality, e.g. f = left - right) via marching squares: each cell's
// "inside" polygon is built by walking its 4 corners and splicing in the same
// edge-crossing points the boundary trace uses, then fan-triangulated.
export function traceImplicitRegion(f: (x: number, y: number) => number, bounds: Bounds, resolution: number): ImplicitRegion {
  const { xMin, xMax, yMin, yMax } = bounds
  const nx = resolution
  const ny = resolution
  const dx = (xMax - xMin) / nx
  const dy = (yMax - yMin) / ny

  const xs = Array.from({ length: nx + 1 }, (_, i) => xMin + i * dx)
  const ys = Array.from({ length: ny + 1 }, (_, j) => yMin + j * dy)
  const grid: number[][] = ys.map((y) => xs.map((x) => f(x, y)))

  const triangles: Vec2[] = []
  const boundarySegments: Vec2[][] = []

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v0 = grid[j][i] // BL
      const v1 = grid[j][i + 1] // BR
      const v2 = grid[j + 1][i + 1] // TR
      const v3 = grid[j + 1][i] // TL
      const mask = (v0 > 0 ? 1 : 0) | (v1 > 0 ? 2 : 0) | (v2 > 0 ? 4 : 0) | (v3 > 0 ? 8 : 0)
      if (mask === 0) continue

      const bl: Vec2 = { x: xs[i], y: ys[j] }
      const br: Vec2 = { x: xs[i + 1], y: ys[j] }
      const tr: Vec2 = { x: xs[i + 1], y: ys[j + 1] }
      const tl: Vec2 = { x: xs[i], y: ys[j + 1] }

      const e0 = crossing(bl, v0, br, v1)
      const e1 = crossing(br, v1, tr, v2)
      const e2 = crossing(tl, v3, tr, v2)
      const e3 = crossing(bl, v0, tl, v3)

      for (const [a, b] of EDGE_TABLE[mask]) {
        const edgePoint = (edge: number): Vec2 => (edge === 0 ? e0 : edge === 1 ? e1 : edge === 2 ? e2 : e3)
        boundarySegments.push([edgePoint(a), edgePoint(b)])
      }

      if (mask === 15) {
        triangles.push(bl, br, tr, bl, tr, tl)
        continue
      }

      // Perimeter walk bl -> br -> tr -> tl -> bl, keeping each inside corner
      // and splicing in the edge-crossing point wherever the sign flips —
      // builds the cell's "inside" polygon directly from the same corner
      // values and crossings the boundary above was built from.
      const corners = [
        { p: bl, v: v0 },
        { p: br, v: v1 },
        { p: tr, v: v2 },
        { p: tl, v: v3 },
      ]
      const edgePts = [e0, e1, e2, e3]
      const poly: Vec2[] = []
      for (let k = 0; k < 4; k++) {
        const cur = corners[k]
        const next = corners[(k + 1) % 4]
        if (cur.v > 0) poly.push(cur.p)
        if (cur.v > 0 !== next.v > 0) poly.push(edgePts[k])
      }
      for (let k = 1; k < poly.length - 1; k++) {
        triangles.push(poly[0], poly[k], poly[k + 1])
      }
    }
  }

  return { triangles, boundarySegments }
}
