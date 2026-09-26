// The kernel's public face (spec SP1, SP6): what SpaceRenderer holds. Built
// once per parsed spec; a parameter change rebuilds only the statements that
// read that parameter and returns the new scene.

import type { GraphConfig } from '../../parser/config'
import type { Statement } from '../../parser/types'
import type { Binding } from '../config'
import type { SpaceScene } from '../scene/types'

export interface SpaceKernel {
  // The scene at the current binding values.
  scene(): SpaceScene
  // The spec's `@param` bindings, in source order.
  bindings(): readonly Binding[]
  // The live value of every binding, by name.
  values(): ReadonlyMap<string, number>
  // Set one binding's live value (clamped to its range, rounded when it is an
  // integer binding) and return the rebuilt scene. Statements that do not
  // read `name` keep their marks by identity.
  setValue(name: string, value: number): SpaceScene
}

export type CreateSpaceKernel = (statements: Statement[], config: GraphConfig) => SpaceKernel
