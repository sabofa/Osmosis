// The builder registry (K8, SP2). One entry per statement kind, or per space
// form ("space:surface", ...), so later sub-projects add a builder by adding
// a row, never by editing a switch.
//
// A builder is two-phase. prepare(statement, context) runs once per kernel:
// it compiles every expression (a CompileError, or any throw, becomes a
// scene error on the statement's line) and reports the free names the
// statement reads. build() re-samples with the current parameter values and
// runs again on every setValue that touches one of those names. Errors are
// returned, never thrown past the kernel.
//
// The box pass (integration J1). A box-dependent builder (boxDependent) is one
// whose geometry needs the axis box the scene resolves to: a plane or a line
// spanning it, a surface sampled over it, a tool's floor copy. The kernel
// builds every other statement first, resolves the box from their extent with
// frame/bounds.ts's resolveBox (the renderer's own function), sets
// context.box, and only then builds the box-dependent ones. Their marks never
// size the box, so the renderer, resolving over the scene's extent, draws the
// same box by construction.

import type { GraphConfig } from '../../parser/config'
import type { Statement } from '../../parser/types'
import type { MathScope } from '../../math/scope'
import type { Box3, ColorScale, ColorSpec, LabelAnchor, Mark, MarkSource, SceneError } from '../scene/types'
import type { NamedPoint } from './geometry/operands'

export interface BuildContext {
  scope: MathScope
  config: GraphConfig
  // 1-based source line.
  line: number
  // The statement's primary mark source, "s<line>".
  source: MarkSource
  // The statement's colour, author and categorical slot. The slot is a
  // property of the statement (handed out in source order at setup), so it
  // is stable across setValue.
  color: ColorSpec
  // The id reserved for this statement's colour scale, or null when it
  // cannot have one. Stable across setValue for the same reason.
  colorScaleId: number | null
  // The spec's named points ("P = (1, 2, 3)"), hidden or not, for statements
  // that take a point by name (S4a: "line: through P and Q").
  points?: ReadonlyMap<string, NamedPoint>
  // Statements that bind a name to a shape rather than a value ("R = region
  // ...", S5), by that name: what "over R" and "centroid: R" resolve. Every
  // one in the spec, hidden or not, collected once at setup.
  named: ReadonlyMap<string, NamedStatement>
  // The box a box-dependent statement builds against (J1), set by the kernel
  // before each of its builds: the box resolved from the other statements, or
  // the renderer's frozen box during play and drag (setValues' holdBox).
  // Undefined for a statement that is not box-dependent. Read it through
  // boxOf.
  box?: Box3
}

export interface NamedStatement {
  line: number
  statement: Statement
}

export interface BuildResult {
  marks: Mark[]
  labels: LabelAnchor[]
  // Returned, not thrown: e.g. crossing bounds. A builder may also throw from
  // build(); the kernel turns that into an error on the statement's line.
  errors: SceneError[]
  // The statement's colour scale this build, whose id is context.colorScaleId.
  colorScale: ColorScale | null
}

export interface PreparedStatement {
  // Every free name the statement's expressions read, followed through user
  // functions; the kernel keeps the ones that are bindings.
  reads: ReadonlySet<string>
  build(): BuildResult
}

export interface BuilderEntry {
  prepare(statement: Statement, context: BuildContext): PreparedStatement
  // Whether the statement draws, and so takes a colour slot.
  draws: boolean
  // Whether the statement can carry a colour scale (reserves an id).
  colorScale?(statement: Statement, config: GraphConfig): boolean
  // The shape name the statement binds (BuildContext.named), if any.
  binds?(statement: Statement): string | null
  // Box-dependent (J1). true: built after the box is resolved, against
  // context.box, and its marks do not size the box. 'z': its x and y size the
  // box (a first build, against the provisional box — @bounds3d, else
  // [-5, 5] — counts only them), and it is rebuilt against the resolved box,
  // whose floor it lies on (a region shaded on the floor). A function decides
  // per statement (a coordinate surface reads the box only through a
  // defaulted range); false is not box-dependent.
  boxDependent?: BoxDependence | ((statement: Statement) => BoxDependence | false)
}

export type BoxDependence = true | 'z'

const REGISTRY = new Map<string, BuilderEntry>()

export function registryKey(statement: Statement): string {
  return statement.kind === 'space' ? `space:${statement.form.form}` : statement.kind
}

export function registerBuilder(key: string, entry: BuilderEntry): void {
  REGISTRY.set(key, entry)
}

export function builderFor(statement: Statement): BuilderEntry | undefined {
  return REGISTRY.get(registryKey(statement))
}

export function sameBox(a: Box3, b: Box3): boolean {
  return a.x.min === b.x.min && a.x.max === b.x.max && a.y.min === b.y.min && a.y.max === b.y.max && a.z.min === b.z.min && a.z.max === b.z.max
}

// The box a box-dependent builder draws into (J1).
export function boxOf(context: BuildContext): Box3 {
  if (!context.box) throw new Error(`internal: line ${context.line} needs the scene's box, and it was built without one`)
  return context.box
}

export function emptyResult(): BuildResult {
  return { marks: [], labels: [], errors: [], colorScale: null }
}

// A statement that draws nothing and reads nothing (a definition).
export const DEFINITION: BuilderEntry = {
  draws: false,
  prepare: () => ({ reads: new Set(), build: emptyResult }),
}
