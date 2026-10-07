import type { SettingsLayer } from './layers'
import type { GraphType } from './theme/types'

// What each graph type changes from the registry's defaults: layer 2 of the stack (style/layers.ts).
//
// Empty to start. The types that draw today look as the registry says, and a type that needs its own
// default adds it here, as a settings layer (a preset, and single settings by registry path):
//
//   figure2d: { set: { 'style.line.looseness': 0.1 } },
//
// It is a module of its own, as theme/builtinStyles.ts is, so that a test can stand in a table of its
// own (layers.typeDefaults.test.ts) and show that the stack reads it, resolveStyle's two layers included.
// A theme's setting still beats an entry here (Ben's ruling): this is only the default of a type.
export const TYPE_DEFAULTS: Readonly<Partial<Record<GraphType, SettingsLayer>>> = Object.freeze({})
