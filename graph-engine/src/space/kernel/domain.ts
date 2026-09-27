// Surface domains are exact (K10).
//
// Rectangles and iterated domains are the image of the unit square under an
// exact map, so their boundary edges lie on the bounding curves:
//   rectangle: (s, t) -> (a + (b - a)s, c + (d - c)t)
//   type I/II: u = a + (b - a)s, w = g1(u) + (g2(u) - g1(u))t, u the outer
//              variable
//   polar:     the same in (r, theta), then (r cos theta, r sin theta)
// Where the inner bounds meet, triangles collapse and mesh.ts drops them.
// Where g2 - g1 changes sign across the outer range, the domain is refused.
//
// An inequality domain is sampled on a grid over the box and each triangle is
// clipped against each condition in turn. A boundary crossing is found by
// bisection on the TRUE condition along the edge, and is shared by the
// edge's key, so the two triangles either side of an edge get the same point
// and the mesh has no cracks.

import { BISECTION_REL } from '../../math/tolerance'
import type { Range } from '../scene/types'
import { gridIndices } from './mesh'

export interface DomainSamples {
  // The surface's x and y at each vertex.
  x: Float64Array
  y: Float64Array
  // Where the body is evaluated: (x, y), or (r, theta) for a polar domain.
  a: Float64Array
  b: Float64Array
  indices: Uint32Array
}

// (s, t) grid with s fastest: vertex (i, j) is j * (n + 1) + i.
function grid(n: number, place: (i: number, j: number, out: Float64Array) => void): DomainSamples {
  const count = (n + 1) * (n + 1)
  const samples: DomainSamples = {
    x: new Float64Array(count),
    y: new Float64Array(count),
    a: new Float64Array(count),
    b: new Float64Array(count),
    indices: gridIndices(n),
  }
  const out = new Float64Array(4)
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      place(i, j, out)
      const v = j * (n + 1) + i
      samples.x[v] = out[0]
      samples.y[v] = out[1]
      samples.a[v] = out[2]
      samples.b[v] = out[3]
    }
  }
  return samples
}

export function rectSamples(x: Range, y: Range, n: number): DomainSamples {
  return grid(n, (i, j, out) => {
    out[0] = out[2] = x.min + (x.max - x.min) * (i / n)
    out[1] = out[3] = y.min + (y.max - y.min) * (j / n)
  })
}

function formatNumber(v: number): string {
  return String(Number(v.toPrecision(6)))
}

// Refuses inner bounds whose difference changes sign across the outer range,
// naming the outer value where they cross (a sample where they meet exactly,
// or the bisected crossing between two samples).
function checkCrossing(name: string, us: Float64Array, lo: (u: number) => number, hi: (u: number) => number): void {
  const gap = (u: number) => hi(u) - lo(u)
  let firstSign = 0
  let lastSame = -1
  let zeroSince = -1
  for (let i = 0; i < us.length; i++) {
    const d = gap(us[i])
    if (!Number.isFinite(d)) continue
    const sign = Math.sign(d)
    if (sign === 0) {
      if (firstSign !== 0 && zeroSince < 0) zeroSince = i
      continue
    }
    if (firstSign === 0) firstSign = sign
    if (sign === firstSign) {
      lastSame = i
      zeroSince = -1
      continue
    }
    let at: number
    if (zeroSince >= 0) at = us[zeroSince]
    else {
      let a = us[lastSame]
      let b = us[i]
      for (let k = 0; k < 60 && a !== b; k++) {
        const m = (a + b) / 2
        if (Math.sign(gap(m)) === firstSign) a = m
        else b = m
      }
      at = (a + b) / 2
    }
    throw new Error(`the inner bounds cross near ${name} = ${formatNumber(at)} — split the domain there`)
  }
}

export interface IteratedSpec {
  outer: string
  outerRange: Range
  lo: (u: number) => number
  hi: (u: number) => number
  // polar: which of (outer, inner) is r; `angle` converts theta to radians
  polar: { outerIsR: boolean; angle: number } | null
  // cartesian: whether the outer variable is x
  outerIsX: boolean
}

export function iteratedSamples(spec: IteratedSpec, n: number): DomainSamples {
  const { outerRange, lo, hi, polar } = spec
  const us = new Float64Array(n + 1)
  const g1 = new Float64Array(n + 1)
  const g2 = new Float64Array(n + 1)
  for (let i = 0; i <= n; i++) {
    us[i] = outerRange.min + (outerRange.max - outerRange.min) * (i / n)
    g1[i] = lo(us[i])
    g2[i] = hi(us[i])
  }
  checkCrossing(spec.outer, us, lo, hi)
  return grid(n, (i, j, out) => {
    const u = us[i]
    const w = g1[i] + (g2[i] - g1[i]) * (j / n)
    if (polar) {
      const r = polar.outerIsR ? u : w
      const theta = polar.outerIsR ? w : u
      out[0] = r * Math.cos(theta * polar.angle)
      out[1] = r * Math.sin(theta * polar.angle)
      out[2] = r
      out[3] = theta
    } else {
      out[0] = out[2] = spec.outerIsX ? u : w
      out[1] = out[3] = spec.outerIsX ? w : u
    }
  })
}

// One condition of a conjunction: h(x, y) with the inside where h <= 0
// (a strict inequality is drawn as its closure). NaN is outside.
export interface Condition {
  h: (x: number, y: number) => number
}

export function inequalitySamples(conditions: readonly Condition[], x: Range, y: Range, n: number): DomainSamples {
  const xs: number[] = []
  const ys: number[] = []
  // createdBy[v]: the condition whose boundary vertex v lies on, or -1.
  const createdBy: number[] = []
  const values: number[][] = conditions.map(() => [])

  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      xs.push(x.min + (x.max - x.min) * (i / n))
      ys.push(y.min + (y.max - y.min) * (j / n))
      createdBy.push(-1)
    }
  }

  const inside = (c: number, v: number): boolean => {
    if (createdBy[v] === c) return true
    let h = values[c][v]
    if (h === undefined) {
      h = conditions[c].h(xs[v], ys[v])
      values[c][v] = h
    }
    return h <= 0
  }

  const crossings = new Map<string, number>()
  const crossing = (c: number, p: number, q: number): number => {
    // Always from the lower id to the higher, so both triangles sharing the
    // edge bisect it identically, and share the result by key.
    const from = Math.min(p, q)
    const to = Math.max(p, q)
    const key = `${c}:${from}:${to}`
    const known = crossings.get(key)
    if (known !== undefined) return known
    const fromInside = inside(c, from)
    let tIn = fromInside ? 0 : 1
    let tOut = fromInside ? 1 : 0
    const dx = xs[to] - xs[from]
    const dy = ys[to] - ys[from]
    const h = conditions[c].h
    while (Math.abs(tOut - tIn) > BISECTION_REL) {
      const t = (tIn + tOut) / 2
      if (h(xs[from] + dx * t, ys[from] + dy * t) <= 0) tIn = t
      else tOut = t
    }
    const v = xs.length
    xs.push(xs[from] + dx * tIn)
    ys.push(ys[from] + dy * tIn)
    createdBy.push(c)
    crossings.set(key, v)
    return v
  }

  const out: number[] = []
  const cells = gridIndices(n)
  for (let t = 0; t < cells.length; t += 3) {
    let polygon = [cells[t], cells[t + 1], cells[t + 2]]
    for (let c = 0; c < conditions.length && polygon.length >= 3; c++) {
      const clipped: number[] = []
      for (let k = 0; k < polygon.length; k++) {
        const p = polygon[k]
        const q = polygon[(k + 1) % polygon.length]
        const pIn = inside(c, p)
        if (pIn) clipped.push(p)
        if (pIn !== inside(c, q)) clipped.push(crossing(c, p, q))
      }
      polygon = clipped
    }
    for (let k = 1; k + 1 < polygon.length; k++) out.push(polygon[0], polygon[k], polygon[k + 1])
  }

  const xa = Float64Array.from(xs)
  const ya = Float64Array.from(ys)
  return { x: xa, y: ya, a: xa, b: ya, indices: Uint32Array.from(out) }
}
