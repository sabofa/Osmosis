// Refining a hit on the true function (plan E6). Pure.
//
// - A ray is clipped to the axis box first: nothing outside it is drawn, so
//   nothing outside it is picked.
// - Graph surfaces: g(s) = ray_z(s) - f(ray_x(s), ray_y(s)), marched in 256
//   steps to its FIRST sign change, then bisected to 1e-12 of the box span.
//   A sign change across a pole (g jumps from -inf to +inf) is not a
//   crossing: the refined g must vanish.
// - Parametric surfaces: Newton on r(u, v) - (o + s d) = 0 for (u, v, s),
//   with the 3x3 Jacobian [r_u, r_v, -d] from symbolic derivatives.
// - Implicit surfaces: Newton along the ray on F(o + s d), with grad F . d.

import { solve3 } from '../../math/linalg'
import type { Box3, Vec3 } from '../scene/types'
import type { Ray } from './types'

export const MARCH_STEPS = 256
export const BISECTION_REL = 1e-12
export const PARAMETRIC_NEWTON_STEPS = 4
export const IMPLICIT_NEWTON_STEPS = 8

export function at(ray: Ray, s: number): Vec3 {
  const { origin: o, direction: d } = ray
  return [o[0] + s * d[0], o[1] + s * d[1], o[2] + s * d[2]]
}

export function boxSpan(box: Box3): number {
  return Math.max(box.x.max - box.x.min, box.y.max - box.y.min, box.z.max - box.z.min)
}

// The part of the ray inside the box (widened by 1e-9 of each span), as
// [s0, s1] with s0 >= 0, or null when the ray misses it.
export function clipRay(ray: Ray, box: Box3): [number, number] | null {
  let s0 = 0
  let s1 = Number.POSITIVE_INFINITY
  const ranges = [box.x, box.y, box.z]
  for (let a = 0; a < 3; a++) {
    const tol = 1e-9 * (ranges[a].max - ranges[a].min)
    const lo = ranges[a].min - tol
    const hi = ranges[a].max + tol
    const o = ray.origin[a]
    const d = ray.direction[a]
    if (d === 0) {
      if (o < lo || o > hi) return null
      continue
    }
    const t1 = (lo - o) / d
    const t2 = (hi - o) / d
    s0 = Math.max(s0, Math.min(t1, t2))
    s1 = Math.min(s1, Math.max(t1, t2))
    if (s0 > s1) return null
  }
  return Number.isFinite(s1) ? [s0, s1] : null
}

function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0
}

// A root of g in [lo, hi], where g(lo) and g(hi) differ in sign, to within
// `tol` in s.
export function bisect(g: (s: number) => number, lo: number, hi: number, tol: number): number {
  let glo = g(lo)
  if (glo === 0) return lo
  for (let i = 0; i < 200 && hi - lo > tol; i++) {
    const mid = 0.5 * (lo + hi)
    const gm = g(mid)
    if (gm === 0) return mid
    if (sign(gm) === sign(glo)) {
      lo = mid
      glo = gm
    } else {
      hi = mid
    }
  }
  return 0.5 * (lo + hi)
}

export interface GraphHit {
  s: number
  x: number
  y: number
  z: number
}

// The first crossing of the ray with z = f(x, y) inside [s0, s1] whose (x, y)
// the surface covers (`inside`, its domain), or null.
export function marchGraph(
  f: (x: number, y: number) => number,
  ray: Ray,
  s0: number,
  s1: number,
  span: number,
  inside: (x: number, y: number) => boolean = () => true,
): GraphHit | null {
  const { origin: o, direction: d } = ray
  const g = (s: number) => o[2] + s * d[2] - f(o[0] + s * d[0], o[1] + s * d[1])
  const length = Math.hypot(d[0], d[1], d[2])
  const tol = (BISECTION_REL * span) / length
  let prevS = s0
  let prevG = g(s0)
  for (let i = 1; i <= MARCH_STEPS; i++) {
    const s = s0 + ((s1 - s0) * i) / MARCH_STEPS
    const gs = g(s)
    if (Number.isFinite(prevG) && Number.isFinite(gs) && (sign(prevG) !== sign(gs) || gs === 0)) {
      const hit = bisect(g, prevS, s, tol)
      const x = o[0] + hit * d[0]
      const y = o[1] + hit * d[1]
      const z = f(x, y)
      // A true crossing: the ray is on the surface there (not a pole's jump).
      if (Math.abs(o[2] + hit * d[2] - z) <= 1e-6 * span && inside(x, y)) return { s: hit, x, y, z }
    }
    prevS = s
    prevG = gs
  }
  return null
}

export interface ParametricSurfaceFns {
  r: (u: number, v: number) => Vec3
  ru: (u: number, v: number) => Vec3
  rv: (u: number, v: number) => Vec3
}

// Newton on r(u, v) - (o + s d) = 0 from (u, v, s), `steps` steps. Returns
// null if a step is singular or goes non-finite.
export function newtonParametric(
  fns: ParametricSurfaceFns,
  ray: Ray,
  u: number,
  v: number,
  s: number,
  steps: number = PARAMETRIC_NEWTON_STEPS,
): { u: number; v: number; s: number } | null {
  const d = ray.direction
  for (let k = 0; k < steps; k++) {
    const p = fns.r(u, v)
    const q = at(ray, s)
    const F = [p[0] - q[0], p[1] - q[1], p[2] - q[2]]
    const a = fns.ru(u, v)
    const b = fns.rv(u, v)
    const step = solve3(
      [
        [a[0], b[0], -d[0]],
        [a[1], b[1], -d[1]],
        [a[2], b[2], -d[2]],
      ],
      [-F[0], -F[1], -F[2]],
    )
    if (!step) return null
    u += step[0]
    v += step[1]
    s += step[2]
    if (!Number.isFinite(u) || !Number.isFinite(v) || !Number.isFinite(s)) return null
  }
  return { u, v, s }
}

// Newton along the ray on h(s) = F(o + s d), h'(s) = grad F . d.
export function newtonImplicit(
  F: (x: number, y: number, z: number) => number,
  grad: (x: number, y: number, z: number) => Vec3,
  ray: Ray,
  s: number,
  steps: number = IMPLICIT_NEWTON_STEPS,
): number | null {
  const d = ray.direction
  for (let k = 0; k < steps; k++) {
    const p = at(ray, s)
    const h = F(p[0], p[1], p[2])
    if (h === 0) return s
    const g = grad(p[0], p[1], p[2])
    const slope = g[0] * d[0] + g[1] * d[1] + g[2] * d[2]
    if (!(Math.abs(slope) > 0)) return null
    const next = s - h / slope
    if (!Number.isFinite(next)) return null
    if (next === s) return s
    s = next
  }
  return s
}
