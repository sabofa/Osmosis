// Test helpers for the sampler's stages: an expression from text, and a
// MathScope from definition lines. Neither is used outside tests. Both throw on
// a bad line, so a test that mistypes its setup fails there and not three
// assertions later.

import { compileScalar } from '../../math/compile'
import { compileInterval, iv } from '../../math/interval'
import type { MathScope } from '../../math/scope'
import { parseExprString } from '../../parser/parseExpr'
import { parseSpec } from '../../parser/parseSpec'
import type { Expr } from '../../parser/types'
import { buildPlotScope } from '../scope'
import { sampleRange } from './adaptive'
import { ChainSink } from './sink'
import { FULL, type Tuning } from './tuning'
import type { CurveFns, EvalCounter, PointFn, Screen } from './types'

export function expr(text: string): Expr {
  return parseExprString(text)
}

// The curve y = f(x) as a PointFn: the parameter is x, the value is y.
export function pointFnOf(text: string, param: string, scope: MathScope): PointFn {
  const f = compileScalar(expr(text), [param], scope)
  return (t, out) => {
    out[0] = t
    out[1] = f(t)
  }
}

// `defs` is the lines of a spec ("f(x) = 1/(x - a)", "@param a = 2 range [0, 5]");
// `angle` is the document's @angle, radians when not given.
export function scopeOf(defs = '', angle: 'radians' | 'degrees' = 'radians'): MathScope {
  const parsed = parseSpec(`@angle: ${angle}\n${defs}`)
  if (parsed.errors.length > 0) throw new Error(`scopeOf: ${parsed.errors.map((e) => `line ${e.line}: ${e.message}`).join('; ')}`)
  const { scope, errors } = buildPlotScope(parsed.statements, parsed.config, parsed.statementLines)
  if (errors.length > 0) throw new Error(`scopeOf: ${errors.map((e) => e.message).join('; ')}`)
  return scope
}

// The scalar y = f(x), for a test to compare a drawn curve against.
export function trueY(text: string, scope: MathScope): (x: number) => number {
  return compileScalar(expr(text), ['x'], scope)
}

// One twin scratch for every fnsOf: an enclosure is copied out at once, and evaluations
// do not overlap.
const scratch = iv()

// The CurveFns of y = f(x), at 40 px per unit unless told otherwise: the parameter is x, x is
// enclosed by [tLo, tHi] itself, y by the twin of the expression.
export function fnsOf(text: string, scope: MathScope, pxPerT = 40): CurveFns {
  const twin = compileInterval(expr(text), ['x'], scope)
  return {
    point: pointFnOf(text, 'x', scope),
    enclose(tLo, tHi, out) {
      twin(scratch, tLo, tHi)
      out.xLo = tLo
      out.xHi = tHi
      out.yLo = scratch.lo
      out.yHi = scratch.hi
      // x is CONTINUOUS, the top verdict, so the worse of the two is y's
      return scratch.v
    },
    pxPerT,
    oscillationAxis: 'y',
  }
}

// The view [-10, 10]^2 at 800 px, with the 25 % overscan the clip box carries.
export const view: Screen = { px: { x: 40, y: 40 }, clip: { xMin: -15, xMax: 15, yMin: -15, yMax: 15 } }

// Samples y = f(x) over [-15, 15], free ends, a fresh sink and counter.
export function run(text: string, tuning: Tuning = FULL) {
  const sink = new ChainSink(view.clip)
  const counter: EvalCounter = { points: 0, intervals: 0 }
  const { capped } = sampleRange(fnsOf(text, scopeOf()), -15, 15, { left: { kind: 'free' }, right: { kind: 'free' } }, view, tuning, counter, sink)
  return { chains: sink.chains(), breaks: sink.breaks(), capped, counter }
}

// The same over the square view [-half, half]^2 at 800 px, 25 % overscan: for a test that
// needs the curve far from the 40 px per unit of `view`. Returns the screen as well.
export function runView(text: string, half: number, tuning: Tuning = FULL) {
  const px = 800 / (2 * half)
  const screen: Screen = { px: { x: px, y: px }, clip: { xMin: -1.25 * half, xMax: 1.25 * half, yMin: -1.25 * half, yMax: 1.25 * half } }
  const sink = new ChainSink(screen.clip)
  const counter: EvalCounter = { points: 0, intervals: 0 }
  const { capped } = sampleRange(fnsOf(text, scopeOf(), px), screen.clip.xMin, screen.clip.xMax, { left: { kind: 'free' }, right: { kind: 'free' } }, screen, tuning, counter, sink)
  return { chains: sink.chains(), breaks: sink.breaks(), capped, counter, screen }
}
