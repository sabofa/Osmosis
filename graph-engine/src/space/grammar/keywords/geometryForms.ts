// The forms of phase S4a's keyword statements (surfaces in space, vectors,
// lines, planes and curve frames). types.ts carries them in SpaceForm as one
// union member, GeometryForm, so the shared file changes by one line.

import type { Expr } from '../../../parser/types'
import type { SpaceStyle } from '../types'

// "levels 12", "levels -4..4 step 1", "levels 1, 4, 9" (and "level 4").
export type Levels =
  | { kind: 'count'; n: number }
  | { kind: 'range'; from: Expr; to: Expr; step: Expr }
  | { kind: 'list'; values: Expr[] }

// "contour: <f or expr> levels ... [floor] [labels]". The target is a
// defined function's name ("g") or an inline expression; the kernel reads
// its arity. Three variables draw level surfaces (S4a); two draw level
// curves (S4b's contourCurves builder). `text` is the target as written, for
// messages and the colour scale's title.
export interface ContourForm {
  form: 'contour'
  target: Expr
  text: string
  levels: Levels
  floor: boolean
  labels: boolean
  style: SpaceStyle
}

export type GeometryForm = ContourForm
