// Hand-built marks and scenes, for tests and the review page's fixtures until
// the kernel (S1) builds scenes from specs. They fill the typed arrays of the
// committed contract (scene/types.ts) and nothing more: no sampling policy,
// no domains, no pick functions beyond what a caller passes.

import type {
  ArrowMark,
  ArrowStyle,
  Box3,
  ColorSpec,
  LabelAnchor,
  LineMark,
  LineStyle,
  Mark,
  MarkSource,
  MeshMark,
  MeshStyle,
  PointMark,
  PointStyle,
  SpaceScene,
  SurfacePick,
  Vec3,
} from '../scene/types'

export function source(line: number, part?: string): MarkSource {
  return { line, statement: null, object: part ? `s${line}.${part}` : `s${line}` }
}

export function slot(n: number): ColorSpec {
  return { author: null, slot: n }
}

export function meshMark(
  positions: readonly number[] | Float64Array,
  normals: readonly number[] | Float64Array,
  indices: readonly number[] | Uint32Array,
  options: { line?: number; style?: Partial<MeshStyle>; pick?: SurfacePick | null; scalars?: Float64Array | null } = {},
): MeshMark {
  return {
    kind: 'mesh',
    source: source(options.line ?? 1),
    positions: Float64Array.from(positions),
    normals: Float64Array.from(normals),
    indices: Uint32Array.from(indices),
    scalars: options.scalars ?? null,
    uv: null,
    style: { color: slot(0), opacity: 1, colorScale: null, meshLines: null, ...options.style },
    pick: options.pick ?? null,
  }
}

// A z = f(x, y) grid over [x0, x1] x [y0, y1] with (n + 1)^2 vertices,
// analytic normals from the partials, and counter-clockwise triangles seen
// from +z (so the front face is the side the normal points to).
export function graphMesh(
  f: (x: number, y: number) => number,
  fx: (x: number, y: number) => number,
  fy: (x: number, y: number) => number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  n: number,
  options: { line?: number; style?: Partial<MeshStyle> } = {},
): MeshMark {
  const count = (n + 1) * (n + 1)
  const positions = new Float64Array(count * 3)
  const normals = new Float64Array(count * 3)
  const scalars = new Float64Array(count)
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n
      const y = y0 + ((y1 - y0) * j) / n
      const z = f(x, y)
      const v = j * (n + 1) + i
      positions.set([x, y, z], v * 3)
      const nx = -fx(x, y)
      const ny = -fy(x, y)
      const len = Math.hypot(nx, ny, 1)
      normals.set([nx / len, ny / len, 1 / len], v * 3)
      scalars[v] = z
    }
  }
  const indices = new Uint32Array(n * n * 6)
  let k = 0
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i
      const b = a + 1
      const c = a + (n + 1)
      const d = c + 1
      indices.set([a, b, d, a, d, c], k)
      k += 6
    }
  }
  return meshMark(positions, normals, indices, {
    line: options.line,
    style: options.style,
    pick: { kind: 'graph', f, fx, fy },
    scalars,
  })
}

// A parametric surface r(u, v) over [u0, u1] x [v0, v1], with normals r_u x r_v
// (passed in, so they are analytic) and triangles counter-clockwise about them.
export function parametricMesh(
  r: (u: number, v: number) => Vec3,
  normal: (u: number, v: number) => Vec3,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  nu: number,
  nv: number,
  options: { line?: number; style?: Partial<MeshStyle> } = {},
): MeshMark {
  const count = (nu + 1) * (nv + 1)
  const positions = new Float64Array(count * 3)
  const normals = new Float64Array(count * 3)
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = u0 + ((u1 - u0) * i) / nu
      const v = v0 + ((v1 - v0) * j) / nv
      const k = j * (nu + 1) + i
      positions.set(r(u, v), k * 3)
      normals.set(normal(u, v), k * 3)
    }
  }
  const indices = new Uint32Array(nu * nv * 6)
  let k = 0
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i
      const b = a + 1
      const c = a + (nu + 1)
      const d = c + 1
      indices.set([a, b, d, a, d, c], k)
      k += 6
    }
  }
  return meshMark(positions, normals, indices, {
    line: options.line,
    style: options.style,
    pick: { kind: 'parametric', param: ['u', 'v'], r },
  })
}

export function lineMark(
  polylines: readonly (readonly Vec3[])[],
  options: { line?: number; style?: Partial<LineStyle> } = {},
): LineMark {
  const total = polylines.reduce((n, p) => n + p.length, 0)
  const positions = new Float64Array(total * 3)
  const starts = new Uint32Array(polylines.length)
  let v = 0
  polylines.forEach((poly, i) => {
    starts[i] = v
    for (const p of poly) positions.set(p, v++ * 3)
  })
  return {
    kind: 'lines',
    source: source(options.line ?? 1),
    positions,
    starts,
    params: null,
    style: { color: slot(0), width: 2, dash: null, hidden: 'none', ...options.style },
    pick: null,
  }
}

// A curve r(t) sampled at `segments` + 1 evenly spaced parameters.
export function curveMark(
  r: (t: number) => Vec3,
  t0: number,
  t1: number,
  segments: number,
  options: { line?: number; style?: Partial<LineStyle> } = {},
): LineMark {
  const points: Vec3[] = []
  for (let i = 0; i <= segments; i++) points.push(r(t0 + ((t1 - t0) * i) / segments))
  return lineMark([points], options)
}

export function pointMark(points: readonly Vec3[], options: { line?: number; style?: Partial<PointStyle> } = {}): PointMark {
  const positions = new Float64Array(points.length * 3)
  points.forEach((p, i) => positions.set(p, i * 3))
  return {
    kind: 'points',
    source: source(options.line ?? 1),
    positions,
    style: { color: slot(0), size: 8, shape: 'dot', ...options.style },
  }
}

export function arrowMark(
  arrows: readonly { tail: Vec3; vector: Vec3 }[],
  options: { line?: number; style?: Partial<ArrowStyle> } = {},
): ArrowMark {
  const tails = new Float64Array(arrows.length * 3)
  const vectors = new Float64Array(arrows.length * 3)
  arrows.forEach((a, i) => {
    tails.set(a.tail, i * 3)
    vectors.set(a.vector, i * 3)
  })
  return {
    kind: 'arrows',
    source: source(options.line ?? 1),
    tails,
    vectors,
    style: { color: slot(0), shaftWidth: 2, headSize: 10, hidden: 'none', ...options.style },
  }
}

export function label(position: Vec3, text: string, line = 1): LabelAnchor {
  return { source: source(line, 'label'), position, text, kind: 'point' }
}

// The extent of every finite vertex a scene's marks carry. The kernel's own
// sceneExtent (S1) is robust against poles; fixtures have none, so the plain
// min/max is what they need.
export function plainExtent(marks: readonly Mark[]): Box3 | null {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  const take = (a: Float64Array, add?: Float64Array) => {
    for (let i = 0; i + 2 < a.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        const v = a[i + c] + (add ? add[i + c] : 0)
        if (!Number.isFinite(v)) continue
        lo[c] = Math.min(lo[c], v)
        hi[c] = Math.max(hi[c], v)
      }
    }
  }
  for (const m of marks) {
    if (m.kind === 'arrows') {
      take(m.tails)
      take(m.tails, m.vectors)
    } else if (m.kind === 'boxes') {
      take(m.mins)
      take(m.maxs)
    } else {
      take(m.positions)
    }
  }
  if (!(lo[0] <= hi[0] && lo[1] <= hi[1] && lo[2] <= hi[2])) return null
  return { x: { min: lo[0], max: hi[0] }, y: { min: lo[1], max: hi[1] }, z: { min: lo[2], max: hi[2] } }
}

export function scene(marks: Mark[], options: { labels?: LabelAnchor[]; extent?: Box3 | null } = {}): SpaceScene {
  return {
    marks,
    labels: options.labels ?? [],
    colorScales: [],
    extent: options.extent === undefined ? plainExtent(marks) : options.extent,
    errors: [],
  }
}
