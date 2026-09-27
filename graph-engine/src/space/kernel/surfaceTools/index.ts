// The calculus of a surface's builders (S4b), one row per space form, which
// kernel/index.ts registers. contourCurves is not a row: S4a's contour:
// dispatcher calls it for a two-variable target.

import type { BuilderEntry } from '../registry'
import { PATH } from './paths'
import { TANGENT_PLANE } from './tangentPlanes'
import { TRACE } from './traces'

export const SURFACE_TOOL_BUILDERS: readonly (readonly [string, BuilderEntry])[] = [
  ['space:path', PATH],
  ['space:trace', TRACE],
  ['space:tangentPlane', TANGENT_PLANE],
]
