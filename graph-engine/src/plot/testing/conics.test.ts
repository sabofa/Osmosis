// Property test (calc P3, T7.3): seeded random conics through the implicit curve and region entry points. The curve is drawn from
// certified crossings, so every vertex sits on the zero set to within half a pixel, the components are the ones the conic has, and a
// region `H < 0` has the area of the ellipse.
import { describe, expect, it } from 'vitest'
import type { Chain, SceneObject } from '../../scene/types'
import { chainPoints } from '../../scene/chains'
import { condition, expr, scopeOf } from '../sample/testkit'
import { sampleImplicit } from '../implicit/implicit'
import { sampleRegion } from '../implicit/regions'
import { comparisonsOf } from '../implicit/region'
import { BOUNDS, outlineArea, evenOddArea, ringsOf, VIEW_800 } from '../implicit/regionkit'

type CurveObject = Extract<SceneObject, { kind: 'curve' }>

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Conic = { text: string; h: (x: number, y: number) => number; lengthInRoot?: number; a?: number; b?: number }

const N = 8
const ROOT = 15
const PX = 40
const q = (v: number) => Math.round(v * 1000) / 1000
const lit = (v: number) => (v < 0 ? `(${v})` : `${v}`)
const between = (r: () => number, lo: number, hi: number) => q(lo + (hi - lo) * r())

// the rotated frame about (cx, cy), as text and as numbers
function frame(cx: number, cy: number, th: number) {
  const c = q(Math.cos(th))
  const s = q(Math.sin(th))
  const u = `((x - ${lit(cx)}) * ${lit(c)} + (y - ${lit(cy)}) * ${lit(s)})`
  const v = `((y - ${lit(cy)}) * ${lit(c)} - (x - ${lit(cx)}) * ${lit(s)})`
  return {
    u,
    v,
    U: (x: number, y: number) => (x - cx) * c + (y - cy) * s,
    V: (x: number, y: number) => -(x - cx) * s + (y - cy) * c,
  }
}

function circle(r: () => number): Conic {
  const cx = between(r, -3, 3)
  const cy = between(r, -3, 3)
  const rad = between(r, 1.5, 5)
  return { text: `(x - ${lit(cx)})^2 + (y - ${lit(cy)})^2 - ${rad * rad}`, h: (x, y) => (x - cx) ** 2 + (y - cy) ** 2 - rad * rad, a: rad, b: rad }
}

function ellipse(r: () => number): Conic {
  const a = between(r, 2.5, 5)
  const b = between(r, 1.2, a - 0.6)
  const f = frame(between(r, -2, 2), between(r, -2, 2), between(r, 0, Math.PI))
  return { text: `(${f.u} / ${a})^2 + (${f.v} / ${b})^2 - 1`, h: (x, y) => (f.U(x, y) / a) ** 2 + (f.V(x, y) / b) ** 2 - 1, a, b }
}

function hyperbola(r: () => number): Conic {
  const a = between(r, 1.5, 3)
  const b = between(r, 1, 3)
  const f = frame(between(r, -2, 2), between(r, -2, 2), between(r, 0, Math.PI))
  return { text: `(${f.u} / ${a})^2 - (${f.v} / ${b})^2 - 1`, h: (x, y) => (f.U(x, y) / a) ** 2 - (f.V(x, y) / b) ** 2 - 1 }
}

function parabola(r: () => number): Conic {
  const k = between(r, 0.08, 0.25)
  const f = frame(between(r, -3, 3), between(r, -3, 3), between(r, 0, 2 * Math.PI))
  return { text: `${f.v} - ${k} * ${f.u}^2`, h: (x, y) => f.V(x, y) - k * f.U(x, y) ** 2 }
}

// the length of the line n . p = d (n a unit vector) inside the root box [-15, 15]^2
function lineInRoot(nx: number, ny: number, d: number): number {
  let lo = -Infinity
  let hi = Infinity
  const p = [d * nx, d * ny]
  const dir = [-ny, nx]
  for (let i = 0; i < 2; i++) {
    if (Math.abs(dir[i]) < 1e-12) continue
    const t1 = (-ROOT - p[i]) / dir[i]
    const t2 = (ROOT - p[i]) / dir[i]
    lo = Math.max(lo, Math.min(t1, t2))
    hi = Math.min(hi, Math.max(t1, t2))
  }
  return hi - lo
}

function linePair(r: () => number): Conic {
  const cx = between(r, -3, 3)
  const cy = between(r, -3, 3)
  const t1 = between(r, 0, Math.PI)
  const t2 = q(t1 + between(r, 0.5, Math.PI - 0.5))
  // rounded normals are not exactly unit; the length below scales by the norm so the analytic length stays that of the drawn line
  const n = [t1, t2].map((t) => ({ nx: q(Math.cos(t)), ny: q(Math.sin(t)) }))
  const d = n.map((m) => q(m.nx * cx + m.ny * cy))
  const side = (i: number) => `(${lit(n[i].nx)} * x + ${lit(n[i].ny)} * y - ${lit(d[i])})`
  const len = [0, 1].reduce((s, i) => {
    const norm = Math.hypot(n[i].nx, n[i].ny)
    return s + lineInRoot(n[i].nx / norm, n[i].ny / norm, d[i] / norm)
  }, 0)
  return {
    text: `${side(0)} * ${side(1)}`,
    h: (x, y) => (n[0].nx * x + n[0].ny * y - d[0]) * (n[1].nx * x + n[1].ny * y - d[1]),
    lengthInRoot: len,
  }
}

const FAMILIES: Record<string, { make: (r: () => number) => Conic; seed: number }> = {
  circle: { make: circle, seed: 101 },
  ellipse: { make: ellipse, seed: 202 },
  hyperbola: { make: hyperbola, seed: 303 },
  parabola: { make: parabola, seed: 404 },
  linePair: { make: linePair, seed: 505 },
}

function cases(name: string): Conic[] {
  const { make, seed } = FAMILIES[name]
  const r = mulberry32(seed)
  return Array.from({ length: N }, () => make(r))
}

function curveChains(c: Conic): Chain[] {
  const s = sampleImplicit(expr(c.text), expr('0'), null, VIEW_800, scopeOf(), { statement: 0, color: null, quality: 'full' })
  expect(s.badView).toBe(false)
  expect(s.capped).toBe(false)
  expect(s.drawnInView).toBe(true)
  return (s.objects.find((o): o is CurveObject => o.kind === 'curve') as CurveObject).chains
}

// first-order distance from a point to the zero set, in pixels: |H| / |grad H|
function pixelError(c: Conic, x: number, y: number): number {
  const e = 1e-5
  const gx = (c.h(x + e, y) - c.h(x - e, y)) / (2 * e)
  const gy = (c.h(x, y + e) - c.h(x, y - e)) / (2 * e)
  return (Math.abs(c.h(x, y)) / Math.hypot(gx, gy)) * PX
}

function maxPixelError(c: Conic, chains: Chain[]): number {
  let worst = 0
  for (const ch of chains) for (const p of chainPoints(ch)) worst = Math.max(worst, pixelError(c, p.x, p.y))
  return worst
}

function chainLength(ch: Chain): number {
  const v = chainPoints(ch)
  let sum = 0
  for (let i = 0; i + 1 < v.length; i++) sum += Math.hypot(v[i + 1].x - v[i].x, v[i + 1].y - v[i].y)
  return ch.closed && v.length > 1 ? sum + Math.hypot(v[0].x - v[v.length - 1].x, v[0].y - v[v.length - 1].y) : sum
}

describe('seeded random conics: the curve', () => {
  for (const [name, expected] of [
    ['circle', { count: 1, closed: true }],
    ['ellipse', { count: 1, closed: true }],
    ['hyperbola', { count: 2, closed: false }],
    ['parabola', { count: 1, closed: false }],
  ] as const) {
    it(`${name}: ${expected.count} ${expected.closed ? 'closed' : 'open'} component(s), every vertex within half a pixel of the zero set`, () => {
      cases(name).forEach((c, i) => {
        const chains = curveChains(c)
        const label = `${name} #${i}: ${c.text}`
        expect(chains.length, label).toBe(expected.count)
        for (const ch of chains) expect(ch.closed, label).toBe(expected.closed)
        expect(maxPixelError(c, chains), label).toBeLessThanOrEqual(0.5)
      })
    })
  }

  it('linePair: every vertex within half a pixel of the zero set, and the drawn length is the length of the two lines in the clip box', () => {
    cases('linePair').forEach((c, i) => {
      const chains = curveChains(c)
      const label = `linePair #${i}: ${c.text}`
      expect(maxPixelError(c, chains), label).toBeLessThanOrEqual(0.5)
      const total = chains.reduce((s, ch) => s + chainLength(ch), 0)
      expect(Math.abs(total - (c.lengthInRoot as number)) / (c.lengthInRoot as number), `${label} (drawn ${total}, analytic ${c.lengthInRoot})`).toBeLessThan(0.02)
    })
  })
})

describe('seeded random conics: the region', () => {
  it('ellipse: H < 0 outlines an area of pi a b within half a percent by the signed rings, and within one percent by the even-odd rule on a grid', () => {
    cases('ellipse').forEach((c, i) => {
      const cond = condition(`${c.text} < 0`)
      const r = sampleRegion(cond, comparisonsOf(cond), VIEW_800, scopeOf(), { statement: 0, color: null, quality: 'full' })
      const label = `ellipse #${i}: ${c.text} (a ${c.a}, b ${c.b})`
      const truth = Math.PI * (c.a as number) * (c.b as number)
      expect(r.capped, label).toBe(false)
      const rings = ringsOf(r)
      expect(rings.length, label).toBe(1)
      expect(Math.abs(outlineArea(r) - truth) / truth, label).toBeLessThan(0.005)
      const pts = rings.flat()
      const box = { xMin: Math.min(...pts.map((p) => p.x)) - 0.1, xMax: Math.max(...pts.map((p) => p.x)) + 0.1, yMin: Math.min(...pts.map((p) => p.y)) - 0.1, yMax: Math.max(...pts.map((p) => p.y)) + 0.1 }
      expect(box.xMin).toBeGreaterThan(BOUNDS.xMin)
      expect(Math.abs(evenOddArea(rings, box, 250) - truth) / truth, label).toBeLessThan(0.01)
    })
  })
})
