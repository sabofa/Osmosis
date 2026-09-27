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
// follow an implicit boundary. The region is meshed on its own box (a small
// disc gets the full resolution), samples are interior points (never on the
// boundary, where rounding can leave the region), and the error is the
// mesh's own: the larger of the changes from n/2 and from n/4, the measured
// gap between the boundary polygon and the curve, and rounding. A sum is
// refused as divergent only when its changes do not shrink, its peak |g|
// keeps growing, and the mesh is fine enough to tell.
//
// Every integral is budgeted (math/quadrature): one with no value — undefined
// at a node, or not settling — is refused with an IntegralRefusal naming where.

import type { Statement } from '../../../parser/types'
import { compileScalar } from '../../../math/compile'
import { coarse2, coarse3, gaussLegendre7, integrate2, integrate3 } from '../../../math/quadrature'
import { formatNumber, formatPoint } from '../../pick/format'
import type { Domain } from '../../grammar/types'
import type { LineMark, MeshMark, Range, SceneError } from '../../scene/types'
import { boxX, boxY, checkBudget, constant, lineStyle, Reads, resolution, SEGMENT_WIDTH } from '../common'
import { inequalitySamples, iteratedSamples, type Condition, type DomainSamples, type IteratedSpec } from '../domain'
import { finishMesh } from '../mesh'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'
import { compileConditions } from '../surface'
import {
  approxText,
  approxTextFull,
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
  type QuadLevel,
} from './common'
import { exprText } from './exprText'
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
  // An inequality region's own box, where it is meshed (the floor, the sums,
  // and a volume's top and bottom); null for an iterated region.
  box: { x: Range; y: Range } | null
  // The integral over the region of g, written in the region's coordinates,
  // its error floored by the integral of |g| (common.ts); `nonNegative` says
  // g >= 0, so that integral is the value itself. An integral with no value
  // throws an IntegralRefusal.
  integrate(g: (a: number, b: number) => number, nonNegative?: boolean): Approx
  // The triple integral of h(a, b, z) over the solid z from zlo(a, b) to
  // zhi(a, b) above the region (a volume under or between surfaces).
  integrateSolid(
    h: (a: number, b: number, z: number) => number,
    zlo: (a: number, b: number) => number,
    zhi: (a: number, b: number) => number,
    zText: readonly [string, string],
  ): Approx
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

function iteratedRegion(spec: IteratedSpec, n: number, m: number, levels: readonly QuadLevel[]): RegionSample {
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
    box: null,
    toXY,
    integrate(g, nonNegative = false) {
      const r = quadrature(levels, () => integrate2(inUW(g), a, b, lo, hi))
      const absolute = nonNegative ? Math.abs(r.value) : scale(() => coarse2(inUW((p, q) => Math.abs(g(p, q))), a, b, lo, hi))
      return { value: orientation * r.value, error: errorFloor(r.error, absolute, ROUNDING_REL) }
    },
    integrateSolid(h, zlo, zhi, zText) {
      const at = <T>(k: (p: number, q: number) => T) => (uu: number, ww: number) => (swap ? k(ww, uu) : k(uu, ww))
      const F = (uu: number, ww: number, z: number) => {
        const p = swap ? ww : uu
        const q = swap ? uu : ww
        return h(p, q, z) * jacobian(p)
      }
      const r = quadrature([...levels, { name: 'z', lower: zText[0], upper: zText[1] }], () => integrate3(F, a, b, lo, hi, at(zlo), at(zhi)))
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

// A mesh sum is too coarse to judge its own convergence below this many
// cells a side at its coarsest comparison (n/4 on the fitted grid).
const SETTLE_MIN_CELLS = 8
// Divergence needs three things together: the changes between successive
// resolutions do not shrink (each at least this fraction of the one before —
// twice running when the n/8 mesh is fine enough to count; a convergent
// sum's shrink by 2 to 4, a log-divergent one's hold steady), the largest |g|
// at the samples keeps growing (by this factor at each refinement), and the
// change is not negligible.
const SETTLE_RATIO = 0.9
const PEAK_GROWTH = 1.5
// A mesh sum is good to no better than this fraction of the integral of |g|:
// its boundary vertices are bisected onto the curve to BISECTION_REL of an
// edge.
const MESH_ROUNDING_REL = 1e-9

// The degree-2 rule at interior points (barycentric 2/3, 1/6, 1/6), so a
// sample never sits on the boundary, where rounding can put it just outside
// (sqrt(1 - x^2 - y^2) at a chord's midpoint went NaN).
const INTERIOR: readonly [number, number, number][] = [
  [2 / 3, 1 / 6, 1 / 6],
  [1 / 6, 2 / 3, 1 / 6],
  [1 / 6, 1 / 6, 2 / 3],
]

interface MeshSum {
  value: number
  // Σ area × |g|, for the rounding floor.
  absolute: number
  // The largest |g| at any sample: evidence of an unbounded integrand, and the
  // scale of the boundary's floor.
  peak: number
  // Area whose samples all fell just outside the region (slivers at a
  // concave boundary): counted in the error, not the value.
  lost: number
}

// Σ over the mesh's triangles of area × the mean of `at` at the interior
// points. A sample where `at` is not a number is refused when it lies in the
// region; one just outside it (by rounding, at a concave boundary) falls back
// to the triangle's centroid. An infinity is divergence there.
function meshSum(samples: DomainSamples, at: (x: number, y: number) => number, inside: (x: number, y: number) => boolean): MeshSum {
  const { x, y, indices } = samples
  const sum: MeshSum = { value: 0, absolute: 0, peak: 0, lost: 0 }
  const sample = (px: number, py: number): number => {
    const v = at(px, py)
    if (Number.isNaN(v)) {
      if (inside(px, py)) throw new IntegralRefusal(`the integral is undefined: the integrand is not a number at (x, y) = ${formatPoint([px, py])}`)
      return Number.NaN
    }
    if (!Number.isFinite(v)) throw new IntegralRefusal(`the integral does not converge: it grows without bound near (x, y) = ${formatPoint([px, py])}`)
    return v
  }
  for (let t = 0; t < indices.length; t += 3) {
    const [i, j, k] = [indices[t], indices[t + 1], indices[t + 2]]
    const area = Math.abs((x[j] - x[i]) * (y[k] - y[i]) - (x[k] - x[i]) * (y[j] - y[i])) / 2
    if (area === 0) continue
    let values = INTERIOR.map(([a, b, c]) => sample(a * x[i] + b * x[j] + c * x[k], a * y[i] + b * y[j] + c * y[k]))
    if (values.some(Number.isNaN)) {
      const centre = sample((x[i] + x[j] + x[k]) / 3, (y[i] + y[j] + y[k]) / 3)
      if (Number.isNaN(centre)) {
        sum.lost += area
        continue
      }
      values = values.map((v) => (Number.isNaN(v) ? centre : v))
    }
    for (const v of values) {
      sum.value += (area * v) / 3
      sum.absolute += (area * Math.abs(v)) / 3
      sum.peak = Math.max(sum.peak, Math.abs(v))
    }
  }
  return sum
}

// The area between the mesh's boundary polygon and the region: each chord's
// gap to its curve, measured by bisection along the chord's normal on the
// condition nearest zero at its midpoint, summed as (2/3) L s (a parabolic
// cap). A chord on the box's edge, or on a straight boundary, has none.
function boundaryGap(pieces: readonly BoundaryPiece[], conditions: readonly Condition[]): number {
  let total = 0
  for (const { xy } of pieces) {
    for (let k = 0; k + 3 < xy.length; k += 2) {
      const [px, py, qx, qy] = [xy[k], xy[k + 1], xy[k + 2], xy[k + 3]]
      const L = Math.hypot(qx - px, qy - py)
      if (!(L > 0)) continue
      const [mx, my] = [(px + qx) / 2, (py + qy) / 2]
      // outward, for a counter-clockwise piece
      const [nx, ny] = [(qy - py) / L, -(qx - px) / L]
      let active: Condition | null = null
      let nearest = -Infinity
      for (const c of conditions) {
        const h = c.h(mx, my)
        if (Number.isFinite(h) && h > nearest) [active, nearest] = [c, h]
      }
      if (!active) continue
      const H = (s: number) => active!.h(mx + s * nx, my + s * ny)
      // Inside at the midpoint: the curve lies outward; outside: inward.
      const far = nearest <= 0 ? L : -L
      if ((H(far) <= 0) === (nearest <= 0)) continue
      let [lo, hi] = [0, far]
      for (let step = 0; step < 50 && lo !== hi; step++) {
        const s = (lo + hi) / 2
        if ((H(s) <= 0) === (nearest <= 0)) lo = s
        else hi = s
      }
      total += (2 / 3) * L * Math.abs(lo)
    }
  }
  return total
}

// The region's own box on the grid of `box`: the extent of what a first
// meshing at n finds, one cell wider each way, within the box. A small region
// then gets the full resolution. Nothing found is refused.
function fittedBox(conditions: readonly Condition[], box: { x: Range; y: Range }, n: number): { x: Range; y: Range } {
  const probe = inequalitySamples(conditions, box.x, box.y, n)
  if (probe.indices.length === 0) throw new Error('the region is empty or too small to find at this resolution; raise res:')
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity]
  for (const v of probe.indices) {
    x0 = Math.min(x0, probe.x[v])
    x1 = Math.max(x1, probe.x[v])
    y0 = Math.min(y0, probe.y[v])
    y1 = Math.max(y1, probe.y[v])
  }
  const cx = (box.x.max - box.x.min) / n
  const cy = (box.y.max - box.y.min) / n
  return {
    x: { min: Math.max(box.x.min, x0 - cx), max: Math.min(box.x.max, x1 + cx) },
    y: { min: Math.max(box.y.min, y0 - cy), max: Math.min(box.y.max, y1 + cy) },
  }
}

function inequalityRegion(conditions: readonly Condition[], box: { x: Range; y: Range }, n: number): RegionSample {
  const fitted = fittedBox(conditions, box, n)
  const samplesAt = (res: number) => inequalitySamples(conditions, fitted.x, fitted.y, res)
  const samples = samplesAt(n)
  const boundary = meshBoundary(samples)
  const inside = (px: number, py: number) => conditions.every((c) => c.h(px, py) <= 0)
  // The mesh at n, n/2, n/4 and n/8 on the fitted grid: the value is the sum
  // at n; its error the larger of the last two changes, the boundary's gap,
  // and rounding; a sum refused only on real evidence of divergence.
  const resolutions = [n, n / 2, n / 4, n / 8].map((r) => Math.max(2, Math.round(r)))
  const meshes: DomainSamples[] = [samples]
  const meshAt = (i: number) => (meshes[i] ??= samplesAt(resolutions[i]))
  let gap: number | null = null
  const settle = (at: (x: number, y: number) => number): Approx => {
    const sums = [0, 1, 2, 3].map((i) => meshSum(meshAt(i), at, inside))
    const [A, B, C, D] = sums
    const [d1, d2, d3] = [Math.abs(A.value - B.value), Math.abs(B.value - C.value), Math.abs(C.value - D.value)]
    const twice = resolutions[3] >= SETTLE_MIN_CELLS
    const growing = d1 >= SETTLE_RATIO * d2 && (!twice || d2 >= SETTLE_RATIO * d3) && d1 > MESH_ROUNDING_REL * A.absolute
    const unbounded = A.peak > PEAK_GROWTH * B.peak && B.peak > PEAK_GROWTH * C.peak
    if (resolutions[2] >= SETTLE_MIN_CELLS && growing && unbounded) {
      const values = [D, C, B, A].map((s) => formatNumber(s.value)).join(', ')
      throw new IntegralRefusal(
        `the integral does not converge: its sum over the mesh grows as the mesh refines (${values} at res ${[...resolutions].reverse().join(', ')})`,
      )
    }
    gap ??= boundaryGap(boundary, conditions)
    return { value: A.value, error: Math.max(d1, d2, gap * A.peak, A.lost * A.peak, MESH_ROUNDING_REL * A.absolute) }
  }
  return {
    samples,
    boundary,
    box: fitted,
    toXY(p, q, out) {
      out[0] = p
      out[1] = q
    },
    integrate: (g) => settle(g),
    // The z integral at each sample by the 7-point Gauss rule (exact for
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
            [
              { name: outer.param, lower: exprText(outer.from), upper: exprText(outer.to) },
              { name: inner.param, lower: exprText(inner.from), upper: exprText(inner.to) },
            ],
          ),
      }
    }
    case 'inequality': {
      const conditions = compileConditions(domain.conditions, scope, reads)
      return {
        coords: 'cartesian',
        vars: ['x', 'y'],
        build: (n) => inequalityRegion(conditions, { x: boxX(config), y: boxY(config) }, n),
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

  const build = (): BuildResult => {
    const z = floorHeight(context)
    const r = region.build(n)
    const errors: SceneError[] = []
    const area = attempt(context, errors, () => r.integrate(() => 1, true))
    const floor = floorMark(r.samples, z, context, form.style.opacity ?? REGION_OPACITY, context.source.object)
    const boundary = boundaryMark(r.boundary, z, context, part(context, 'boundary').object)
    const marks = [floor, boundary].filter((m) => m !== null)
    const labels = area
      ? [readoutLabel(context, boundaryAnchor(r.boundary, z), `area ${approxText(area)}`, `area ${approxTextFull(area)}`)]
      : []
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
