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

import type { GraphConfig } from '../../parser/config'
import type { Statement } from '../../parser/types'
import type { MathScope } from '../../math/scope'
import type { ColorScale, ColorSpec, LabelAnchor, Mark, MarkSource, SceneError } from '../scene/types'
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
}

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

// A builder registered under a name rather than a statement kind, for a
// builder that dispatches ("contour:" hands two-variable targets to S4b's
// "contourCurves"); undefined until that builder is registered.
export function registeredBuilder(key: string): BuilderEntry | undefined {
  return REGISTRY.get(key)
}

export function emptyResult(): BuildResult {
  return { marks: [], labels: [], errors: [], colorScale: null }
}

// A statement that draws nothing and reads nothing (a definition).
export const DEFINITION: BuilderEntry = {
  draws: false,
  prepare: () => ({ reads: new Set(), build: emptyResult }),
}
