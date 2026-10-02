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
// Compiled curves are cached by the identity of the point list.

import { evalCurve, type CurvePoints } from '../curves'
import type { PaintParams } from '../params'
import { clamp } from './math'

export type CurveFn = (x: number) => number

const TABLE = 4096
const cache = new WeakMap<CurvePoints, CurveFn>()

export function isIdentityCurve(points: CurvePoints): boolean {
  return points.length === 2 && points[0][0] === 0 && points[0][1] === 0 && points[1][0] === 1 && points[1][1] === 1
}

export function isFlatCurve(points: CurvePoints): boolean {
  if (points.length === 0) return true
  return points.every((p) => p[1] === points[0][1])
}

export function compileCurve(points: CurvePoints): CurveFn {
  const have = cache.get(points)
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
  cache.set(points, fn)
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
