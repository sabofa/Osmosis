// Regions (S5, C1): "region: <domain>" shades the region on the floor, draws
// its boundary and reads its area; "R = region <domain>" names it and draws
// nothing. Every other S5 builder integrates over a region through
// prepareRegion2, so the domain rules are exactly S1's (K6, K10), through the
// same functions: iteratedSamples and inequalitySamples.
//
// An iterated region (type I, type II, polar) is the image of the unit square
// under S1's exact map. Its boundary is the image of the square's four sides,
// sampled at 256 segments each; a side that collapses (x = 1 where the inner
// bounds meet, the centre r = 0) is dropped, and so are two opposite sides
// whose images coincide (the seam of a full turn, theta = 0 and theta = 2 pi),
// which are interior. Integrals are integrate2's nested Gauss-Kronrod in the
// region's own coordinates, with the polar Jacobian |r| (times pi/180 for
// @angle: degrees). A region is a set: written high-to-low, its bounds give
// the same area.
//
// An inequality region is S1's grid-clipped mesh over the box, and its values
// are sums over that mesh — the area is the mesh's area, and an integral uses
// each triangle's edge midpoints (exact for quadratics). integrate2 cannot
// follow an implicit boundary, so these carry no quadrature estimate: they
// are taken as good to 1e-4 of the integral of |g| (MESH_REL), which prints 4
// significant digits of an area.

import type { Statement } from '../../../parser/types'
import { compileScalar } from '../../../math/compile'
import { integrate2 } from '../../../math/quadrature'
import type { Domain } from '../../grammar/types'
import type { LineMark, MeshMark } from '../../scene/types'
import { boxX, boxY, checkBudget, constant, lineStyle, Reads, resolution, SEGMENT_WIDTH } from '../common'
import { inequalitySamples, iteratedSamples, type DomainSamples, type IteratedSpec } from '../domain'
import { finishMesh } from '../mesh'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'
import { compileConditions } from '../surface'
import { approxText, COLLAPSED_REL, errorFloor, floorHeight, formOf, MESH_REL, part, readoutLabel, ROUNDING_REL, type Approx } from './common'
import { resolveDomain } from './named'

export const REGION_OPACITY = 0.35
export const BOUNDARY_SEGMENTS = 256
const DEFAULT_RES = 96

// A boundary piece: its vertices in (x, y), and in the region's own
// coordinates (a, b) — (x, y), or (r, theta).
export interface BoundaryPiece {
  xy: Float64Array
  ab: Float64Array
}

export interface RegionSample {
  // The floor mesh: (x, y), and (a, b) where the region is evaluated.
  samples: DomainSamples
  boundary: BoundaryPiece[]
  // The integral over the region of g, written in the region's coordinates,
  // its error floored by the integral of |g| (common.ts); `nonNegative` says
  // g >= 0, so that integral is the value itself.
  integrate(g: (a: number, b: number) => number, nonNegative?: boolean): Approx
  // (a, b) in the region's coordinates -> (x, y), into out[0..1].
  toXY(a: number, b: number, out: Float64Array): void
}

export interface PreparedRegion2 {
  coords: 'cartesian' | 'polar'
  // The region's own coordinate names: x and y, or r and theta.
  vars: readonly [string, string]
  build(n: number): RegionSample
}

function diagonal(pieces: readonly Float64Array[]): number {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const xy of pieces) {
    for (let i = 0; i + 1 < xy.length; i += 2) {
      if (!Number.isFinite(xy[i]) || !Number.isFinite(xy[i + 1])) continue
      x0 = Math.min(x0, xy[i])
      x1 = Math.max(x1, xy[i])
      y0 = Math.min(y0, xy[i + 1])
      y1 = Math.max(y1, xy[i + 1])
    }
  }
  return x1 >= x0 ? Math.hypot(x1 - x0, y1 - y0) : 0
}

function length(xy: Float64Array): number {
  let sum = 0
  for (let i = 2; i + 1 < xy.length; i += 2) sum += Math.hypot(xy[i] - xy[i - 2], xy[i + 1] - xy[i - 1])
  return sum
}

// Whether `a` traced forward is `b` traced backward, within `tol`.
function coincideReversed(a: Float64Array, b: Float64Array, tol: number): boolean {
  if (a.length !== b.length) return false
  const n = a.length / 2
  for (let k = 0; k < n; k++) {
    const j = n - 1 - k
    if (!(Math.hypot(a[2 * k] - b[2 * j], a[2 * k + 1] - b[2 * j + 1]) <= tol)) return false
  }
  return true
}

function iteratedRegion(spec: IteratedSpec, n: number): RegionSample {
  const samples = iteratedSamples(spec, n)
  const { outerRange, lo, hi, polar } = spec
  const a = outerRange.min
  const b = outerRange.max
  // (u, w) = (outer, inner) -> the region's coordinates (p, q).
  const swap = polar ? !polar.outerIsR : !spec.outerIsX
  const angle = polar ? polar.angle : 1
  const toXY = (p: number, q: number, out: Float64Array) => {
    if (polar) {
      out[0] = p * Math.cos(q * angle)
      out[1] = p * Math.sin(q * angle)
    } else {
      out[0] = p
      out[1] = q
    }
  }

  // The four sides of the unit square, in order round it.
  const m = BOUNDARY_SEGMENTS
  const side = (at: (k: number) => [number, number]): BoundaryPiece => {
    const xy = new Float64Array(2 * (m + 1))
    const ab = new Float64Array(2 * (m + 1))
    const out = new Float64Array(2)
    for (let k = 0; k <= m; k++) {
      const [u, w] = at(k / m)
      const p = swap ? w : u
      const q = swap ? u : w
      ab[2 * k] = p
      ab[2 * k + 1] = q
      toXY(p, q, out)
      xy[2 * k] = out[0]
      xy[2 * k + 1] = out[1]
    }
    return { xy, ab }
  }
  const u = (s: number) => a + (b - a) * s
  const sides = [
    side((s) => [u(s), lo(u(s))]),
    side((s) => [b, lo(b) + (hi(b) - lo(b)) * s]),
    side((s) => [u(1 - s), hi(u(1 - s))]),
    side((s) => [a, hi(a) + (lo(a) - hi(a)) * s]),
  ]
  const tol = COLLAPSED_REL * diagonal(sides.map((s) => s.xy))
  const keep = sides.map((s) => length(s.xy) > tol)
  for (const [i, j] of [
    [0, 2],
    [1, 3],
  ]) {
    if (keep[i] && keep[j] && coincideReversed(sides[i].xy, sides[j].xy, tol)) keep[i] = keep[j] = false
  }

  // Written high-to-low (either range), the iterated integral changes sign;
  // the region does not. The inner bounds never cross (iteratedSamples
  // refused that), so their order is one sign throughout.
  let inner = 0
  for (let k = 0; k <= n && inner === 0; k++) inner = Math.sign(hi(u(k / n)) - lo(u(k / n)))
  const orientation = Math.sign(b - a) * (inner || 1)

  return {
    samples,
    boundary: sides.filter((_, i) => keep[i]),
    toXY,
    integrate(g, nonNegative = false) {
      const at = (h: (p: number, q: number) => number) => (uu: number, ww: number) => {
        const p = swap ? ww : uu
        const q = swap ? uu : ww
        return polar ? h(p, q) * Math.abs(p) * angle : h(p, q)
      }
      const r = integrate2(at(g), a, b, lo, hi)
      const absolute = nonNegative ? r.value : integrate2(at((p, q) => Math.abs(g(p, q))), a, b, lo, hi).value
      return { value: orientation * r.value, error: errorFloor(r.error, absolute, ROUNDING_REL) }
    },
  }
}

// The boundary of a mesh: its edges used by one triangle, chained into
// polylines in the order the triangles list them.
function meshBoundary(samples: DomainSamples): BoundaryPiece[] {
  const { x, y, indices } = samples
  const count = new Map<string, number>()
  const key = (p: number, q: number) => (p < q ? `${p}:${q}` : `${q}:${p}`)
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const k = key(indices[t + e], indices[t + ((e + 1) % 3)])
      count.set(k, (count.get(k) ?? 0) + 1)
    }
  }
  const edges: [number, number][] = []
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const p = indices[t + e]
      const q = indices[t + ((e + 1) % 3)]
      if (p !== q && count.get(key(p, q)) === 1) edges.push([p, q])
    }
  }
  const at = new Map<number, number[]>()
  edges.forEach(([p, q], i) => {
    at.set(p, [...(at.get(p) ?? []), i])
    at.set(q, [...(at.get(q) ?? []), i])
  })
  const used = new Uint8Array(edges.length)
  const pieces: BoundaryPiece[] = []
  for (let first = 0; first < edges.length; first++) {
    if (used[first]) continue
    used[first] = 1
    const chain = [edges[first][0], edges[first][1]]
    for (;;) {
      const end = chain[chain.length - 1]
      const next = (at.get(end) ?? []).find((i) => !used[i])
      if (next === undefined) break
      used[next] = 1
      chain.push(edges[next][0] === end ? edges[next][1] : edges[next][0])
    }
    const xy = new Float64Array(2 * chain.length)
    chain.forEach((v, i) => {
      xy[2 * i] = x[v]
      xy[2 * i + 1] = y[v]
    })
    pieces.push({ xy, ab: xy })
  }
  return pieces
}

function inequalityRegion(samples: DomainSamples): RegionSample {
  const { x, y, indices } = samples
  return {
    samples,
    boundary: meshBoundary(samples),
    toXY(p, q, out) {
      out[0] = p
      out[1] = q
    },
    integrate(g) {
      let value = 0
      let absolute = 0
      for (let t = 0; t < indices.length; t += 3) {
        const [i, j, k] = [indices[t], indices[t + 1], indices[t + 2]]
        const area = Math.abs((x[j] - x[i]) * (y[k] - y[i]) - (x[k] - x[i]) * (y[j] - y[i])) / 2
        if (area === 0) continue
        const mids = [
          g((x[i] + x[j]) / 2, (y[i] + y[j]) / 2),
          g((x[j] + x[k]) / 2, (y[j] + y[k]) / 2),
          g((x[k] + x[i]) / 2, (y[k] + y[i]) / 2),
        ]
        value += (area * (mids[0] + mids[1] + mids[2])) / 3
        absolute += (area * (Math.abs(mids[0]) + Math.abs(mids[1]) + Math.abs(mids[2]))) / 3
      }
      return { value, error: errorFloor(null, absolute, MESH_REL) }
    },
  }
}

// A resolved (never named) domain, compiled once; build() samples it with the
// current parameter values. A rectangle ("for") is the iterated region with
// constant bounds.
export function prepareRegion2(domain: Domain, context: BuildContext, reads: Reads): PreparedRegion2 {
  const { scope, config } = context
  switch (domain.kind) {
    case 'rect':
      return prepareRegion2({ kind: 'iterated', coords: 'cartesian', outer: domain.x, inner: domain.y }, context, reads)
    case 'iterated': {
      const { outer, inner, coords } = domain
      const u0 = constant(outer.from, scope)
      const u1 = constant(outer.to, scope)
      const lo = compileScalar(inner.from, [outer.param], scope)
      const hi = compileScalar(inner.to, [outer.param], scope)
      reads.add(outer.from).add(outer.to).add(inner.from, [outer.param]).add(inner.to, [outer.param])
      const polar = coords === 'polar' ? { outerIsR: outer.param === 'r', angle: scope.angle === 'degrees' ? Math.PI / 180 : 1 } : null
      return {
        coords,
        vars: coords === 'polar' ? ['r', 'theta'] : ['x', 'y'],
        build: (n) =>
          iteratedRegion(
            { outer: outer.param, outerRange: { min: u0(), max: u1() }, lo: (u) => lo(u), hi: (u) => hi(u), polar, outerIsX: outer.param === 'x' },
            n,
          ),
      }
    }
    case 'inequality': {
      const conditions = compileConditions(domain.conditions, scope, reads)
      return { coords: 'cartesian', vars: ['x', 'y'], build: (n) => inequalityRegion(inequalitySamples(conditions, boxX(config), boxY(config), n)) }
    }
    case 'named':
      throw new Error(`the region "${domain.name}" is resolved before it is prepared`)
  }
}

// The region, flat on the floor at z = `z`.
export function floorMark(samples: DomainSamples, z: number, context: BuildContext, opacity: number, object: string): MeshMark | null {
  const count = samples.x.length
  const positions = new Float64Array(3 * count)
  const normals = new Float64Array(3 * count)
  const uv = new Float64Array(2 * count)
  for (let v = 0; v < count; v++) {
    positions[3 * v] = samples.x[v]
    positions[3 * v + 1] = samples.y[v]
    positions[3 * v + 2] = z
    normals[3 * v + 2] = 1
    uv[2 * v] = samples.x[v]
    uv[2 * v + 1] = samples.y[v]
  }
  const mesh = finishMesh({ positions, normals, uv, indices: samples.indices }, true)
  if (mesh.indices.length === 0) return null
  return {
    kind: 'mesh',
    source: { ...context.source, object },
    ...mesh,
    scalars: null,
    style: { color: context.color, opacity, colorScale: null, meshLines: null },
    pick: null,
  }
}

// Polylines in (x, y), lifted to z = `z`, as one LineMark.
export function boundaryMark(pieces: readonly BoundaryPiece[], z: number, context: BuildContext, object: string): LineMark | null {
  if (pieces.length === 0) return null
  const total = pieces.reduce((n, p) => n + p.xy.length / 2, 0)
  const positions = new Float64Array(3 * total)
  const starts = new Uint32Array(pieces.length)
  let v = 0
  pieces.forEach((piece, i) => {
    starts[i] = v
    for (let k = 0; k < piece.xy.length; k += 2) {
      positions[3 * v] = piece.xy[k]
      positions[3 * v + 1] = piece.xy[k + 1]
      positions[3 * v + 2] = z
      v++
    }
  })
  return { kind: 'lines', source: { ...context.source, object }, positions, starts, params: null, style: lineStyle(context.color, SEGMENT_WIDTH, false), pick: null }
}

// The mean of a mesh's vertices: where a readout is anchored.
export function meanVertex(mesh: MeshMark): [number, number, number] {
  const p = mesh.positions
  const n = p.length / 3
  let [x, y, z] = [0, 0, 0]
  for (let i = 0; i < p.length; i += 3) {
    x += p[i]
    y += p[i + 1]
    z += p[i + 2]
  }
  return [x / n, y / n, z / n]
}

function prepareRegion(statement: Statement, context: BuildContext): PreparedStatement {
  const form = formOf(statement, 'region')
  const { domain } = resolveDomain(context, form.domain)
  const n = resolution(form.style.res, context.config, DEFAULT_RES)
  checkBudget(2 * n * n, n)
  const reads = new Reads(context.scope)
  const region = prepareRegion2(domain, context, reads)
  const z = floorHeight(context.config)

  const build = (): BuildResult => {
    const r = region.build(n)
    const area = r.integrate(() => 1, true)
    const floor = floorMark(r.samples, z, context, form.style.opacity ?? REGION_OPACITY, context.source.object)
    const boundary = boundaryMark(r.boundary, z, context, part(context, 'boundary').object)
    const marks = [floor, boundary].filter((m) => m !== null)
    const anchor = floor ? meanVertex(floor) : ([0, 0, z] as const)
    return { marks, labels: [readoutLabel(context, anchor, `area ${approxText(area)}`)], errors: [], colorScale: null }
  }
  return { reads: reads.names, build }
}

// "R = region ...": compiled and sampled (so a bad bound is refused on its own
// line), and nothing drawn.
function prepareNamedRegion(statement: Statement, context: BuildContext): PreparedStatement {
  const form = formOf(statement, 'namedRegion')
  const { domain } = resolveDomain(context, form.domain)
  const reads = new Reads(context.scope)
  const region = prepareRegion2(domain, context, reads)
  return {
    reads: reads.names,
    build: () => {
      region.build(16)
      return { marks: [], labels: [], errors: [], colorScale: null }
    },
  }
}

export const REGION: BuilderEntry = { draws: true, prepare: prepareRegion }

export const NAMED_REGION: BuilderEntry = {
  draws: false,
  prepare: prepareNamedRegion,
  binds: (statement) => (statement.kind === 'space' && statement.form.form === 'namedRegion' ? statement.form.name : null),
}
