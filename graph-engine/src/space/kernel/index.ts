// createSpaceKernel (K8; the contract is kernel/api.ts). Built once per parsed
// spec:
// - the MathScope is built once (kernel/scope.ts);
// - every statement is prepared once — compiled, with the names it reads
//   followed through user functions — and built;
// - setValue writes one parameter slot and rebuilds only the statements that
//   read it; every other statement's marks are the same objects, which is
//   what makes a drag cheap.
// Colour slots and colour-scale ids are handed out in source order at setup,
// so they are properties of the statements and stable across setValue.
// Hidden statements (@hide) build nothing but still define. Errors are
// returned with their line, never thrown; one bad statement never blanks the
// scene.

import type { Statement } from '../../parser/types'
import { roundHalfAway } from '../../math/compile'
import type { Binding } from '../config'
import { sceneExtent } from '../scene/extent'
import type { ColorScale, Mark, SceneError, SpaceScene } from '../scene/types'
import type { CreateSpaceKernel, SpaceKernel } from './api'
import { messageOf } from './common'
import { CURVE, IMPLICIT_CURVE } from './curves'
import { PARAMETRIC_SURFACE } from './parametric'
import { ARROW, POINT, SEGMENT } from './primitives'
import { builderFor, DEFINITION, registerBuilder, type BuildContext, type BuildResult, type PreparedStatement } from './registry'
import { buildScope } from './scope'
import { SURFACE } from './surface'
import { IMPLICIT_SURFACE } from './geometry/implicit'
import { CONTOUR } from './geometry/levelSurfaces'
import { namedPoints } from './geometry/operands'
import { LINE } from './geometry/lines'
import { PLANE } from './geometry/planes'
import { VECTOR_OP } from './geometry/vectorOps'
import { COORDINATE_SURFACE } from './geometry/coordinateSurfaces'
import { CURVE_FRAME } from './curves/frames'

// One row per statement kind or space form. A kind with no row is "not drawn
// in space".
registerBuilder('surface', SURFACE)
registerBuilder('space:surface', SURFACE)
registerBuilder('parametricSurface', PARAMETRIC_SURFACE)
registerBuilder('space:parametricSurface', PARAMETRIC_SURFACE)
registerBuilder('parametric', CURVE)
registerBuilder('space:curve', CURVE)
registerBuilder('explicit', CURVE)
registerBuilder('polar', CURVE)
registerBuilder('implicit', IMPLICIT_CURVE)
registerBuilder('point', POINT)
registerBuilder('segment', SEGMENT)
registerBuilder('ray', ARROW)
registerBuilder('vector', ARROW)
registerBuilder('space:implicitSurface', IMPLICIT_SURFACE)
// Definitions and tables draw nothing and are not errors.
for (const key of ['functionDef', 'constantDef', 'space:function', 'space:vectorFunction', 'tableHeader', 'tableRow', 'tableGenerator']) {
  registerBuilder(key, DEFINITION)
}
registerBuilder('space:contour', CONTOUR)
registerBuilder('space:line', LINE)
registerBuilder('space:plane', PLANE)
registerBuilder('space:cross', VECTOR_OP)
registerBuilder('space:project', VECTOR_OP)
registerBuilder('space:coordinateSurface', COORDINATE_SURFACE)
registerBuilder('space:frame', CURVE_FRAME)
registerBuilder('space:osculating', CURVE_FRAME)
registerBuilder('space:motion', CURVE_FRAME)

interface StatementRecord {
  line: number
  prepared: PreparedStatement
  // the bindings it reads
  reads: ReadonlySet<string>
  // the colour-scale id reserved at setup, which its meshes carry
  scaleId: number | null
  result: BuildResult
  // Copies made when this statement's scale moved to another index in the
  // scene (an earlier scale went unreferenced), kept so the copy is reused.
  moved: Map<object, { index: number; copy: Mark | ColorScale }>
}

// The same mark or scale at a new colour-scale index, reusing an earlier copy.
function atIndex<T extends Mark | ColorScale>(record: StatementRecord, original: T, index: number, make: () => T): T {
  const known = record.moved.get(original)
  if (known && known.index === index) return known.copy as T
  const copy = make()
  record.moved.set(original, { index, copy })
  return copy
}

function run(prepared: PreparedStatement, line: number): BuildResult {
  try {
    const result = prepared.build()
    return { ...result, errors: result.errors.map((e) => ({ line: e.line || line, message: e.message })) }
  } catch (err) {
    return { marks: [], labels: [], errors: [{ line, message: messageOf(err) }], colorScale: null }
  }
}

export const createSpaceKernel: CreateSpaceKernel = (statements: Statement[], config, lines) => {
  const bindings: readonly Binding[] = config.bindings
  const { scope, errors: scopeErrors } = buildScope(statements, lines, bindings, config.angle)
  const bindingNames = new Set(bindings.map((b) => b.name))
  const setupErrors: SceneError[] = []
  const records: StatementRecord[] = []
  let slots = 0
  let scales = 0
  const points = namedPoints(statements)

  statements.forEach((statement, i) => {
    const line = lines[i] ?? 0
    if (statement.statementName && config.hidden.has(statement.statementName)) return
    const entry = builderFor(statement)
    if (!entry) {
      setupErrors.push({ line, message: `${statement.kind} is not drawn in space` })
      return
    }
    const wantsScale = entry.colorScale?.(statement, config) ?? false
    const context: BuildContext = {
      scope,
      config,
      line,
      source: { line, statement: statement.statementName, object: `s${line}` },
      color: { author: statement.color, slot: entry.draws ? slots++ : -1 },
      colorScaleId: wantsScale ? scales : null,
      points,
    }
    let prepared: PreparedStatement
    try {
      prepared = entry.prepare(statement, context)
    } catch (err) {
      setupErrors.push({ line, message: messageOf(err) })
      return
    }
    // The id is taken only by a statement that compiled.
    if (wantsScale) scales++
    const result = run(prepared, line)
    records.push({
      line,
      prepared,
      reads: new Set([...prepared.reads].filter((name) => bindingNames.has(name))),
      scaleId: context.colorScaleId,
      result,
      moved: new Map(),
    })
  })

  // colorScales holds only the scales a mark references, in source order,
  // each at the index its id names. In the ordinary case that index is the id
  // reserved at setup and every object is reused; when an earlier statement's
  // scale is unreferenced (its rebuild failed), later scales and their meshes
  // are copied to their new index.
  const assemble = (): SpaceScene => {
    const colorScales: ColorScale[] = []
    const indexOf = new Map<number, number>()
    for (const record of records) {
      const scale = record.result.colorScale
      if (!scale || record.scaleId === null) continue
      const id = record.scaleId
      if (!record.result.marks.some((m) => m.kind === 'mesh' && m.style.colorScale === id)) continue
      const index = colorScales.length
      indexOf.set(id, index)
      colorScales.push(index === scale.id ? scale : atIndex(record, scale, index, () => ({ ...scale, id: index })))
    }
    const marks = records.flatMap((record) =>
      record.result.marks.map((mark) => {
        if (mark.kind !== 'mesh' || mark.style.colorScale === null) return mark
        const index = indexOf.get(mark.style.colorScale)!
        if (index === mark.style.colorScale) return mark
        return atIndex(record, mark, index, () => ({ ...mark, style: { ...mark.style, colorScale: index } }))
      })
    )
    const labels = records.flatMap((r) => r.result.labels)
    const errors = [...scopeErrors, ...setupErrors, ...records.flatMap((r) => r.result.errors)].sort((a, b) => a.line - b.line)
    return { marks, labels, colorScales, extent: sceneExtent(marks, labels), errors }
  }

  let current = assemble()

  const kernel: SpaceKernel = {
    scene: () => current,
    bindings: () => bindings,
    values: () => new Map(bindings.map((b) => [b.name, scope.params.values[scope.params.index.get(b.name)!]])),
    setValue(name, value) {
      return kernel.setValues(new Map([[name, value]]))
    },
    setValues(values) {
      const changed = new Set<string>()
      for (const [name, value] of values) {
        const slot = scope.params.index.get(name)
        const binding = bindings.find((b) => b.name === name)
        if (slot === undefined || !binding || !Number.isFinite(value)) continue
        let next = binding.integer ? roundHalfAway(value) : value
        next = Math.min(binding.max, Math.max(binding.min, next))
        if (next === scope.params.values[slot]) continue
        scope.params.values[slot] = next
        changed.add(name)
      }
      if (changed.size === 0) return current
      // Each statement that reads any changed binding rebuilds once.
      for (const record of records) {
        if (![...changed].some((name) => record.reads.has(name))) continue
        record.result = run(record.prepared, record.line)
        record.moved.clear()
      }
      current = assemble()
      return current
    },
  }
  return kernel
}
