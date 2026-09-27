// "contour:" (plan A2). The builder dispatches on the target's arity:
// - three variables (g(x, y, z), or an expression reading z) draw LEVEL
//   SURFACES, here, by marching tetrahedra over the box (implicit.ts);
// - two variables draw level curves, built by phase S4b's "contourCurves"
//   builder. Until S4b registers it, a two-variable contour is an error on
//   its line.
//
// Levels (levelValues):
// - "levels n": the multiples of niceStep(range, n) strictly inside the
//   range of F sampled on a 16^3 grid over the box;
// - "levels a..b step s" and "levels a, b, c" are used as written.
// Each level is one mesh, "s<line>.level<k>" (k from 1). With more than one
// level the meshes default to opacity 0.45, and each takes the colour of its
// value on the spec's colormap (one colour scale, titled with the target);
// one level, or a color: clause, draws flat. "labels" writes each level's
// value at its surface's highest point.

import type { Expr, Statement } from '../../../parser/types'
import { freeVariablesDeep } from '../../../math/compile'
import { call, variable } from '../../../math/expr'
import { isVectorBody, type MathScope } from '../../../math/scope'
import { niceStep } from '../../frame/nice'
import { MAX_LEVELS } from '../../grammar/keywords/contour'
import type { ContourForm } from '../../grammar/keywords/geometryForms'
import { formatNumber } from '../../pick/format'
import type { ColorScale, LabelAnchor, MeshMark, Range, SceneError } from '../../scene/types'
import { constant, MAX_TRIANGLES, Reads } from '../common'
import { registeredBuilder, type BuildContext, type BuildResult, type BuilderEntry, type PreparedStatement } from '../registry'
import { spaceBox } from './box'
import { compileField, DEFAULT_IMPLICIT_RES, implicitPick, levelMesh, XYZ } from './implicit'
import { countTriangles, implicitRes, sampledRange, sampleGrid } from './marchingTets'

// "levels n" divides the range of F sampled on this many points per axis.
export const LEVEL_RANGE_SAMPLES = 16
export const LEVEL_OPACITY = 0.45
// The most level surfaces one contour draws: each is a marching pass.
export const MAX_LEVEL_SURFACES = 20

export function contourForm(statement: Statement): ContourForm {
  if (statement.kind === 'space' && statement.form.form === 'contour') return statement.form
  throw new Error(`not a contour: ${statement.kind}`)
}

// The target's arity, and F over its variables: a defined function's name
// is called with (x, y) or (x, y, z); an inline expression has three
// variables when it reads z.
export function contourTarget(form: ContourForm, scope: MathScope): { arity: 2 | 3; F: Expr } {
  const target = form.target
  if (target.kind === 'var') {
    const fn = scope.functions.get(target.name)
    if (fn && fn.params.length > 0) {
      if (isVectorBody(fn.body)) throw new Error(`contour: ${target.name} is vector-valued — a contour needs a function of two or three variables`)
      if (fn.params.length === 2) return { arity: 2, F: call(target.name, variable('x'), variable('y')) }
      if (fn.params.length === 3) return { arity: 3, F: call(target.name, variable('x'), variable('y'), variable('z')) }
      throw new Error(`contour: ${target.name} takes ${fn.params.length} variable — a contour needs a function of two or three variables`)
    }
  }
  return { arity: freeVariablesDeep(target, scope).has('z') ? 3 : 2, F: target }
}

// The multiples of niceStep(span, n) strictly inside the range.
export function levelsInside(range: Range, n: number): number[] {
  const step = niceStep(range.max - range.min, n)
  const out: number[] = []
  for (let k = Math.floor(range.min / step) + 1; k * step < range.max; k++) {
    // 12 digits clear the product's rounding (3 * 0.1 is 0.30000000000000004).
    const value = Number((k * step).toPrecision(12))
    if (value > range.min && value < range.max) out.push(value)
  }
  return out
}

// A prepared "levels" clause: its values at the current parameters, given
// the sampled range for "levels n".
export function prepareLevels(form: ContourForm, scope: MathScope, reads: Reads): (range: () => Range | null) => number[] {
  const levels = form.levels
  switch (levels.kind) {
    case 'count':
      return (range) => {
        const r = range()
        if (!r || !(r.max > r.min)) throw new Error(`contour: ${form.text} is constant over the box — list its levels, e.g. "levels 1, 2"`)
        const values = levelsInside(r, levels.count)
        if (values.length === 0) throw new Error(`contour: ${form.text} has no nice level inside its range — list its levels`)
        return values
      }
    case 'list': {
      const values = levels.values.map((e) => {
        reads.add(e)
        return constant(e, scope)
      })
      return () => values.map((f) => f())
    }
    case 'range': {
      const [from, to, step] = [levels.from, levels.to, levels.step].map((e) => {
        reads.add(e)
        return constant(e, scope)
      })
      return () => {
        const [a, b, s] = [from(), to(), step()]
        if (!(s > 0)) throw new Error(`The step of "levels a..b step s" must be positive, got ${formatNumber(s)}`)
        if (!(b >= a)) throw new Error(`"levels a..b" needs a ≤ b, got ${formatNumber(a)}..${formatNumber(b)}`)
        const count = Math.floor((b - a) / s + 1e-9) + 1
        if (count > MAX_LEVELS) throw new Error(`A contour draws at most ${MAX_LEVELS} levels; ${formatNumber(a)}..${formatNumber(b)} step ${formatNumber(s)} is ${count}`)
        return Array.from({ length: count }, (_, i) => a + i * s)
      }
    }
  }
}

function prepareLevelSurfaces(form: ContourForm, F: Expr, context: BuildContext): PreparedStatement {
  const { scope, config } = context
  if (form.floor) throw new Error(`"floor" projects level curves of f(x, y) onto the floor — ${form.text} has three variables and draws level surfaces`)
  if (form.style.width !== null) throw new Error('width: applies to level curves of f(x, y), not to level surfaces')
  if (form.style.dashed) throw new Error('dashed applies to level curves of f(x, y), not to level surfaces')
  const n = implicitRes(form.style.res, config.space.resolution, DEFAULT_IMPLICIT_RES)
  const reads = new Reads(scope).add(F, XYZ)
  const field = compileField(F, scope)
  const levelsOf = prepareLevels(form, scope, reads)

  const build = (): BuildResult => {
    const box = spaceBox(config)
    const values = levelsOf(() => sampledRange(field.f, box, LEVEL_RANGE_SAMPLES))
    if (values.length > MAX_LEVEL_SURFACES) {
      throw new Error(`contour: ${form.text} would draw ${values.length} level surfaces — at most ${MAX_LEVEL_SURFACES}; give fewer levels`)
    }
    const grid = sampleGrid(field.f, box, n)
    // The triangle budget is the statement's, not each level's (SP2), and is
    // checked before any level is meshed.
    const total = values.reduce((sum, c) => sum + countTriangles(grid, c), 0)
    if (total > MAX_TRIANGLES) {
      const surfaces = `${values.length} level surface${values.length === 1 ? '' : 's'}`
      throw new Error(
        `contour: ${form.text} at res ${n} would make ${total.toLocaleString('en-US')} triangles over ${surfaces}, over the ${MAX_TRIANGLES.toLocaleString('en-US')} limit — lower the resolution or give fewer levels`
      )
    }
    const mapped = values.length > 1 && context.colorScaleId !== null
    let scale: ColorScale | null = null
    if (mapped) {
      let min = Math.min(...values)
      let max = Math.max(...values)
      if (!(max > min)) [min, max] = [min - 0.5, max + 0.5]
      scale = { id: context.colorScaleId!, title: form.text, map: config.space.colormap, domain: { min, max }, diverging: false }
    }
    const opacity = form.style.opacity ?? (values.length > 1 ? LEVEL_OPACITY : 1)
    const marks: MeshMark[] = []
    const labels: LabelAnchor[] = []
    const errors: SceneError[] = []
    values.forEach((c, i) => {
      const object = `${context.source.object}.level${i + 1}`
      const mesh = levelMesh(field, grid, c)
      if (!mesh) {
        errors.push({ line: context.line, message: `The level ${formatNumber(c)} of ${form.text} does not meet the box` })
        return
      }
      const vertices = mesh.positions.length / 3
      marks.push({
        kind: 'mesh',
        source: { ...context.source, object },
        positions: mesh.positions,
        normals: mesh.normals,
        indices: mesh.indices,
        scalars: scale ? new Float64Array(vertices).fill(c) : null,
        uv: null,
        style: { color: context.color, opacity, colorScale: scale ? scale.id : null, meshLines: null },
        pick: implicitPick(field, c),
      })
      if (form.labels) {
        let top = 0
        for (let v = 1; v < vertices; v++) if (mesh.positions[3 * v + 2] > mesh.positions[3 * top + 2]) top = v
        labels.push({
          source: { ...context.source, object: `${object}.label` },
          position: [mesh.positions[3 * top], mesh.positions[3 * top + 1], mesh.positions[3 * top + 2]],
          text: formatNumber(c),
          kind: 'annotation',
        })
      }
    })
    return { marks, labels, errors, colorScale: marks.length > 0 ? scale : null }
  }

  return { reads: reads.names, build }
}

function prepareContour(statement: Statement, context: BuildContext): PreparedStatement {
  const form = contourForm(statement)
  const { arity, F } = contourTarget(form, context.scope)
  if (arity === 3) return prepareLevelSurfaces(form, F, context)
  const curves = registeredBuilder('contourCurves')
  if (!curves) throw new Error('level curves arrive with phase S4b')
  return curves.prepare(statement, context)
}

export const CONTOUR: BuilderEntry = {
  draws: true,
  prepare: prepareContour,
  // Levels are coloured by value unless the author names a colour.
  colorScale: (statement) => statement.color === null,
}
