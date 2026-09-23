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

// --------------------------------------------------------------------------
// Geometry constructions (Geometry v2, phase 1)
//
// These describe a construction by *name*, not by coordinates — resolving the
// names and doing the arithmetic is scene/geometry's job. Kept structurally
// separate from scene/geometry's own types on purpose: parser/index.ts is a
// browser-free entry point and must not reach into scene/*.
// --------------------------------------------------------------------------

// How far a constructed line extends. Mirrors scene/geometry's LineExtent;
// duplicated rather than imported so the parser stays standalone.
export type GeometryExtent = 'infinite' | 'ray' | 'segment'

// One operand of a construction: either a name bound earlier in the spec, or
// a line written inline as two point names ("A-B", "segment A-B", "ray A-B").
export type GeometryRef =
  | { kind: 'named'; name: string }
  | { kind: 'through'; extent: GeometryExtent; from: string; to: string }

export type TriangleCentreKind = 'centroid' | 'circumcenter' | 'incenter' | 'orthocenter' | 'incircle' | 'circumcircle'

// Which of the two arcs between two points of a circle is meant (G1).
// Mirrors scene/geometry/circles.ts's ArcDirection; duplicated rather than
// imported so the parser stays standalone, exactly as GeometryExtent is.
// There is deliberately no default: "the arc from P to Q" is two arcs, and a
// grammar that picks one silently is the failure this type exists to prevent.
export type GeometryArcDirection = 'minor' | 'major' | 'ccw' | 'cw'

// The right-hand side of a construction statement. Names throughout; no
// numbers except where the DSL genuinely carries one (a rotation angle, a
// dilation factor, a divide ratio), and those stay as Exprs so a named
// constant works there like anywhere else.
export type Construction =
  | { kind: 'parallelLine'; through: string; base: GeometryRef }
  | { kind: 'perpendicularLine'; through: string; base: GeometryRef }
  | { kind: 'perpendicularBisector'; from: string; to: string }
  | { kind: 'angleBisector'; from: string; vertex: string; to: string }
  | { kind: 'midpoint'; from: string; to: string }
  | { kind: 'foot'; from: string; base: GeometryRef }
  | { kind: 'intersect'; left: GeometryRef; right: GeometryRef }
  | { kind: 'divide'; from: string; to: string; ratioFrom: Expr; ratioTo: Expr }
  | { kind: 'reflect'; point: string; over: GeometryRef }
  | { kind: 'rotate'; point: string; about: string; angle: Expr }
  | { kind: 'translate'; point: string; dx: Expr; dy: Expr }
  | { kind: 'dilate'; point: string; from: string; factor: Expr }
  | { kind: 'triangleCentre'; centre: TriangleCentreKind; vertices: [string, string, string] }
  // "O = circle P, 5" — a circle by a *named* centre. The existing
  // "circle: (cx, cy), r" statement draws a circle but binds no geometry
  // name, so without this there is no way to write the spec's own
  // "intersect circle O, line B-C", and circle x circle intersection is
  // unreachable from the DSL entirely.
  | { kind: 'circleAt'; center: string; radius: Expr }
  // The circle vocabulary that produces a LINE — everything an author can go
  // on to intersect, measure or hang a label from. The shapes that are
  // regions rather than lines (arc, sector, circular segment) are drawn
  // statements instead, below: nothing intersects an arc, and keeping them
  // out of the namespace keeps every dispatch over a geometry object at the
  // three kinds phase 1 defined.
  | { kind: 'chord'; circle: string; from: string; to: string }
  | { kind: 'tangentAt'; circle: string; point: string }
  // Two solutions, ordered by the rule `intersect` uses (D3).
  | { kind: 'tangentFrom'; circle: string; point: string }
  | { kind: 'secant'; circle: string; from: string; to: string }
  | { kind: 'radiusTo'; circle: string; point: string }
  | { kind: 'diameter'; circle: string; from: string; to: string }

// --------------------------------------------------------------------------
// Measure labels (Geometry v2, phase 3)
// --------------------------------------------------------------------------

// What a measure label is attached to — the geometry it names, which is both
// what gets measured and what decides where the label is drawn.
export type MeasureSubject =
  | { kind: 'length'; from: string; to: string }
  | { kind: 'angle'; from: string; vertex: string; to: string }
  | { kind: 'triangle'; names: [string, string, string] }
  // An arc names the circle it lies on and the way round it goes, because
  // without both it names neither one arc nor one measure (G1).
  | { kind: 'arc'; circle: string; from: string; to: string; direction: GeometryArcDirection }

// The overmark a notation form carries. Mirrors figure/notation.ts's
// Overmark; duplicated rather than imported so the parser stays standalone,
// exactly as GeometryExtent is above. 'arc' arrived with the circle
// vocabulary, which is what writes a name under an arc mark.
export type MeasureOvermark = 'none' | 'segment' | 'ray' | 'line' | 'arc'

// What the label prints.
//
// `stated` is the load-bearing one: it prints the author's number AND checks
// it against the geometry, because a figure whose labels contradict its own
// drawing is a wrong figure. `symbol` prints text and checks nothing, which
// is what "AB = x" is for.
export type MeasureContent =
  | { kind: 'computed' }
  | { kind: 'stated'; value: number }
  | { kind: 'symbol'; text: string }
  | { kind: 'name'; mark: MeasureOvermark; prefix: string }

// One line of the givens box: a value, or a relation between two pieces of
// geometry. Relations carry the symbol itself rather than a keyword, because
// an author may type either and by this point the difference is spent.
export type GivensSection = 'given' | 'find'

export type GivenEntry =
  | { kind: 'measure'; subject: MeasureSubject; content: MeasureContent }
  | { kind: 'relation'; left: MeasureSubject; symbol: string; right: MeasureSubject }

// Which of the three canonical slots a triangle measurement fills. Side 'a'
// is opposite the first named vertex, angle 'a' is the angle at it.
export type TriangleSlot = 'a' | 'b' | 'c'

// One line of the input spec, after parsing.
//
// Grammar (documented here as the source of truth for the parser):
//   y = <expr(x)> [if <condition>]              -> explicit function of x (2D); condition makes it piecewise
//   x = <expr(y)> [if <condition>]              -> explicit function of y (2D)
//   z = <expr(x,y)>                             -> explicit surface (3D)
//   r = <expr(theta)> [for theta in [a, b]]      -> polar curve (2D); theta defaults to [0, 2*pi]
//   <expr(x,y)> = <expr(x,y)>                   -> implicit curve (conics, circles, etc.; 2D)
//   <expr(x,y)> <|<=|>|>= <expr(x,y)>            -> shaded inequality region (2D)
//   <expr> <|<= <expr(x,y)> <|<= <expr>          -> chained inequality region (2D); the shaded region is
//     <expr> >|>= <expr(x,y)> >|>= <expr>           the intersection of both comparisons (e.g. a band or an
//                                                     annulus). Both operators must point the same way — "a <
//                                                     x < b" or "a > x > b" — mixing directions ("a < x > b")
//                                                     is rejected. Strictness can differ per side (e.g. "-2 <=
//                                                     x < 5"); each traced edge is dashed per its own operator.
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
//   label: A-B  |  label: AB                        -> prints the COMPUTED length of the segment.
//                                                     "label: AB = 8" prints 8 and FAILS if the
//                                                     computed length is not 8 (suppressed by
//                                                     "@scale: false"); "label: AB = x" prints "x"
//                                                     and asserts nothing. "label: angle A-B-C"
//                                                     (or "angle ABC") measures the angle at B,
//                                                     honouring "@angle". "label: segment AB" /
//                                                     "ray AB" / "line AB" / "triangle ABC" print
//                                                     the NAME in geometry notation (overbar,
//                                                     arrow, double arrow, the triangle sign)
//                                                     rather than a measure.
//   given: AB [= 8]  |  given: angle ABC [= 30]     -> a line of the boxed givens panel
//   find: BC                                        -> the same row, in the table's "Find"
//                                                     section rather than its "Given" one: a
//                                                     problem states givens and then asks for
//                                                     something.
//   given: AB parallel CD                             instead of a label on the drawing. The
//                                                     name is written in notation (an overbar on
//                                                     a segment, the angle and triangle signs),
//                                                     the value plain. A stated value is checked
//                                                     exactly as an inline label's is. The
//                                                     relation form takes a keyword or the symbol
//                                                     (congruent/cong/≅, similar/sim/~,
//                                                     parallel/par/∥, perpendicular/perp/⊥). The
//                                                     box's corner or side is "@givens:".
//   right-angle: A-B-C                              -> small square marker at vertex B indicating a
//                                                     90-degree angle between rays B->A and B->C.
//   segment: A-B [dashed]                           -> a segment between two named points, resolved
//                                                     the same way as angle:/tick:'s points. The
//                                                     sibling of those marks, and distinct from the
//                                                     coordinate form "(x1,y1) -- (x2,y2)", which
//                                                     cannot reference a constructed point at all.
//
// Geometry constructions (v2) — every one of these BINDS its left-hand name
// into the geometry namespace and DRAWS its result. Names are letters only
// (A, P, m, AB), the same rule point labels already follow, which keeps them
// distinct from the general-identifier rule a named constant ("a = 5") uses.
// A name that is already bound is an error, not a silent rebinding.
//
// Unlike function/constant definitions, constructions are DEFINITION-BEFORE-USE:
// a construction may only reference names defined on an earlier line. They
// form a dependency chain, and reading them in source order means a cycle is
// unrepresentable rather than something to detect. Plain "A = (x, y)" points
// and polygon vertices remain order-independent, as they already were.
//
//   <L> = line through P parallel to <line>       -> the line through P parallel to another line
//   <L> = line through P perpendicular to <line>  -> ...and perpendicular to it
//   <L> = perpendicular bisector of A-B           -> the perpendicular bisector of a segment
//   <L> = bisector of angle A-B-C                 -> a RAY from B bisecting the angle there
//   <P> = midpoint A-B                            -> the midpoint of a segment
//   <P> = foot C to <line>                        -> the foot of the perpendicular from C
//   <P> = intersect <obj>, <obj>                  -> one intersection point
//   <P>, <Q> = intersect <obj>, <obj>             -> both, ordered by x then y (D3)
//   <P> = divide A-B at 2:3                       -> the point 2/5 of the way from A to B
//   <P> = reflect C over <line>                   -> C mirrored across a line
//   <P> = rotate C about O by 90                  -> rotated counter-clockwise (unit per "@angle")
//   <P> = translate C by (3, -4)                  -> shifted by a vector
//   <P> = dilate C from O by 1.5                  -> scaled about a centre
//   <O> = circle P, 5                             -> a circle by named centre and radius
//   <c> = chord P-Q on O                          -> the chord between two points of a circle
//   <t> = tangent at P on O                       -> the tangent line at a point OF the circle
//   <t>, <u> = tangent from P to O                -> the two tangents from an EXTERNAL point,
//                                                    drawn to their touch points and ordered
//                                                    by the same rule intersect uses (D3)
//   <k> = secant P-Q on O                         -> the line through P and Q, which must cut
//                                                    the circle twice
//   <r> = radius O to P                           -> the radius drawn to a point of the circle
//   <d> = diameter P-Q on O                       -> a chord through the centre; refused if the
//                                                    two points are not opposite each other
//   arc P-Q on O minor|major|ccw|cw               -> a drawn arc. The direction is REQUIRED:
//   sector P-Q on O <direction>                      "the arc from P to Q" is two arcs, and
//   segment P-Q on O <direction>                     drawing one silently is worse than
//                                                    refusing. sector/segment are fills.
//   central angle P-Q on O <direction>            -> the mark at the centre, printing the arc
//                                                    measure it shares with "label: arc PQ"
//   inscribed angle P-Q-R on O                    -> the mark at the circumference, vertex in
//                                                    the middle
//   Every one of these also works WITHOUT a name to bind, drawn on its own
//   line ("chord P-Q on O"), the way "incircle of ABC" already does.
//   <P> = centroid ABC                            -> also circumcenter/incenter/orthocenter
//   <O> = incircle of ABC                         -> also circumcircle; "of" is optional throughout
//   incircle of ABC                               -> the same, drawn without binding a name
//   triangle ABC: AB = 8, angle A = 90, AC = 6    -> a triangle solved from three measurements
//                                                    (SSS/SAS/ASA/AAS/RHS; SSA is refused as
//                                                    ambiguous) and placed by the fixed convention:
//                                                    A at the origin, B on the positive x-axis, C in
//                                                    the upper half-plane. Its three vertices become
//                                                    named points like a polygon's do.
//
// A <line> operand is "A-B" (the infinite line through two named points),
// "line A-B" / "segment A-B" / "ray A-B" to pick the extent explicitly, or
// the name of a line bound earlier. An <obj> operand is any of those, a
// "circle <name>", or a bare name of any kind.
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
  | { kind: 'regionChain'; low: Expr; lowOp: '<' | '<='; mid: Expr; highOp: '<' | '<='; high: Expr }
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
  // "label: AB", "label: AB = 8", "label: angle ABC", "label: segment AB" —
  // a value read off the figure, or a name written in geometry notation.
  | { kind: 'measureLabel'; subject: MeasureSubject; content: MeasureContent }
  // "given: AB = 8", "given: AB parallel CD" — a line of the boxed panel
  // rather than a label on the drawing. Inline and boxed labelling coexist,
  // and an author chooses per label by choosing the statement.
  // The section of the givens table a row belongs to. A problem states what
  // it is given and then asks for something, and those are different rows of
  // the same table rather than two boxes.
  | { kind: 'given'; entry: GivenEntry; section: GivensSection }
  // "arc P-Q on O minor", "sector P-Q on O ccw", "segment P-Q on O major" —
  // a drawn piece of a circle. A sector and a circular segment are fills and
  // go in the regions layer; a bare arc is a stroked path. The direction is
  // required, never defaulted (G1).
  | { kind: 'circleShape'; shape: 'arc' | 'sector' | 'segment'; circle: string; from: string; to: string; direction: GeometryArcDirection }
  // "central angle P-Q on O minor" — the mark at the centre, which prints the
  // arc's own measure, so the two cannot disagree (G2). It carries a
  // direction for the same reason the arc does: the central angle of a major
  // arc is reflex, and a mark that could not express that would label a
  // 216-degree arc as 144.
  | { kind: 'centralAngle'; circle: string; from: string; to: string; direction: GeometryArcDirection }
  // "inscribed angle P-Q-R on O" — the angle at the circumference, vertex in
  // the middle. Never reflex, so it needs no direction.
  | { kind: 'inscribedAngle'; circle: string; from: string; vertex: string; to: string }
  | { kind: 'tick'; from: string; to: string; count: number }
  | { kind: 'rightAngle'; from: string; vertex: string; to: string }
  // "segment: A-B [dashed]" — a segment between two *named* points, the
  // sibling of tick:/angle:/right-angle:. Distinct from the coordinate form
  // ("(x1,y1) -- (x2,y2)"), which cannot reference a constructed point.
  | { kind: 'namedSegment'; from: string; to: string; dashed: boolean }
  // A named geometry construction: "M = midpoint A-B", "m = line through P
  // parallel to A-B", "P, Q = intersect circle O, line B-C". `names` is the
  // left-hand side — two names only for `intersect`, which can yield two
  // points, and empty for the nameless "incircle of ABC" form. Binding a
  // count of names that doesn't match what the construction produced is an
  // error (D4), because silently dropping a solution is how a figure becomes
  // subtly wrong.
  | { kind: 'construction'; names: string[]; body: Construction }
  // "triangle ABC: AB = 8, angle A = 90, AC = 6" — solved in closed form and
  // placed by the D5 convention. Measurements arrive already mapped onto the
  // canonical a/b/c slots, since the parser knows the vertex names and can
  // therefore reject "side DE" of triangle ABC at parse time.
  | {
      kind: 'triangle'
      names: [string, string, string]
      sides: Partial<Record<TriangleSlot, Expr>>
      angles: Partial<Record<TriangleSlot, Expr>>
    }

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
