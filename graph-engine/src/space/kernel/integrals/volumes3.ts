// Triple-integral regions (S5, C4):
//
//   volume: x in [0, 1], y in [0, 1 - x], z in [0, 1 - x - y]
//   volume: r in [0, 2], theta in [0, 2*pi], z in [0, 4 - r^2] cylindrical
//   volume: rho in [0, 2], phi in [0, pi/4], theta in [0, 2*pi] spherical
//   volume: ... integrand <expr>          the triple integral of <expr> instead of the volume
//
// The grammar orders the ranges outer to inner from their dependencies. The
// region is the exact image of the unit cube under
//   Phi(s, t, w): u = a + (b - a) s, v = c(u) + (d(u) - c(u)) t,
//                 q = e(u, v) + (g(u, v) - e(u, v)) w,
// then the coordinate map to Cartesian, composed symbolically so the face
// normals are exact (d Phi / d s and the others, from math/diff).
//
// Drawn: the cube's six faces, mapped, each a parametric patch (48 cells a
// side unless res: says), translucent at 0.4, normals outward. A face is
// dropped when
// - its area is at most 1e-9 of the solid's diagonal squared (collapsed: a
//   bound that meets itself, r = 0, rho = 0, phi = 0), or
// - it coincides with the opposite face, sample for sample (interior: theta
//   spanning exactly 2 pi, whose faces theta = 0 and theta = 2 pi are the same
//   half-plane). Both faces of such a pair go.
// Edges are the cube's twelve, mapped, where they have length, are not on an
// interior face, and do not repeat one already drawn (a collapsed face's two
// edges on one rim).
//
// The readout is integrate3 over the ranges in their order, with the
// coordinate Jacobian |r| or rho^2 |sin phi| (times pi/180 per angle under
// @angle: degrees). A region is a set: written high-to-low, a range gives the
// same value. Inner bounds that cross are refused.

import type { Expr } from '../../../parser/types'
import { compileMany, compileScalar } from '../../../math/compile'
import { diff } from '../../../math/diff'
import { add, call, mul, num, pow, sub, substitute, variable } from '../../../math/expr'
import { integrate3 } from '../../../math/quadrature'
import { simplify } from '../../../math/simplify'
import type { Coordinates3, VolumeSolid } from '../../grammar/keywords/integrals'
import type { SpaceStyle } from '../../grammar/types'
import type { LineMark, MeshMark, SceneError } from '../../scene/types'
import { boundNames, checkBudget, constant, lineStyle, Reads, resolution } from '../common'
import { finishMesh, gridIndices, reversedWinding } from '../mesh'
import type { BuildContext, BuildResult, PreparedStatement } from '../registry'
import { approxText, attempt, COLLAPSED_REL, determined, errorFloor, part, quadrature, readoutLabel, ROUNDING_REL, type Approx } from './common'
import { exprText } from './exprText'
import { targetText } from './target'

type Iterated = Extract<VolumeSolid, { kind: 'iterated' }>

export const SOLID_OPACITY = 0.4
// Two bounds within this fraction of their size of each other meet.
const MEET_REL = 1e-9
const FACE_RES = 48
const EDGE_SEGMENTS = 128
const EDGE_WIDTH = 1.5

// x, y, z in the system's own variables.
export function cartesian(coords: Coordinates3, v: (name: string) => Expr): [Expr, Expr, Expr] {
  switch (coords) {
    case 'rectangular':
      return [v('x'), v('y'), v('z')]
    case 'cylindrical':
      return [mul(v('r'), call('cos', v('theta'))), mul(v('r'), call('sin', v('theta'))), v('z')]
    case 'spherical': {
      const s = mul(v('rho'), call('sin', v('phi')))
      return [mul(s, call('cos', v('theta'))), mul(s, call('sin', v('theta'))), mul(v('rho'), call('cos', v('phi')))]
    }
  }
}

// |dV / (d outer d middle d inner)|; `k` is radians per angle unit.
function jacobian(coords: Coordinates3, k: number): Expr {
  switch (coords) {
    case 'rectangular':
      return num(1)
    case 'cylindrical':
      return mul(call('abs', variable('r')), num(k))
    case 'spherical':
      return mul(mul(pow(variable('rho'), num(2)), call('abs', call('sin', variable('phi')))), num(k * k))
  }
}

const XYZ = ['x', 'y', 'z']

// Something that integrates over a solid: every expression compiled once,
// all integrated together with the current parameter values, each error
// floored by the integral of |expr| (common.ts).
export interface PreparedSolid {
  integrals(exprs: readonly Expr[]): () => Approx[]
}

// Whether an integrand is written so it cannot be negative (1, or |...|), so
// the integral of its absolute value is itself.
export function nonNegative(expr: Expr): boolean {
  return (expr.kind === 'num' && expr.value >= 0) || (expr.kind === 'call' && expr.name === 'abs')
}

// The sign an iterated integral carries from ranges written high-to-low, and
// the refusal of inner bounds that cross, from a grid of samples.
function orientation(solid: Iterated, a: number, b: number, c: (u: number) => number, d: (u: number) => number, e: (u: number, v: number) => number, g: (u: number, v: number) => number, n = 32): number {
  const [outer, middle, inner] = solid.order
  const signs = { middle: new Set<number>(), inner: new Set<number>() }
  for (let i = 0; i <= n; i++) {
    const u = a + ((b - a) * i) / n
    const [lo, hi] = [c(u), d(u)]
    // Bounds that meet (within rounding of their size) are not crossing: at
    // the rim of a cone in a sphere, sqrt(x^2 + y^2) and sqrt(2 - x^2 - y^2)
    // meet, and rounding gives either sign.
    const meets = (p: number, q: number) => Math.abs(q - p) <= MEET_REL * Math.max(Math.abs(p), Math.abs(q), 1)
    if (Number.isFinite(hi - lo) && !meets(lo, hi)) signs.middle.add(Math.sign(hi - lo))
    for (let j = 0; j <= n; j++) {
      const v = lo + ((hi - lo) * j) / n
      const [zlo, zhi] = [e(u, v), g(u, v)]
      if (Number.isFinite(zhi - zlo) && !meets(zlo, zhi)) signs.inner.add(Math.sign(zhi - zlo))
    }
  }
  if (signs.middle.size > 1) throw new Error(`the bounds of ${middle.param} cross as ${outer.param} runs over its range — split the region where they meet`)
  if (signs.inner.size > 1) throw new Error(`the bounds of ${inner.param} cross inside the region — split it where they meet`)
  const first = (set: Set<number>) => set.values().next().value ?? 1
  return (Math.sign(b - a) || 1) * first(signs.middle) * first(signs.inner)
}

export function prepareIteratedSolid(solid: Iterated, context: BuildContext, reads: Reads): PreparedSolid {
  const { scope } = context
  const [O, M, I] = solid.order
  reads.add(O.from).add(O.to).add(M.from, [O.param]).add(M.to, [O.param]).add(I.from, [O.param, M.param]).add(I.to, [O.param, M.param])
  const a = constant(O.from, scope)
  const b = constant(O.to, scope)
  const c = compileScalar(M.from, [O.param], scope)
  const d = compileScalar(M.to, [O.param], scope)
  const e = compileScalar(I.from, [O.param, M.param], scope)
  const g = compileScalar(I.to, [O.param, M.param], scope)
  const k = scope.angle === 'degrees' ? Math.PI / 180 : 1
  const xyz = cartesian(solid.coords, variable)
  const toSystem = new Map(XYZ.map((name, i) => [name, xyz[i]]))
  const jac = jacobian(solid.coords, k)
  const vars = [O.param, M.param, I.param]
  const levels = solid.order.map((r) => ({ name: r.param, lower: exprText(r.from), upper: exprText(r.to) }))
  return {
    integrals(exprs) {
      const fs = exprs.map((expr) => {
        reads.add(expr, [...XYZ, ...vars])
        const inSystem = solid.coords === 'rectangular' ? expr : substitute(expr, toSystem)
        return { f: compileScalar(mul(inSystem, jac), vars, scope), positive: nonNegative(expr) }
      })
      return () => {
        const [aa, bb] = [a(), b()]
        const cc = (u: number) => c(u)
        const dd = (u: number) => d(u)
        const ee = (u: number, v: number) => e(u, v)
        const gg = (u: number, v: number) => g(u, v)
        const sign = orientation(solid, aa, bb, cc, dd, ee, gg)
        return fs.map(({ f }) => {
          const r = quadrature(levels, () => integrate3((u, v, w) => f(u, v, w), aa, bb, cc, dd, ee, gg))
          return { value: sign * r.value, error: errorFloor(r.error, r.absolute, ROUNDING_REL, r.singular), scale: r.absolute, singular: r.singular }
        })
      }
    },
  }
}

// Phi and its three partials, compiled in one program: x y z, then d/ds,
// d/dt, d/dw, each xyz.
function compileMap(solid: Iterated, context: BuildContext) {
  const [O, M, I] = solid.order
  const [S, T, W] = boundNames(3).map(variable)
  const U = add(O.from, mul(sub(O.to, O.from), S))
  const outer = new Map([[O.param, U]])
  const c = substitute(M.from, outer)
  const d = substitute(M.to, outer)
  const V = add(c, mul(sub(d, c), T))
  const both = new Map([
    [O.param, U],
    [M.param, V],
  ])
  const e = substitute(I.from, both)
  const g = substitute(I.to, both)
  const Q = add(e, mul(sub(g, e), W))
  const values = new Map([...both, [I.param, Q]])
  const xyz = cartesian(solid.coords, (name) => values.get(name) ?? variable(name))
  const partials = boundNames(3).flatMap((p) => xyz.map((x) => simplify(diff(x, p, context.scope))))
  return compileMany([...xyz, ...partials], boundNames(3), context.scope)
}

// The two free parameters of face 2p + v, in the cyclic order whose cross
// product points along +p.
const FREE: readonly [number, number][] = [
  [1, 2],
  [2, 0],
  [0, 1],
]

function area(positions: Float64Array, indices: Uint32Array): number {
  let sum = 0
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [3 * indices[t], 3 * indices[t + 1], 3 * indices[t + 2]]
    const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]]
    const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]]
    sum += Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2
  }
  return sum
}

function maxDistance(a: Float64Array, b: Float64Array): number {
  let worst = 0
  for (let i = 0; i < a.length; i += 3) {
    const dist = Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2])
    if (!(dist <= worst)) worst = dist
  }
  return worst
}

function reversed(p: Float64Array): Float64Array {
  const out = new Float64Array(p.length)
  const n = p.length / 3
  for (let i = 0; i < n; i++) out.set(p.subarray(3 * (n - 1 - i), 3 * (n - i)), 3 * i)
  return out
}

function length(p: Float64Array): number {
  let sum = 0
  for (let i = 3; i < p.length; i += 3) sum += Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2], p[i + 2] - p[i - 1])
  return sum
}

export function prepareIterated(context: BuildContext, solid: Iterated, style: SpaceStyle, name: string | null): PreparedStatement {
  const n = resolution(style.res, context.config, FACE_RES)
  checkBudget(12 * n * n, n)
  const reads = new Reads(context.scope)
  const measure = prepareIteratedSolid(solid, context, reads).integrals([solid.integrand?.expr ?? num(1)])
  const map = compileMap(solid, context)
  const opacity = style.opacity ?? SOLID_OPACITY
  const label = `∭${name ? `_${name}` : ''} ${solid.integrand ? `${targetText(solid.integrand)} ` : ''}dV`

  const build = (): BuildResult => {
    const errors: SceneError[] = []
    const value = attempt(context, errors, () => determined(measure()[0]))
    const out = new Float64Array(12)
    const params = [0, 0, 0]

    // The six faces, sampled.
    const raw = [0, 1, 2, 3, 4, 5].map((f) => {
      const p = Math.floor(f / 2)
      const v = f % 2
      const [q1, q2] = FREE[p]
      const count = (n + 1) * (n + 1)
      const positions = new Float64Array(3 * count)
      const normals = new Float64Array(3 * count)
      const uv = new Float64Array(2 * count)
      for (let j = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++) {
          params[p] = v
          params[q1] = i / n
          params[q2] = j / n
          map(out, params[0], params[1], params[2])
          const k = j * (n + 1) + i
          positions.set([out[0], out[1], out[2]], 3 * k)
          const [a1, a2, a3] = [out[3 + 3 * q1], out[4 + 3 * q1], out[5 + 3 * q1]]
          const [b1, b2, b3] = [out[3 + 3 * q2], out[4 + 3 * q2], out[5 + 3 * q2]]
          normals.set([a2 * b3 - a3 * b2, a3 * b1 - a1 * b3, a1 * b2 - a2 * b1], 3 * k)
          uv.set([i / n, j / n], 2 * k)
        }
      }
      return { positions, normals, uv }
    })

    // Outward: the map's orientation at the cube's centre, flipped on each
    // face at the low end of its parameter.
    map(out, 0.5, 0.5, 0.5)
    const [ds, dt, dw] = [out.subarray(3, 6), out.subarray(6, 9), out.subarray(9, 12)]
    const det = ds[0] * (dt[1] * dw[2] - dt[2] * dw[1]) - ds[1] * (dt[0] * dw[2] - dt[2] * dw[0]) + ds[2] * (dt[0] * dw[1] - dt[1] * dw[0])
    const handed = det < 0 ? -1 : 1

    let [lo, hi] = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]]
    for (const { positions } of raw) {
      for (let i = 0; i < positions.length; i += 3) {
        for (let c = 0; c < 3; c++) {
          const x = positions[i + c]
          if (!Number.isFinite(x)) continue
          lo[c] = Math.min(lo[c], x)
          hi[c] = Math.max(hi[c], x)
        }
      }
    }
    if (!(hi[0] >= lo[0])) [lo, hi] = [[0, 0, 0], [0, 0, 0]]
    const size = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
    const tol = COLLAPSED_REL * size

    const interior = [false, false, false, false, false, false]
    for (let p = 0; p < 3; p++) {
      if (maxDistance(raw[2 * p].positions, raw[2 * p + 1].positions) <= tol) interior[2 * p] = interior[2 * p + 1] = true
    }

    const faces: MeshMark[] = []
    raw.forEach(({ positions, normals, uv }, f) => {
      if (interior[f]) return
      const flip = (f % 2 === 0 ? -1 : 1) * handed < 0
      if (flip) for (let i = 0; i < normals.length; i++) normals[i] = -normals[i]
      const mesh = finishMesh({ positions, normals, uv, indices: flip ? reversedWinding(gridIndices(n)) : gridIndices(n) }, false)
      if (mesh.indices.length === 0 || area(mesh.positions, mesh.indices) <= COLLAPSED_REL * size * size) return
      faces.push({
        kind: 'mesh',
        source: part(context, `face${f}`),
        ...mesh,
        scalars: null,
        style: { color: context.color, opacity, colorScale: null, meshLines: null },
        pick: null,
      })
    })

    // The twelve edges: parameters p1 = v1 and p2 = v2 fixed, the third free.
    const kept: Float64Array[] = []
    for (let p1 = 0; p1 < 3; p1++) {
      for (let p2 = p1 + 1; p2 < 3; p2++) {
        const q = 3 - p1 - p2
        for (const v1 of [0, 1]) {
          for (const v2 of [0, 1]) {
            if (interior[2 * p1 + v1] || interior[2 * p2 + v2]) continue
            const edge = new Float64Array(3 * (EDGE_SEGMENTS + 1))
            for (let s = 0; s <= EDGE_SEGMENTS; s++) {
              params[p1] = v1
              params[p2] = v2
              params[q] = s / EDGE_SEGMENTS
              map(out, params[0], params[1], params[2])
              edge.set([out[0], out[1], out[2]], 3 * s)
            }
            if (!(length(edge) > tol)) continue
            const back = reversed(edge)
            if (kept.some((other) => maxDistance(other, edge) <= tol || maxDistance(other, back) <= tol)) continue
            kept.push(edge)
          }
        }
      }
    }
    let edges: LineMark | null = null
    if (kept.length > 0) {
      const positions = new Float64Array(kept.reduce((m, e) => m + e.length, 0))
      const starts = new Uint32Array(kept.length)
      let at = 0
      kept.forEach((e, i) => {
        starts[i] = at / 3
        positions.set(e, at)
        at += e.length
      })
      edges = { kind: 'lines', source: part(context, 'edges'), positions, starts, params: null, style: lineStyle(context.color, EDGE_WIDTH, false), pick: null }
    }

    const anchor: [number, number, number] = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, hi[2]]
    const marks = edges ? [...faces, edges] : faces
    return { marks, labels: value ? [readoutLabel(context, anchor, `${label} ${approxText(value)}`)] : [], errors, colorScale: null }
  }
  return { reads: reads.names, build }
}
