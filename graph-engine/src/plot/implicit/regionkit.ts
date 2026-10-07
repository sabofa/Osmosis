// Test helpers for the region stage (calc P3, task 4): a region from the text of its condition, and what the acceptance cases measure of
// it. Not used outside tests.
import { compileScalar } from '../../math/compile'
import type { Bounds, Chain, SceneObject, Vec2 } from '../../scene/types'
import { condition as parseCondition, scopeOf } from '../sample/testkit'
import type { View } from '../sample/curve'
import { chainPoints } from '../../scene/chains'
import { comparisonsOf } from './region'
import { sampleRegion, type SampledRegion } from './regions'
import type { StatementOptions } from './types'
import type { MathScope } from '../../math/scope'
import type { Expr } from '../../parser/types'

// The default view of the corpus: [-10, 10]^2 at 800 px (40 px a unit), the root [-15, 15]^2.
export const BOUNDS: Bounds = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }
export const VIEW_800: View = { bounds: BOUNDS, widthPx: 800, heightPx: 800 }

type RegionObject = Extract<SceneObject, { kind: 'region' }>
type CurveObject = Extract<SceneObject, { kind: 'curve' }>

type RegionOptions = { view?: View; quality?: 'full' | 'coarse'; budget?: StatementOptions['budget']; scope?: MathScope }

// A region from the Expr of its condition (a statement's comparison and its `if` clause put together as the scene builder does).
export function regionOfCondition(c: Expr, o: RegionOptions = {}): SampledRegion {
  return sampleRegion(c, comparisonsOf(c), o.view ?? VIEW_800, o.scope ?? scopeOf(), { statement: 0, color: null, quality: o.quality ?? 'full', budget: o.budget })
}

export function regionOf(text: string, o: RegionOptions = {}): SampledRegion {
  return regionOfCondition(parseCondition(text), o)
}

export function regionObject(r: SampledRegion): RegionObject {
  return r.objects.find((o): o is RegionObject => o.kind === 'region') as RegionObject
}

export function boundaryCurves(r: SampledRegion): CurveObject[] {
  return r.objects.filter((o): o is CurveObject => o.kind === 'curve')
}

export function ringsOf(r: SampledRegion): Vec2[][] {
  return regionObject(r).outline.map(chainPoints)
}

export function signedArea(p: readonly Vec2[]): number {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length]
    a += p[i].x * q.y - q.x * p[i].y
  }
  return a / 2
}

// The area of the outline by the even-odd rule. The region is on the left of every ring's way, so the signed areas add up to it
// (an outer ring counter-clockwise, a hole clockwise): this is the sum, and `nesting` checks it against containment.
export function outlineArea(r: SampledRegion): number {
  return ringsOf(r).reduce((s, ring) => s + signedArea(ring), 0)
}

// The area where a point is inside by the even-odd rule, estimated on a grid of n by n cells over a box: for a test that the sum of
// signed areas agrees with the rule the renderer fills by.
export function evenOddArea(rings: readonly Vec2[][], box: Bounds, n = 400): number {
  let inside = 0
  const dx = (box.xMax - box.xMin) / n
  const dy = (box.yMax - box.yMin) / n
  for (let j = 0; j < n; j++) {
    const y = box.yMin + (j + 0.5) * dy
    for (let i = 0; i < n; i++) {
      const x = box.xMin + (i + 0.5) * dx
      let crossings = 0
      for (const ring of rings) {
        for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
          if (ring[a].y > y !== ring[b].y > y && x < ((ring[b].x - ring[a].x) * (y - ring[a].y)) / (ring[b].y - ring[a].y) + ring[a].x) crossings++
        }
      }
      if (crossings % 2 === 1) inside++
    }
  }
  return inside * dx * dy
}

export function insideRings(rings: readonly Vec2[][], x: number, y: number): boolean {
  let crossings = 0
  for (const ring of rings) {
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      if (ring[a].y > y !== ring[b].y > y && x < ((ring[b].x - ring[a].x) * (y - ring[a].y)) / (ring[b].y - ring[a].y) + ring[a].x) crossings++
    }
  }
  return crossings % 2 === 1
}

// The area of a condition by the scalar kernel, an independent measure: the cells of an n by n grid over the box whose middle the
// condition is true at (1; undefined is not).
export function scalarArea(text: string, box: Bounds, n = 1200, scope: MathScope = scopeOf()): number {
  const f = compileScalar(parseCondition(text), ['x', 'y'], scope)
  const dx = (box.xMax - box.xMin) / n
  const dy = (box.yMax - box.yMin) / n
  let count = 0
  for (let j = 0; j < n; j++) {
    const y = box.yMin + (j + 0.5) * dy
    for (let i = 0; i < n; i++) if (f(box.xMin + (i + 0.5) * dx, y) === 1) count++
  }
  return count * dx * dy
}

// How many points of an n by n grid over the box the outline fills where the condition is not true and which are farther than
// `tol` from every edge of the outline: a false fill (a point near an edge is the chord's error, not the fill's).
export function falseFill(r: SampledRegion, text: string, box: Bounds, n: number, tol: number, scope: MathScope = scopeOf()): number {
  const f = compileScalar(parseCondition(text), ['x', 'y'], scope)
  const rings = ringsOf(r)
  const dx = (box.xMax - box.xMin) / n
  const dy = (box.yMax - box.yMin) / n
  let bad = 0
  for (let j = 0; j < n; j++) {
    const y = box.yMin + (j + 0.5) * dy
    for (let i = 0; i < n; i++) {
      const x = box.xMin + (i + 0.5) * dx
      if (f(x, y) === 1 || !insideRings(rings, x, y)) continue
      if (distToRings(rings, { x, y }) > tol) bad++
    }
  }
  return bad
}

export function chainVertices(chains: readonly Chain[]): Vec2[] {
  return chains.flatMap(chainPoints)
}

// The distance from a point to the nearest edge of the rings.
export function distToRings(rings: readonly Vec2[][], q: Vec2): number {
  let best = Infinity
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2))
      best = Math.min(best, Math.hypot(a.x + t * dx - q.x, a.y + t * dy - q.y))
    }
  }
  return best
}
