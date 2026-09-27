// The forms of phase S4a's keyword statements (surfaces in space, vectors,
// lines, planes and curve frames). types.ts carries them in SpaceForm as one
// union member, GeometryForm, so the shared file changes by one line.

import type { Expr } from '../../../parser/types'
import type { ParamRange, SpaceStyle } from '../types'

// "levels 12", "levels -4..4 step 1", "levels 1, 4, 9" (and "level 4").
export type Levels =
  | { kind: 'count'; count: number }
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

// A point: "(1, 2, 3)", or the name of a point defined elsewhere in the spec
// ("P = (1, 2, 3)"). `text` is the operand as written, for messages.
export type PointOperand = ({ kind: 'tuple'; coords: [Expr, Expr, Expr] } | { kind: 'name'; name: string }) & { text: string }

// A vector: "<1, 2, 3>" (or "⟨1, 2, 3⟩"), a vector constant's name ("u", from
// "u = <1, 2, 3>"), or a vector function at a point ("F(1, 0, 2)").
export type VectorOperand = ({ kind: 'literal'; components: [Expr, Expr, Expr] } | { kind: 'named'; name: string; args: Expr[] | null }) & {
  text: string
}

// "line: through <point> direction <vector>" | "line: through <point> and <point>".
export interface LineForm {
  form: 'line'
  through: PointOperand
  to: { kind: 'direction'; vector: VectorOperand } | { kind: 'point'; point: PointOperand }
  // the operand as written, for messages
  text: string
  style: SpaceStyle
}

// "plane: 2x + y - z = 3" | "plane: through <point> normal <vector>" |
// "plane: through <point>, <point>, <point>".
export type PlaneDef =
  | { kind: 'equation'; left: Expr; right: Expr }
  | { kind: 'pointNormal'; point: PointOperand; normal: VectorOperand }
  | { kind: 'points'; points: [PointOperand, PointOperand, PointOperand] }

export interface PlaneForm {
  form: 'plane'
  def: PlaneDef
  text: string
  style: SpaceStyle
}

// "cross: u x v [at P]" (also "×") and "project: u onto v [at P]"; the
// tails sit at P, the origin by default.
export interface VectorOpForm {
  form: 'cross' | 'project'
  u: VectorOperand
  v: VectorOperand
  at: PointOperand | null
  style: SpaceStyle
}

// "cylindrical: <r|theta|z> = <expr> [for ...]" and
// "spherical: <rho|theta|phi> = <expr> [for ...]": one coordinate as a
// function of the other two, over their default or given ranges.
export interface CoordinateSurfaceForm {
  form: 'coordinateSurface'
  system: 'cylindrical' | 'spherical'
  solved: string
  body: Expr
  ranges: ParamRange[]
  style: SpaceStyle
}

// A space curve: a vector function's name ("r", defined by "r(t) = <...>"),
// or an inline "<cos(t), sin(t), t>" whose parameter "at" names.
export type CurveOperand = ({ kind: 'named'; name: string } | { kind: 'inline'; components: [Expr, Expr, Expr] }) & { text: string }

// "frame: r at t = 1", "osculating: r at t = 1", "motion: r at t = 1
// [components]".
export interface CurveFrameForm {
  form: 'frame' | 'osculating' | 'motion'
  curve: CurveOperand
  param: string
  at: Expr
  components: boolean
  style: SpaceStyle
}

export type GeometryForm = ContourForm | LineForm | PlaneForm | VectorOpForm | CoordinateSurfaceForm | CurveFrameForm
