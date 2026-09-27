// The calculus of a surface's builders (S4b), one row per space form, which
// kernel/index.ts registers. contourCurves is not a row: S4a's contour:
// dispatcher calls it for a two-variable target.

import type { BuilderEntry } from '../registry'
import { PATH } from './paths'

export const SURFACE_TOOL_BUILDERS: readonly (readonly [string, BuilderEntry])[] = [['space:path', PATH]]
