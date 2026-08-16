// Narrow entry point for consumers (e.g. a Node server) that only need the
// pure text-spec parser — no React, no Three.js, no DOM. Everything reached
// transitively from here (./parseSpec, ./config, ./parseConfig,
// ./parseStatement, ./types) is plain string/logic parsing with zero browser
// dependencies. Do not add imports from '../GraphViewer', '../TableView', or
// '../scene/*' here — those pull in React/Three and defeat the point of this
// file existing as a separate build entry.
export { parseSpec } from './parseSpec'
export type { Statement, Condition, ParseError, ParseResult } from './types'
export { defaultConfig } from './config'
export type { GraphConfig, GraphBounds, HoverMode, FeaturePointKind } from './config'
