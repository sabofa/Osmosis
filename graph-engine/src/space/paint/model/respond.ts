// The editable curves (curves.ts) compiled for the model's hot paths.
//
// evalCurve is a monotone cubic that allocates its tangents on every call;
// the model asks for it per pixel and per stroke. compileCurve turns a point
// list into a function over x in 0..1:
//   - the identity curve ([[0,0],[1,1]], the default for lightResponse and value)
//     returns x itself, and a flat curve (every y equal: the defaults of
//     lAdjust, cAdjust, hAdjust and mixAmount) returns that y exactly, so the
//     default curves leave the spec's formulas BIT-IDENTICAL (no 0.30000000000000004);
//   - any other curve is sampled once into a 4097-entry table and read by
//     linear interpolation (error below 1e-5 even for a steep step between two points).
// Compiled curves are cached by the VALUE of the point list (a string of its numbers), so a list
// edited in place is compiled again (the first cache was keyed on the list's identity and went stale),
// and two lists with the same points share one function.

import { evalCurve, type CurvePoints } from '../curves'
import type { PaintParams } from '../params'
import { clamp } from './math'

export type CurveFn = (x: number) => number

const TABLE = 4096
const CACHE_LIMIT = 64
const cache = new Map<string, CurveFn>()

export const curveKey = (points: CurvePoints): string => {
  let key = ''
  for (const p of points) key += `${p[0]},${p[1]};`
  return key
}

export function isIdentityCurve(points: CurvePoints): boolean {
  return points.length === 2 && points[0][0] === 0 && points[0][1] === 0 && points[1][0] === 1 && points[1][1] === 1
}

export function isFlatCurve(points: CurvePoints): boolean {
  if (points.length === 0) return true
  return points.every((p) => p[1] === points[0][1])
}

export function compileCurve(points: CurvePoints): CurveFn {
  const key = curveKey(points)
  const have = cache.get(key)
  if (have) return have
  let fn: CurveFn
  if (isIdentityCurve(points)) {
    fn = (x) => x
  } else if (isFlatCurve(points)) {
    const y = points.length ? points[0][1] : 0
    fn = () => y
  } else {
    const table = new Float64Array(TABLE + 1)
    for (let i = 0; i <= TABLE; i++) table[i] = evalCurve(points, i / TABLE)
    fn = (x) => {
      const t = clamp(x, 0, 1) * TABLE
      const i = Math.min(TABLE - 1, Math.floor(t))
      const f = t - i
      return table[i] * (1 - f) + table[i + 1] * f
    }
  }
  // a small cache: the curves a session edits are a handful, and a drag of a point makes one per step
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, fn)
  return fn
}

export interface CompiledCurves {
  lightResponse: CurveFn
  value: CurveFn
  lAdjust: CurveFn
  cAdjust: CurveFn
  hAdjust: CurveFn
  mixAmount: CurveFn
}

export function compileCurves(params: PaintParams): CompiledCurves {
  const c = params.curves
  return {
    lightResponse: compileCurve(c.lightResponse),
    value: compileCurve(c.value),
    lAdjust: compileCurve(c.lAdjust),
    cAdjust: compileCurve(c.cAdjust),
    hAdjust: compileCurve(c.hAdjust),
    mixAmount: compileCurve(c.mixAmount),
  }
}
