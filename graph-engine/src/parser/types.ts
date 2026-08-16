import type { GraphConfig } from './config'

// Expression AST — a hand-rolled recursive-descent grammar covering standard
// infix math (+ - * / ^), implicit multiplication (2x, 3(x+1)), unary minus,
// and a fixed function set (sin cos tan sqrt abs log ln exp).

export type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: string }
  | { kind: 'unary'; op: '-'; arg: Expr }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: Expr; right: Expr }
  | { kind: 'call'; name: string; args: Expr[] }

// A domain guard on an explicit statement's independent variable, from a
// trailing "if <condition>" clause — what makes piecewise functions work
// without a dedicated "piecewise" statement kind (see parseStatement.ts).
export type Condition =
  | { kind: 'compare'; op: '<' | '<=' | '>' | '>='; value: Expr }
  | { kind: 'range'; lowOp: '<' | '<='; low: Expr; highOp: '<' | '<='; high: Expr }

// One line of the input spec, after parsing.
//
// Grammar (documented here as the source of truth for the parser):
//   y = <expr(x)> [if <condition>]              -> explicit function of x (2D); condition makes it piecewise
//   x = <expr(y)> [if <condition>]              -> explicit function of y (2D)
//   z = <expr(x,y)>                             -> explicit surface (3D)
//   r = <expr(theta)> [for theta in [a, b]]      -> polar curve (2D); theta defaults to [0, 2*pi]
//   <expr(x,y)> = <expr(x,y)>                   -> implicit curve (conics, circles, etc.; 2D)
//   <expr(x,y)> <|<=|>|>= <expr(x,y)>            -> shaded inequality region (2D)
//   field: dy/dx = <expr(x,y)>                   -> slope/direction field (2D, diff eq)
//   scatter: (x1,y1), (x2,y2), ...               -> scatter points + auto linear regression (2D)
//   label = (x, y[, z])  |  (x, y[, z])          -> point, label optional; 3-tuple is a 3D point
//   (x1,y1[,z1]) -- (x2,y2[,z2])                 -> segment
//   (x1,y1[,z1]) -> (x2,y2[,z2])                 -> ray
//   (fx(t), fy(t)[, fz(t)]) for t in [a, b]      -> parametric curve; 3-tuple is a 3D curve
//   (fx(u,v), fy(u,v), fz(u,v)) for u in [a,b], v in [c,d]  -> parametric surface (3D)
//   [<name>.]header: cell | cell | ...            -> table header row (table mode)
//   [<name>.]row: cell | cell | ...               -> table data row (table mode)
//   [<name>.]table: y = <expr(x)> for x in [a, b] step s  -> auto-generated value table (table mode)
//   vector: (x1,y1[,z1]) -> (x2,y2[,z2])          -> like a ray, but labeled with its magnitude
//   tangent: <expr(x)> at x = <value>             -> tangent line + point at that x (2D)
//   animate: (fx(t), fy(t)[, fz(t)]) for t in [a, b]  -> a point that continuously traces the path
//   <name>(<param>) = <expr(param)>               -> named function definition (e.g. "k(x) = x^2 + 1");
//                                                     usable in later statements as k(...), including composed
//                                                     with itself/other functions, e.g. "y = k(k(x))"
//   <name> = <expr>                                -> named constant (e.g. "a = 5"); usable as a bare
//                                                     variable in later statements, e.g. "y = a*x + 1"
//   circle: (cx, cy), r                            -> circle by center + radius (2D)
//   polygon: A(x,y), B(x,y), C(x,y), ...            -> closed shape from >= 3 labeled vertices; each
//                                                     vertex is also registered as a named point (like
//                                                     "A = (x, y)") usable by angle:/tick:/right-angle:
//                                                     and by name in later statements' expressions
//   angle: A-B-C [label: <text>]                    -> arc marking the interior angle at B, between rays
//                                                     B->A and B->C; A/B/C must be names of points defined
//                                                     elsewhere in the spec (a plain point statement or a
//                                                     polygon vertex), order-independent same as functions.
//                                                     An optional "label:" clause (must come last if
//                                                     combined with color:/name:) shows arbitrary text
//                                                     (e.g. "60°", "x°") near the arc.
//   tick: A-B [count: <n>]                          -> congruence tick mark(s) across segment A-B, A/B
//                                                     resolved the same way as angle:'s points. count
//                                                     defaults to 1; use a matching count on another
//                                                     tick: to mark two segments as congruent.
//   right-angle: A-B-C                              -> small square marker at vertex B indicating a
//                                                     90-degree angle between rays B->A and B->C.
//
// Any statement may end with "color: <name>" (see parser/colors.ts for the
// palette, or "#rrggbb") to override its default color, and/or "name: <id>"
// to give the statement a name that "@hide: <id>" / "@show: <id>" (see
// parser/config.ts) can target — independent of the identifier a
// "k(x) = ..." function definition carries, so a plotted statement that
// USES a function can share that function's name on purpose, e.g.
// "y = k(x) name: k" lets "@hide: k" hide this specific curve. Both clauses
// can appear together, in either order.
//
// A table statement ("[<name>.]header:"/"row:"/"table:") may be prefixed
// with a name and a dot to target one specific table when a spec defines
// more than one, e.g. "scores.header: ..." / "scores.row: ..." — every
// unprefixed header:/row:/table: line belongs to the same default (unnamed)
// table. "@hide"/"@show" can target a table by this same name too.
//
// z fields are optional on the 2D-shaped statements — present, a statement is
// 3D; absent, it's plotted at z=0 in a 3D scene and ignored entirely in a 2D one.
export type StatementShape =
  | { kind: 'explicit'; independent: 'x' | 'y'; body: Expr; condition: Condition | null }
  | { kind: 'surface'; body: Expr }
  | { kind: 'polar'; body: Expr; from: Expr; to: Expr }
  | { kind: 'implicit'; left: Expr; right: Expr }
  | { kind: 'region'; left: Expr; op: '<' | '<=' | '>' | '>='; right: Expr }
  | { kind: 'field'; body: Expr }
  | { kind: 'scatter'; points: [Expr, Expr][] }
  | { kind: 'point'; label: string | null; x: Expr; y: Expr; z: Expr | null }
  | { kind: 'segment'; x1: Expr; y1: Expr; z1: Expr | null; x2: Expr; y2: Expr; z2: Expr | null }
  | { kind: 'ray'; x1: Expr; y1: Expr; z1: Expr | null; x2: Expr; y2: Expr; z2: Expr | null }
  | { kind: 'vector'; x1: Expr; y1: Expr; z1: Expr | null; x2: Expr; y2: Expr; z2: Expr | null }
  | { kind: 'tangent'; body: Expr; at: Expr }
  | { kind: 'animatedPoint'; fx: Expr; fy: Expr; fz: Expr | null; param: string; from: Expr; to: Expr }
  | { kind: 'parametric'; fx: Expr; fy: Expr; fz: Expr | null; param: string; from: Expr; to: Expr }
  | {
      kind: 'parametricSurface'
      fx: Expr
      fy: Expr
      fz: Expr
      paramU: string
      paramV: string
      uFrom: Expr
      uTo: Expr
      vFrom: Expr
      vTo: Expr
    }
  | { kind: 'tableHeader'; tableName: string; cells: string[] }
  | { kind: 'tableRow'; tableName: string; cells: string[] }
  | { kind: 'tableGenerator'; tableName: string; dependent: string; body: Expr; formula: string; independent: string; from: Expr; to: Expr; step: Expr }
  | { kind: 'functionDef'; name: string; param: string; body: Expr }
  | { kind: 'constantDef'; name: string; value: Expr }
  | { kind: 'circle'; cx: Expr; cy: Expr; radius: Expr }
  | { kind: 'polygon'; vertices: { label: string; x: Expr; y: Expr }[] }
  | { kind: 'angle'; from: string; vertex: string; to: string; label: string | null }
  | { kind: 'tick'; from: string; to: string; count: number }
  | { kind: 'rightAngle'; from: string; vertex: string; to: string }

// Every statement carries an optional color override and an optional
// statementName (for @hide/@show targeting — see buildScene.ts), both
// spliced off the line before the kind-specific grammar runs (see
// parseStatement.ts's outer wrapper) — kept as an intersection so each
// variant above doesn't need its own copy of the fields.
//
// Named "statementName", not "name", specifically to avoid colliding with
// functionDef/constantDef's own "name" field above (a function/constant's
// *identifier*, e.g. "k" in "k(x) = ..." — a completely different concept
// from "what @hide/@show can call this statement", even though both are
// spelled "name: ..." in the DSL itself).
export type Statement = StatementShape & { color: string | null; statementName: string | null }

export interface ParseError {
  line: number
  message: string
}

export interface ParseResult {
  statements: Statement[]
  errors: ParseError[]
  config: GraphConfig
}
