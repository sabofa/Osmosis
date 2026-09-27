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
//
// The box pass (integration J1; registry.ts). Statements build in two passes:
// 1. every statement that is not box-dependent, and the x and y of each 'z'
//    one (built against the provisional box, resolveBox with no data);
// 2. the extent of what pass 1 drew (extentOf) resolves the box with
//    frame/bounds.ts's resolveBox, and every box-dependent statement builds
//    against it (context.box).
// The scene's extent is pass 1's, so the renderer's resolveBox over it is the
// kernel's box, by construction: a box-dependent mark can never move it. On
// setValue, pass 1 rebuilds what reads a changed binding; when the resolved
// box moves, every box-dependent statement rebuilds, otherwise only those that
// read a changed binding (the S1 identity rule). During play and drag the
// renderer passes its frozen box (holdBox), and box-dependent statements
// build against that instead of the resolved box, so they stay in the frame
// that is drawn; a later call without it brings them to the resolved box.

import type { Statement } from '../../parser/types'
import { roundHalfAway } from '../../math/compile'
import type { Binding } from '../config'
import { sceneExtent } from '../scene/extent'
import { resolveBox } from '../frame/bounds'
import type { Box3, ColorScale, LabelAnchor, Mark, Range, SceneError, SpaceScene } from '../scene/types'
import type { CreateSpaceKernel, SpaceKernel } from './api'
import { messageOf } from './common'
import { CURVE, IMPLICIT_CURVE } from './curves'
import { collectNamed } from './integrals/named'
import { CENTROID } from './integrals/centroids'
import { NAMED_REGION, REGION } from './integrals/regions'
import { RIEMANN } from './integrals/riemann'
import { NAMED_VOLUME, VOLUME } from './integrals/volumes2'
import { PARAMETRIC_SURFACE } from './parametric'
import { ARROW, POINT, SEGMENT } from './primitives'
import { builderFor, DEFINITION, registerBuilder, sameBox, type BuildContext, type BuilderEntry, type BuildResult, type PreparedStatement } from './registry'
import { coordinateSurfaceReadsBox } from './geometry/coordinateSurfaces'
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
import { SURFACE_TOOL_BUILDERS } from './surfaceTools'

// One row per statement kind or space form. A kind with no row is "not drawn
// in space". onBox marks a box-dependent row (J1, registry.ts): a surface
// sampled over the box, a line or plane spanning it, a curve frame sized by
// it, every tool of S4b (its default domain and floor are the box's), a
// centroid's drop lines to the floor and walls; by its z only, a region
// shaded on the floor; and a coordinate surface only when a defaulted range
// reads the box.
const onBox = (entry: BuilderEntry, dependence: NonNullable<BuilderEntry['boxDependent']> = true): BuilderEntry => ({ ...entry, boxDependent: dependence })
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
registerBuilder('space:implicitSurface', onBox(IMPLICIT_SURFACE))
// Definitions and tables draw nothing and are not errors.
for (const key of ['functionDef', 'constantDef', 'space:function', 'space:vectorFunction', 'tableHeader', 'tableRow', 'tableGenerator']) {
  registerBuilder(key, DEFINITION)
}
registerBuilder('space:contour', onBox(CONTOUR))
registerBuilder('space:line', onBox(LINE))
registerBuilder('space:plane', onBox(PLANE))
registerBuilder('space:cross', VECTOR_OP)
registerBuilder('space:project', VECTOR_OP)
registerBuilder('space:coordinateSurface', onBox(COORDINATE_SURFACE, (statement) => coordinateSurfaceReadsBox(statement)))
registerBuilder('space:frame', onBox(CURVE_FRAME))
registerBuilder('space:osculating', CURVE_FRAME)
registerBuilder('space:motion', CURVE_FRAME)
for (const [key, entry] of SURFACE_TOOL_BUILDERS) registerBuilder(key, onBox(entry))
registerBuilder('space:region', onBox(REGION, 'z'))
registerBuilder('space:namedRegion', NAMED_REGION)
registerBuilder('space:centroid', onBox(CENTROID))
registerBuilder('space:volume', VOLUME)
registerBuilder('space:riemann', RIEMANN)
registerBuilder('space:namedVolume', NAMED_VOLUME)

// When a statement builds (J1): 'data' in the first pass (it sizes the box),
// 'box' in the second, 'z' in both (its x and y size the box; it takes the
// resolved box's floor).
type Stage = 'data' | 'box' | 'z'

interface StatementRecord {
  line: number
  stage: Stage
  // The context its builds read; the kernel sets context.box before each.
  context: BuildContext
  // The box its last build read (undefined for a 'data' statement).
  builtWith: Box3 | undefined
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

const EMPTY: Range = { min: Infinity, max: -Infinity }

function hull(a: Range, b: Range): Range {
  return { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) }
}

// The extent the box is resolved from: the 'data' statements' marks and
// labels (sceneExtent: exact x and y, robust z), with the x and y of the 'z'
// statements'. An axis with no data is the empty range, which resolveBox
// treats as no data; null when nothing is drawn.
function extentOf(records: readonly StatementRecord[]): Box3 | null {
  const gather = (stage: Stage) => {
    const marks: Mark[] = []
    const labels: LabelAnchor[] = []
    for (const r of records) {
      if (r.stage !== stage) continue
      marks.push(...r.result.marks)
      labels.push(...r.result.labels)
    }
    return sceneExtent(marks, labels)
  }
  const data = gather('data')
  const floor = gather('z')
  if (!floor) return data
  return {
    x: data ? hull(data.x, floor.x) : floor.x,
    y: data ? hull(data.y, floor.y) : floor.y,
    z: data ? data.z : EMPTY,
  }
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
  const { named, errors: namedErrors } = collectNamed(statements, lines, scope)
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
      named,
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
    const dependence = typeof entry.boxDependent === 'function' ? entry.boxDependent(statement) : entry.boxDependent
    records.push({
      line,
      stage: dependence === true ? 'box' : dependence === 'z' ? 'z' : 'data',
      context,
      builtWith: undefined,
      prepared,
      reads: new Set([...prepared.reads].filter((name) => bindingNames.has(name))),
      scaleId: context.colorScaleId,
      result: { marks: [], labels: [], errors: [], colorScale: null },
      moved: new Map(),
    })
  })

  const build = (record: StatementRecord, box: Box3 | undefined) => {
    record.context.box = box
    record.builtWith = box
    record.result = run(record.prepared, record.line)
    record.moved.clear()
  }
  // Whether a box-dependent statement's last build is out of date in `box`:
  // a 'z' statement reads only the box's z (its floor), so a box that moved
  // in x or y alone leaves it as it is.
  const stale = (record: StatementRecord, box: Box3) => {
    const was = record.builtWith
    if (!was) return true
    if (record.stage === 'z') return was.z.min !== box.z.min || was.z.max !== box.z.max
    return !sameBox(was, box)
  }

  // Pass 1: what sizes the box; a 'z' statement against the provisional box.
  const provisional = resolveBox(config.space, null)
  for (const record of records) if (record.stage !== 'box') build(record, record.stage === 'z' ? provisional : undefined)
  let extent = extentOf(records)
  // The box the box-dependent statements are built against.
  let builtBox = resolveBox(config.space, extent)
  // Pass 2: what needs the box (a 'z' statement only when its z moved).
  for (const record of records) if (record.stage !== 'data' && stale(record, builtBox)) build(record, builtBox)

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
    const errors = [...scopeErrors, ...namedErrors, ...setupErrors, ...records.flatMap((r) => r.result.errors)].sort((a, b) => a.line - b.line)
    // Pass 1's extent, not every mark's: the renderer resolves the same box.
    return { marks, labels, colorScales, extent, errors }
  }

  let current = assemble()

  const kernel: SpaceKernel = {
    scene: () => current,
    bindings: () => bindings,
    values: () => new Map(bindings.map((b) => [b.name, scope.params.values[scope.params.index.get(b.name)!]])),
    setValue(name, value, options) {
      return kernel.setValues(new Map([[name, value]]), options)
    },
    setValues(values, options = {}) {
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
      const reads = (record: StatementRecord) => [...changed].some((name) => record.reads.has(name))
      // Pass 1: each statement that sizes the box and reads a changed
      // binding rebuilds once; a 'z' one against the box it is in now.
      let rebuilt = false
      for (const record of records) {
        if (record.stage === 'box' || !reads(record)) continue
        build(record, record.stage === 'z' ? builtBox : undefined)
        rebuilt = true
      }
      if (rebuilt) extent = extentOf(records)
      // Pass 2, against the held box or the one the data resolves to now:
      // every box-dependent statement whose last build that box outdates,
      // and those that read a changed binding.
      const target = options.holdBox ?? resolveBox(config.space, extent)
      for (const record of records) {
        if (record.stage === 'data') continue
        if (stale(record, target) || (record.stage === 'box' && reads(record))) {
          build(record, target)
          rebuilt = true
        }
      }
      builtBox = target
      if (!rebuilt) return current
      current = assemble()
      return current
    },
  }
  return kernel
}
