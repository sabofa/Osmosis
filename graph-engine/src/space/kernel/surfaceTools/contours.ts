// Level curves of a function of two variables (S4b, B2): contourCurves, the
// builder S4a's contour: dispatches a two-variable target to, and the tracer
// gradient: and lagrange: reuse for a single level.
//
// Tracing: render/marchingSquares.ts's traceImplicitCurve on f - c over the
// domain at res (default 160), its segments chained into polylines, then every
// crossing refined by bisection along its grid edge on the true f to
// BISECTION_REL of the edge — so a vertex is on the level curve to rounding,
// not to the grid's linear interpolation.
//
// Placement: each level draws on the surface at z = c exactly (width: sets
// its width, dashed dashes it) and, with floor, a projected copy on the box
// floor (dashed, 1 px). opacity: is refused: it is a level surface's clause.
// A line takes its level's colour on the spec's colormap, over the domain a
// height scale would use, unless color: gives a flat one. labels puts the
// value at the vertex of each level's longest polyline nearest its
// arc-length midpoint.
//
// Levels (S4a A2): "levels n" is the multiples of niceStep(range, n) strictly
// inside the range f takes on the tracing grid; a list, or "a..b step s", is
// used as written.
//
// The form is S4a's (grammar/keywords/geometryForms.ts); S4a's contour:
// builder dispatches a two-variable target here (integration J2).

import type { Statement } from '../../../parser/types'
import { BISECTION_REL } from '../../../math/tolerance'
import { traceImplicitCurve } from '../../../render/marchingSquares'
import { colormapAt, normalise } from '../../colormaps'
import { niceStep } from '../../frame/nice'
import type { ContourForm, Levels } from '../../grammar/keywords/geometryForms'
import type { ColormapClause } from '../../grammar/types'
import { formatNumber } from '../../pick/format'
import type { ColorSpec, LabelAnchor, LineMark } from '../../scene/types'
import { colorScale, constant, Reads, resolution } from '../common'
import { chain } from '../curves'
import type { BuildContext, BuildResult, BuilderEntry, PreparedStatement } from '../registry'
import { annotation, lineMark, part, toolBox } from './box'
import { compileOver, prepareDomain, requireArity, resolveTarget, type Rect } from './target'

export const LEVEL_RES = 160
export const MAX_LEVELS = 100
const LEVEL_WIDTH = 2
const FLOOR_WIDTH = 1

// The polylines of g(x, y) = 0 over the rectangle, each a flat [x0, y0, x1,
// y1, ...] list; a closed curve's first and last vertices are the same.
export function levelCurves(g: (x: number, y: number) => number, rect: Rect, res: number): Float64Array[] {
  const { x, y } = rect
  const segments = traceImplicitCurve(g, { xMin: x.min, xMax: x.max, yMin: y.min, yMax: y.max }, res)
  const dx = (x.max - x.min) / res
  const dy = (y.max - y.min) / res
  // The tracer puts grid line i at min + i * step; a crossing on a vertical
  // edge has exactly that x, one on a horizontal edge exactly that y.
  const onGrid = (v: number, min: number, step: number) => {
    const i = Math.round((v - min) / step)
    return i >= 0 && i <= res && min + i * step === v
  }
  // The root of h on the grid edge along one axis that holds v, by bisection,
  // keeping the tracer's sign convention (positive is > 0); v itself when no
  // edge there brackets a sign change.
  const bisect = (h: (s: number) => number, v: number, min: number, step: number): number => {
    const k = Math.min(res - 1, Math.max(0, Math.floor((v - min) / step)))
    for (const e of [k, k - 1, k + 1]) {
      if (e < 0 || e >= res) continue
      let a = min + e * step
      let b = min + (e + 1) * step
      if (v < a - 1e-9 * step || v > b + 1e-9 * step) continue
      let ha = h(a)
      const hb = h(b)
      if (ha > 0 === hb > 0) continue
      if (ha === 0) return a
      if (hb === 0) return b
      while (b - a > BISECTION_REL * step) {
        const m = (a + b) / 2
        const hm = h(m)
        if (hm > 0 === ha > 0) {
          a = m
          ha = hm
        } else {
          b = m
        }
      }
      return (a + b) / 2
    }
    return v
  }
  const refined = new Map<string, [number, number]>()
  const refine = (p: { x: number; y: number }): [number, number] => {
    const key = `${p.x},${p.y}`
    const known = refined.get(key)
    if (known) return known
    let out: [number, number] = [p.x, p.y]
    if (g(p.x, p.y) !== 0) {
      if (onGrid(p.x, x.min, dx)) out = [p.x, bisect((s) => g(p.x, s), p.y, y.min, dy)]
      else if (onGrid(p.y, y.min, dy)) out = [bisect((s) => g(s, p.y), p.x, x.min, dx), p.y]
    }
    refined.set(key, out)
    return out
  }
  // Where the curve passes exactly through a grid vertex (f - c = 0 there),
  // the cells beside it emit a segment from that vertex to itself; chained,
  // it would become a stray polyline of one repeated point.
  const proper = segments.filter(([a, b]) => a.x !== b.x || a.y !== b.y)
  return chain(proper).map((line) => {
    const flat = new Float64Array(2 * line.length)
    line.forEach((p, i) => flat.set(refine(p), 2 * i))
    return flat
  })
}

// Lifts [x, y, ...] pairs to xyz at height z(x, y).
export function lift(line: Float64Array, z: (x: number, y: number) => number): Float64Array {
  const out = new Float64Array((line.length / 2) * 3)
  for (let i = 0, j = 0; i < line.length; i += 2, j += 3) {
    out[j] = line[i]
    out[j + 1] = line[i + 1]
    out[j + 2] = z(line[i], line[i + 1])
  }
  return out
}

// The multiples of niceStep(max - min, n) strictly inside (min, max). A step
// below 1 is 1/m for a whole m on the 1-2-5 ladder, so k/m is the correctly
// rounded level (0.3, not 0.30000000000000004).
export function niceLevels(min: number, max: number, n: number): number[] {
  if (!(max > min)) return []
  const step = niceStep(max - min, n)
  const per = step < 1 ? Math.round(1 / step) : 0
  const value = (k: number) => (per ? k / per : k * step)
  const out: number[] = []
  for (let k = Math.ceil(min / step); value(k) < max; k++) {
    const v = value(k)
    if (v > min) out.push(v === 0 ? 0 : v)
  }
  return out
}

function hex(rgb: readonly number[]): string {
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`
}

const HEIGHT: ColormapClause = { by: { kind: 'height' }, map: null, diverging: false }
// A sequential map's colours do not depend on the theme; balance's neutral
// centre does, and a level line is given the light theme's.
const LINE_THEME = { theme: 'light' as const, background: [1, 1, 1] as const }

// Each level's colour: its value on the spec's colormap, over the domain a
// height scale of f would take, or the statement's flat colour.
function levelColors(levels: readonly number[], samples: Float64Array, context: BuildContext): ColorSpec[] {
  if (context.color.author) return levels.map(() => context.color)
  const scale = colorScale(HEIGHT, samples, context.config, 0)
  return levels.map((c) => ({ author: hex(colormapAt(scale.map, LINE_THEME, normalise(c, scale) ?? 0)), slot: context.color.slot }))
}

// The vertex of the longest polyline (by arc length) nearest its arc-length
// midpoint.
export function midpointOf(lines: readonly Float64Array[]): [number, number] | null {
  let best = -1
  let bestLength = -1
  let bestCumulative = new Float64Array(0)
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k]
    const cumulative = new Float64Array(l.length / 2)
    for (let i = 1; i < cumulative.length; i++) cumulative[i] = cumulative[i - 1] + Math.hypot(l[2 * i] - l[2 * i - 2], l[2 * i + 1] - l[2 * i - 1])
    const total = cumulative[cumulative.length - 1]
    if (total > bestLength) {
      best = k
      bestLength = total
      bestCumulative = cumulative
    }
  }
  if (best < 0) return null
  const half = bestLength / 2
  let at = 0
  for (let i = 1; i < bestCumulative.length; i++) if (Math.abs(bestCumulative[i] - half) < Math.abs(bestCumulative[at] - half)) at = i
  return [lines[best][2 * at], lines[best][2 * at + 1]]
}

function contourFormOf(statement: Statement): ContourForm {
  if (statement.kind === 'space' && statement.form.form === 'contour') return statement.form
  throw new Error(`not a contour: ${statement.kind}`)
}

function prepareContourCurves(statement: Statement, context: BuildContext): PreparedStatement {
  const { scope, config } = context
  const form = contourFormOf(statement)
  const reads = new Reads(scope)
  const target = resolveTarget(form.target, scope, reads, 'contour')
  requireArity(target, 2, 'contour')
  if (form.style.opacity !== null) throw new Error(`opacity: applies to level surfaces of F(x, y, z), not to level curves — ${form.text} has two variables`)
  const f = compileOver(target.body, target, scope)
  const domain = prepareDomain(null, config, scope, reads)
  const res = resolution(form.style.res, config, LEVEL_RES)
  const width = form.style.width ?? LEVEL_WIDTH
  const dashed = form.style.dashed

  const levelsSpec: Levels = form.levels
  let authored: (() => number[]) | null = null
  if (levelsSpec.kind === 'list') {
    const fns = levelsSpec.values.map((e) => {
      reads.add(e)
      return constant(e, scope)
    })
    authored = () => fns.map((fn) => fn())
  } else if (levelsSpec.kind === 'range') {
    const [a, b, s] = [levelsSpec.from, levelsSpec.to, levelsSpec.step].map((e) => {
      reads.add(e)
      return constant(e, scope)
    })
    authored = () => {
      const [from, to, step] = [a(), b(), s()]
      if (!(step > 0)) throw new Error(`contour: levels ${from}..${to} needs a positive step, got ${step}`)
      const count = Math.floor((to - from) / step + 1e-9) + 1
      if (count > MAX_LEVELS) throw new Error(`contour: levels ${from}..${to} step ${step} is ${count} levels — at most ${MAX_LEVELS}`)
      return Array.from({ length: Math.max(0, count) }, (_, i) => from + i * step)
    }
  } else if (!(Number.isInteger(levelsSpec.count) && levelsSpec.count >= 1 && levelsSpec.count <= MAX_LEVELS)) {
    throw new Error(`contour: levels takes a whole number from 1 to ${MAX_LEVELS}, got ${levelsSpec.count}`)
  }

  const build = (): BuildResult => {
    const rect = domain()
    // f on the tracing grid: its range sets "levels n" and the colours.
    const samples: number[] = []
    let min = Infinity
    let max = -Infinity
    for (let j = 0; j <= res; j++) {
      const y = rect.y.min + ((rect.y.max - rect.y.min) * j) / res
      for (let i = 0; i <= res; i++) {
        const v = f(rect.x.min + ((rect.x.max - rect.x.min) * i) / res, y)
        if (!Number.isFinite(v)) continue
        samples.push(v)
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    const levels = authored ? authored() : niceLevels(min, max, levelsSpec.kind === 'count' ? levelsSpec.count : 1)
    if (levels.length > MAX_LEVELS) throw new Error(`contour: ${levels.length} levels — at most ${MAX_LEVELS}`)
    const colors = levelColors(levels, Float64Array.from(samples), context)
    const floor = form.floor ? toolBox(context, rect, (x, y) => f(x, y)).z.min : 0

    const marks: LineMark[] = []
    const labels: LabelAnchor[] = []
    levels.forEach((c, k) => {
      const lines = levelCurves((x, y) => f(x, y) - c, rect, res)
      if (lines.length === 0) return
      const color = colors[k]
      marks.push(lineMark(part(context, `level${k}`), lines.map((l) => lift(l, () => c)), context, { width, dashed, color }))
      if (form.floor) {
        marks.push(lineMark(part(context, `floor${k}`), lines.map((l) => lift(l, () => floor)), context, { width: FLOOR_WIDTH, dashed: true, color }))
      }
      const mid = form.labels ? midpointOf(lines) : null
      if (mid) labels.push(annotation(part(context, `label${k}`), [mid[0], mid[1], c], formatNumber(c)))
    })
    return { marks, labels, errors: [], colorScale: null }
  }

  return { reads: reads.names, build }
}

// The builder of a two-variable contour. S4a's contour: dispatcher
// (kernel/geometry/levelSurfaces.ts) calls it for a target of x and y
// (targetArity in ./target); it is not registered under a key of its own.
export const contourCurves: BuilderEntry = { draws: true, prepare: prepareContourCurves }
