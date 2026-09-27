// The kernel's public face (spec SP1, SP6): what SpaceRenderer holds. Built
// once per parsed spec; a parameter change rebuilds only the statements that
// read that parameter and returns the new scene.

import type { GraphConfig } from '../../parser/config'
import type { Statement } from '../../parser/types'
import type { Binding } from '../config'
import type { Box3, SpaceScene } from '../scene/types'

export interface SetValuesOptions {
  // The renderer's frozen box (S3's R1): while a value plays or a point is
  // dragged the frame holds still, and box-dependent statements (J1) are built
  // against this box instead of the one the new values resolve to, so they
  // stay in the frame that is drawn. A later call without it (a release, with
  // no values at all) rebuilds them in the resolved box.
  holdBox?: Box3 | null
}

export interface SpaceKernel {
  // The scene at the current binding values.
  scene(): SpaceScene
  // The spec's `@param` bindings, in source order.
  bindings(): readonly Binding[]
  // The live value of every binding, by name.
  values(): ReadonlyMap<string, number>
  // Set one binding's live value (clamped to its range, rounded when it is an
  // integer binding) and return the rebuilt scene. Statements that do not
  // read `name` keep their marks by identity, unless the change moves the
  // resolved box: then every box-dependent statement rebuilds (J1).
  setValue(name: string, value: number, options?: SetValuesOptions): SpaceScene
  // Set several bindings at once (S3: a two-parameter drag, a frame's worth
  // of slider changes): every value is written first, then each statement
  // that reads any of them is rebuilt once. Unknown names and non-finite
  // values are ignored, as in setValue. With no values it only brings the
  // box-dependent statements to the box it resolves (or holds) now.
  setValues(values: ReadonlyMap<string, number>, options?: SetValuesOptions): SpaceScene
}

// `lines[i]` is the 1-based source line of `statements[i]` (parseSpec knows
// it; a Statement does not), so every scene error names its line.
export type CreateSpaceKernel = (statements: Statement[], config: GraphConfig, lines: readonly number[]) => SpaceKernel
