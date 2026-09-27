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
// follow an implicit boundary, so their error is the mesh's own: the change
// in the sum from half the resolution, |A(n) - A(n/2)|, which bounds the
// digits shown. A sum that does not settle as the mesh refines (from n/4 to
// n/2 to n) is refused as an integral that does not converge.
//
// Every integral is budgeted (math/quadrature): one with no value — undefined
// at a node, or not settling — is refused with an IntegralRefusal naming where.

import type { Statement } from '../../../parser/types'
import { compileScalar } from '../../../math/compile'
import { coarse2, coarse3, gaussLegendre7, integrate2, integrate3 } from '../../../math/quadrature'
import { formatNumber, formatPoint } from '../../pick/format'
import type { Domain } from '../../grammar/types'
import type { LineMark, MeshMark, SceneError } from '../../scene/types'
import { boxX, boxY, checkBudget, constant, lineStyle, Reads, resolution, SEGMENT_WIDTH } from '../common'
import { inequalitySamples, iteratedSamples, type DomainSamples, type IteratedSpec } from '../domain'
import { finishMesh } from '../mesh'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'
import { compileConditions } from '../surface'
import {
  approxText,
  attempt,
  COLLAPSED_REL,
  errorFloor,
  floorHeight,
  formOf,
  IntegralRefusal,
  part,
  quadrature,
  readoutLabel,
  ROUNDING_REL,
  type Approx,
} from './common'
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
  // Counter-clockwise, the region on the left of each piece.
  boundary: BoundaryPiece[]
  // The integral over the region of g, written in the region's coordinates,
  // its error floored by the integral of |g| (common.ts); `nonNegative` says
  // g >= 0, so that integral is the value itself. An integral with no value
  // throws an IntegralRefusal.
  integrate(g: (a: number, b: number) => number, nonNegative?: boolean): Approx
  // The triple integral of h(a, b, z) over the solid z from zlo(a, b) to
  // zhi(a, b) above the region (a volume under or between surfaces).
  integrateSolid(h: (a: number, b: number, z: number) => number, zlo: (a: number, b: number) => number, zhi: (a: number, b: number) => number): Approx
  // (a, b) in the region's coordinates -> (x, y), into out[0..1].
  toXY(a: number, b: number, out: Float64Array): void
}

export interface PreparedRegion2 {
  coords: 'cartesian' | 'polar'
  // The region's own coordinate names: x and y, or r and theta.
  vars: readonly [string, string]
  // Sampled at n cells a side, its boundary at `sides` segments a side (an
  // iterated region; a volume passes n, so its walls meet its top and bottom
  // vertex for vertex).
  build(n: number, sides?: number): RegionSample
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

function reversePairs(p: Float64Array): Float64Array {
  const out = new Float64Array(p.length)
  const n = p.length / 2
  for (let k = 0; k < n; k++) {
    out[2 * k] = p[2 * (n - 1 - k)]
    out[2 * k + 1] = p[2 * (n - 1 - k) + 1]
  }
  return out
}

// A fixed-cost scale for an error floor: the value when finite, else 0.
function scale(estimate: () => number): number {
  const v = estimate()
  return Number.isFinite(v) ? Math.abs(v) : 0
}

function iteratedRegion(spec: IteratedSpec, n: number, m: number, levels: readonly string[]): RegionSample {
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

  // The perimeter of the unit square, in grid steps of 1/m, computed exactly
  // as iteratedSamples places grid vertex (i, j), so a side sampled at m = n
  // is the surface's own edge, vertex for vertex.
  const point = (i: number, j: number): [number, number] => {
    const u = a + (b - a) * (i / m)
    const g1 = lo(u)
    return [u, g1 + (hi(u) - g1) * (j / m)]
  }
  const side = (at: (k: number) => [number, number]): BoundaryPiece => {
    const xy = new Float64Array(2 * (m + 1))
    const ab = new Float64Array(2 * (m + 1))
    const out = new Float64Array(2)
    for (let k = 0; k <= m; k++) {
      const [u, w] = at(k)
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
  let sides = [side((k) => point(k, 0)), side((k) => point(m, k)), side((k) => point(m - k, m)), side((k) => point(0, m - k))]
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
  for (let k = 0; k <= n && inner === 0; k++) {
    const u = a + (b - a) * (k / n)
    inner = Math.sign(hi(u) - lo(u))
  }
  const orientation = Math.sign(b - a) * (inner || 1)
  // The square's perimeter runs counter-clockwise in (u, w); in the plane it
  // does too unless the map reflects: (u, w) swapped, or a range reversed.
  if (orientation * (swap ? -1 : 1) < 0) sides = sides.map((s) => ({ xy: reversePairs(s.xy), ab: reversePairs(s.ab) }))

  const jacobian = (p: number) => (polar ? Math.abs(p) * angle : 1)
  const inUW = (h: (p: number, q: number) => number) => (uu: number, ww: number) => {
    const p = swap ? ww : uu
    const q = swap ? uu : ww
    return h(p, q) * jacobian(p)
  }
  return {
    samples,
    boundary: sides.filter((_, i) => keep[i]),
    toXY,
    integrate(g, nonNegative = false) {
      const r = quadrature(levels, () => integrate2(inUW(g), a, b, lo, hi))
      const absolute = nonNegative ? Math.abs(r.value) : scale(() => coarse2(inUW((p, q) => Math.abs(g(p, q))), a, b, lo, hi))
      return { value: orientation * r.value, error: errorFloor(r.error, absolute, ROUNDING_REL) }
    },
    integrateSolid(h, zlo, zhi) {
      const at = <T>(k: (p: number, q: number) => T) => (uu: number, ww: number) => (swap ? k(ww, uu) : k(uu, ww))
      const F = (uu: number, ww: number, z: number) => {
        const p = swap ? ww : uu
        const q = swap ? uu : ww
        return h(p, q, z) * jacobian(p)
      }
      const r = quadrature([...levels, 'z'], () => integrate3(F, a, b, lo, hi, at(zlo), at(zhi)))
      const absolute = scale(() => coarse3((uu, ww, z) => Math.abs(F(uu, ww, z)), a, b, lo, hi, at(zlo), at(zhi)))
      return { value: orientation * r.value, error: errorFloor(r.error, absolute, ROUNDING_REL) }
    },
  }
}

// The boundary of a mesh: its edges used by one triangle, chained into
// polylines along their own direction. The mesh's triangles wind counter-
// clockwise, so every loop runs with the region on its left.
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
  const from = new Map<number, number[]>()
  edges.forEach(([p], i) => from.set(p, [...(from.get(p) ?? []), i]))
  const used = new Uint8Array(edges.length)
  const pieces: BoundaryPiece[] = []
  for (let first = 0; first < edges.length; first++) {
    if (used[first]) continue
    used[first] = 1
    const chain = [edges[first][0], edges[first][1]]
    for (;;) {
      const next = (from.get(chain[chain.length - 1]) ?? []).find((i) => !used[i])
      if (next === undefined) break
      used[next] = 1
      chain.push(edges[next][1])
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

// Resolutions below which a mesh sum is too coarse to judge its own
// convergence (a disc a few cells across).
const SETTLE_MIN_RES = 32
// A sum has not settled when refining once more shrinks its change by less
// than this factor while the change is still this fraction of the integral
// of |g| (a sum converging at order 1 or better at least halves it).
const SETTLE_RATIO = 0.75
const SETTLE_REL = 1e-2

interface MeshSum {
  value: number
  absolute: number
}

// Σ over the mesh's triangles of area × the mean of `at` at the three edge
// midpoints (exact for quadratics); refused where `at` is not a number.
function meshSum(samples: DomainSamples, at: (x: number, y: number) => number): MeshSum {
  const { x, y, indices } = samples
  let value = 0
  let absolute = 0
  const mid = (p: number, q: number) => {
    const [mx, my] = [(x[p] + x[q]) / 2, (y[p] + y[q]) / 2]
    const v = at(mx, my)
    if (!Number.isFinite(v)) throw new IntegralRefusal(`the integral is undefined: the integrand is not a number at (x, y) = ${formatPoint([mx, my])}`)
    return v
  }
  for (let t = 0; t < indices.length; t += 3) {
    const [i, j, k] = [indices[t], indices[t + 1], indices[t + 2]]
    const area = Math.abs((x[j] - x[i]) * (y[k] - y[i]) - (x[k] - x[i]) * (y[j] - y[i])) / 2
    if (area === 0) continue
    const [m1, m2, m3] = [mid(i, j), mid(j, k), mid(k, i)]
    value += (area * (m1 + m2 + m3)) / 3
    absolute += (area * (Math.abs(m1) + Math.abs(m2) + Math.abs(m3))) / 3
  }
  return { value, absolute }
}

function inequalityRegion(samplesAt: (n: number) => DomainSamples, n: number): RegionSample {
  const samples = samplesAt(n)
  // The mesh at n, n/2 and n/4: the value is the sum at n, its error the
  // change from n/2, and a change that does not shrink is a sum that does not
  // settle (an integral that diverges).
  const resolutions = [n, Math.max(2, Math.round(n / 2)), Math.max(2, Math.round(n / 4))]
  const meshes: DomainSamples[] = [samples]
  const meshAt = (i: number) => (meshes[i] ??= samplesAt(resolutions[i]))
  const settle = (at: (x: number, y: number) => number): Approx => {
    const [A, B, C] = [0, 1, 2].map((i) => meshSum(meshAt(i), at))
    const d1 = Math.abs(A.value - B.value)
    const d2 = Math.abs(B.value - C.value)
    if (n >= SETTLE_MIN_RES && d1 > SETTLE_RATIO * d2 && d1 > SETTLE_REL * A.absolute) {
      const sums = [C, B, A].map((s) => formatNumber(s.value)).join(', ')
      throw new IntegralRefusal(
        `the integral does not converge: its sum over the mesh does not settle as the mesh refines (${sums} at res ${[...resolutions].reverse().join(', ')})`,
      )
    }
    return { value: A.value, error: errorFloor(d1, A.absolute, ROUNDING_REL) }
  }
  return {
    samples,
    boundary: meshBoundary(samples),
    toXY(p, q, out) {
      out[0] = p
      out[1] = q
    },
    integrate: (g) => settle(g),
    // The z integral at each midpoint by the 7-point Gauss rule (exact for
    // polynomials of degree 13 in z); the mesh's own error dominates.
    integrateSolid: (h, zlo, zhi) => settle((x, y) => gaussLegendre7((z) => h(x, y, z), zlo(x, y), zhi(x, y))),
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
        build: (n, sides = BOUNDARY_SEGMENTS) =>
          iteratedRegion(
            { outer: outer.param, outerRange: { min: u0(), max: u1() }, lo: (u) => lo(u), hi: (u) => hi(u), polar, outerIsX: outer.param === 'x' },
            n,
            sides,
            [outer.param, inner.param],
          ),
      }
    }
    case 'inequality': {
      const conditions = compileConditions(domain.conditions, scope, reads)
      return {
        coords: 'cartesian',
        vars: ['x', 'y'],
        build: (n) => inequalityRegion((res) => inequalitySamples(conditions, boxX(config), boxY(config), res), n),
      }
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

// Where a region's readout is anchored: halfway along its longest boundary
// piece, on the region's edge — clear of anything drawn at its centre (a
// centroid), and of the box's corners, where the tick labels are.
export function boundaryAnchor(pieces: readonly BoundaryPiece[], z: number): [number, number, number] {
  let longest: Float64Array | null = null
  let most = -1
  for (const { xy } of pieces) {
    const l = length(xy)
    if (l > most) [longest, most] = [xy, l]
  }
  if (!longest || !(most > 0)) return longest ? [longest[0], longest[1], z] : [0, 0, z]
  let run = 0
  for (let k = 2; k + 1 < longest.length; k += 2) {
    run += Math.hypot(longest[k] - longest[k - 2], longest[k + 1] - longest[k - 1])
    if (run >= most / 2) return [longest[k], longest[k + 1], z]
  }
  return [longest[longest.length - 2], longest[longest.length - 1], z]
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
    const errors: SceneError[] = []
    const area = attempt(context, errors, () => r.integrate(() => 1, true))
    const floor = floorMark(r.samples, z, context, form.style.opacity ?? REGION_OPACITY, context.source.object)
    const boundary = boundaryMark(r.boundary, z, context, part(context, 'boundary').object)
    const marks = [floor, boundary].filter((m) => m !== null)
    const labels = area ? [readoutLabel(context, boundaryAnchor(r.boundary, z), `area ${approxText(area)}`)] : []
    return { marks, labels, errors, colorScale: null }
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
