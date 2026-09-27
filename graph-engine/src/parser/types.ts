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
  // "plane A-B-C", or any other plane form (phase 8, Q2) — a plane, which
  // exists only among points in space (a solid figure). As an operand it
  // appears inside "foot D to plane A-B-C" and "intersect line A-G, plane
  // B-D-E"; a plane is never drawn on its own (a cut draws it through the
  // solid it cuts).
  | { kind: 'plane'; plane: PlaneForm }

// A plane as the author wrote it (phase 8, Q2), in the AUTHOR's frame, z up.
// `source` is the text after "plane", as written, so a message can quote it.
//
//   plane A-B-C                          -> points: through three points
//   plane through P perpendicular to A-B -> perpendicular: normal along A-B
//   plane through P parallel to A-B-C    -> parallel: to another plane form
//   plane through P parallel to p        ...or to a named plane
//   plane 2x + y - z = 3                 -> equation: linear in x, y, z
//   plane z = 1                          -> axis: the phase-5 form, unchanged
//   plane p                              -> named: a plane bound by "p = plane ..."
export type PlaneForm = (
  | { kind: 'points'; points: [string, string, string] }
  | { kind: 'perpendicular'; through: string; line: [string, string] }
  | { kind: 'parallel'; through: string; to: PlaneForm }
  | { kind: 'equation'; left: Expr; right: Expr }
  | { kind: 'axis'; axis: 'x' | 'y' | 'z'; at: Expr }
  | { kind: 'named'; name: string }
) & { source: string }

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
  // Three vertices, or four for a centroid — the centroid of a tetrahedron,
  // which exists only among points in space.
  | { kind: 'triangleCentre'; centre: TriangleCentreKind; vertices: [string, string, string] | [string, string, string, string] }
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
  // "M = center of S" (phase 9, R1) — the centre of a SPHERE solid, as a
  // point in space. It exists only in a solid figure: the solid-figure walk
  // owns it, and the 2D pass refuses it (a circle's centre is the point it
  // was drawn around, already named).
  | { kind: 'centerOf'; solid: string }
  // "P, Q = common perpendicular of A-B and C-D" (phase 10, M6) — the feet of
  // the common perpendicular of two lines in space: P on line AB, Q on line
  // CD, PQ square to both. Closed form; parallel lines (not unique) and
  // lines that meet (zero length) are refused. Only a solid figure has it.
  | { kind: 'commonPerpendicular'; first: [string, string]; second: [string, string] }

// --------------------------------------------------------------------------
// Solids (Geometry v2, phase 5)
// --------------------------------------------------------------------------

// A solid primitive as the author wrote it. Dimensions stay as Exprs so a
// named constant works here exactly as it does in a rotation angle or a
// dilation factor.
//
// Where the solid SITS is not in this type and never can be: a constraint
// fixes a shape, not a placement. The convention is stated once, in
// figure/solids.ts (H1).
export type SolidPrimitive =
  | { kind: 'prism'; width: Expr; height: Expr; depth: Expr }
  | { kind: 'pyramid'; base: Expr; height: Expr }
  | { kind: 'tetrahedron'; edge: Expr }
  | { kind: 'cylinder'; radius: Expr; height: Expr }
  | { kind: 'cone'; radius: Expr; height: Expr }
  | { kind: 'sphere'; radius: Expr }
  // A conical frustum (P2): base radius, top radius, height.
  | { kind: 'frustum'; radius: Expr; top: Expr; height: Expr }
  // The convex hull of named points in space, "hull A-B-C-D-E" (P3). The
  // points place it; every one must be a corner.
  | { kind: 'hull'; points: string[] }
  // Solids placed by named points (P6) — the points exist already, and they
  // fix the solid's position and orientation as a solved triangle's
  // vertices do. "tetrahedron A-B-C-D", "pyramid A-B-C-D apex E",
  // "prism A-B-C height 5" (extruded along (B - A) x (C - A)).
  | { kind: 'tetrahedronOn'; points: string[] }
  | { kind: 'pyramidOn'; base: string[]; apex: string }
  | { kind: 'prismOn'; base: string[]; height: Expr }
  // "sphere center M radius 5", "cylinder from A to B radius 3",
  // "cone apex V base O radius 3", "frustum from O radius 6 to P radius 3".
  | { kind: 'sphereOn'; center: string; radius: Expr }
  | { kind: 'cylinderOn'; from: string; to: string; radius: Expr }
  | { kind: 'coneOn'; apex: string; base: string; radius: Expr }
  | { kind: 'frustumOn'; from: string; fromRadius: Expr; to: string; toRadius: Expr }
  // By dimensions, placed by H1 and P5: "cube edge 4", "prism regular 6
  // side 12, height 5", "pyramid regular 5 side 4, height 6", "pyramid
  // rectangle 6 by 4, height 9" (width along Y by depth along X, like the
  // box), "octahedron edge 6", "frustum regular 4 side 6, top 3, height 4".
  | { kind: 'cube'; edge: Expr }
  | { kind: 'regularPrism'; sides: Expr; side: Expr; height: Expr }
  | { kind: 'regularPyramid'; sides: Expr; side: Expr; height: Expr }
  | { kind: 'rectanglePyramid'; width: Expr; depth: Expr; height: Expr }
  | { kind: 'octahedron'; edge: Expr }
  | { kind: 'regularFrustum'; sides: Expr; side: Expr; top: Expr; height: Expr }
  // "tetrahedron ABCD with AB = ..., AC = ..., ..." (P4): four new vertex
  // names and all six edges, each unordered pair exactly once (checked by
  // the parser, which knows the names). `edges` is as written; the builder
  // reads it by pair, so order and letter order do not matter.
  | { kind: 'tetrahedronEdges'; vertices: [string, string, string, string]; edges: { from: string; to: string; length: Expr }[] }
  // Phase 9 (R5) — a sphere placed by its centre, its radius following from
  // a tangency: to a plane (any Q2 form), or externally or internally to
  // another sphere solid. "sphere center P tangent to plane A-B-C",
  // "sphere center P externally tangent to T".
  | { kind: 'sphereTangent'; center: string; to: SphereTangency }
  // Phase 9 (R3, R4) — the sphere through every vertex of a named solid (a
  // polyhedron's, verified against each one) or through a round solid's rims
  // and apex; and the sphere through four named points.
  | { kind: 'circumsphere'; of: string }
  // Phase 9 (R3, R4) — the sphere tangent to every face of a named solid (a
  // polyhedron's, verified against each), or to a round solid's ends and side.
  | { kind: 'insphere'; of: string }
  | { kind: 'circumsphereOn'; points: [string, string, string, string] }

// What a sphere placed by tangency touches (R5).
export type SphereTangency = { kind: 'plane'; plane: PlaneForm } | { kind: 'sphere'; sphere: string; side: 'external' | 'internal' }

// --------------------------------------------------------------------------
// Measure labels (Geometry v2, phase 3)
// --------------------------------------------------------------------------

// What a measure label is attached to — the geometry it names, which is both
// what gets measured and what decides where the label is drawn.
export type MeasureSubject =
  | { kind: 'length'; from: string; to: string }
  // A named dimension of a named solid — "S height", "S edge". Deliberately
  // NOT a length between two points: what is measured is the solid the author
  // asked for, not the projected edge that stands for it, and the two differ
  // by whatever the camera does. See figure/solids.ts's solidDimensions.
  | { kind: 'solidDimension'; solid: string; dimension: string }
  | { kind: 'angle'; from: string; vertex: string; to: string }
  | { kind: 'triangle'; names: [string, string, string] }
  // An arc names the circle it lies on and the way round it goes, because
  // without both it names neither one arc nor one measure (G1).
  | { kind: 'arc'; circle: string; from: string; to: string; direction: GeometryArcDirection }
  // Phase 10 (M3) — the dihedral angle along edge AB between the half-plane
  // ABC and the half-plane ABD, written "dihedral C-A-B-D": the edge is the
  // middle two names. In [0, 180] degrees.
  | { kind: 'dihedral'; from: string; edge: [string, string]; to: string }
  // Phase 10 (M5) — measures between lines and planes in space. Table rows
  // only ("given:" / "find:"): none has a single point an inline label could
  // hang on, so "label:" refuses them at parse time.
  //   angle between A-B and C-D          -> the acute angle between the lines' directions (skew allowed)
  //   angle between A-B and plane <form> -> the line–plane angle, in [0, 90] degrees
  //   distance between A-B and C-D       -> line to line (skew or parallel; 0 if they meet)
  //   distance from P to plane <form>
  //   distance from P to line A-B
  | { kind: 'lineAngle'; first: [string, string]; second: [string, string] }
  | { kind: 'linePlaneAngle'; line: [string, string]; plane: PlaneForm }
  | { kind: 'lineDistance'; first: [string, string]; second: [string, string] }
  | { kind: 'pointPlaneDistance'; point: string; plane: PlaneForm }
  | { kind: 'pointLineDistance'; point: string; line: [string, string] }

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
//   segment: A-B [dashed | plain]                   -> a segment between two named points, resolved
//                                                     the same way as angle:/tick:'s points. The
//                                                     sibling of those marks, and distinct from the
//                                                     coordinate form "(x1,y1) -- (x2,y2)", which
//                                                     cannot reference a constructed point at all.
//
// Solid figures (drawn by the SVG figure renderer through a fixed named view —
// not the orbitable *space* renderer). Everything an author writes about a
// solid is in ONE z-up frame: X toward the viewer and left, Y to the right,
// Z up (see figure/authorFrame.ts, which is the only place that knows the
// renderer is y-up inside). A primitive sits centred on the origin, its axis
// vertical, and:
//
//   width  runs along Y     depth  runs along X     height runs along Z
//
//   [S =] solid prism <w> by <h> by <d> [vertices ABCDEFGH]
//   [S =] solid pyramid square base <b>, height <h> [vertices ABCDE]
//   [S =] solid tetrahedron edge <e> [vertices ABCD]
//   [S =] solid cylinder radius <r>, height <h>
//   [S =] solid cone radius <r>, height <h>
//   [S =] solid sphere radius <r>
//   [S =] solid frustum radius <r>, top <t>, height <h>
//                                                 -> a conical frustum, base rim r, top rim t. top > r is
//                                                    the same solid turned over; top = r is refused (write
//                                                    a cylinder), top 0 is refused (write a cone)
//   [S =] solid cube edge <e>                     -> exactly "prism e by e by e", same bytes
//   [S =] solid prism regular <n> side <s>, height <h>
//   [S =] solid pyramid regular <n> side <s>, height <h>
//   [S =] solid pyramid rectangle <w> by <d>, height <h>
//                                                 -> width along Y by depth along X, like a prism
//   [S =] solid octahedron edge <e>
//   [S =] solid frustum regular <n> side <s>, top <t>, height <h>
//                                                 -> pyramidal; top = side refused (a prism), top 0 (a pyramid)
//     A regular base has 3 to 24 sides. It (and the octahedron's equator)
//     is turned about the vertical to the integer degree that keeps every
//     face farthest from edge-on under the DEFAULT view and no corner in
//     line with the view through the axis, judged at height = side so the
//     turn depends on n alone (figure/regular.ts records it), and lettered
//     like a box: A the left end of the front-most base edge, the base
//     counter-clockwise from above, a top over its base, an apex last; an
//     octahedron's equator, then its top, then its bottom apex.
//
//   Solids on named points (phase 7) — the points place the solid, so it
//   sits and turns wherever they are. Points are defined first:
//
//   [S =] solid hull A-B-C-D-...                  -> the convex hull of at most 24 points; every one must be a corner
//   [S =] solid tetrahedron A-B-C-D
//   [S =] solid pyramid A-B-C-D apex E            -> base polygon, then apex; the base must be flat and convex
//   [S =] solid prism A-B-C-D height <h> [vertices EFGH]
//                                                 -> a right prism rising along (B - A) x (C - A), so the
//                                                    base reads counter-clockwise from the top; reverse the
//                                                    base to extrude the other way. "vertices" names the new top
//   [S =] solid sphere center M radius <r>
//   [S =] solid cylinder from A to B radius <r>   -> A and B are the rim centres; any direction
//   [S =] solid cone apex V base O radius <r>
//   [S =] solid frustum from O radius <r> to P radius <r>
//   [S =] solid tetrahedron ABCD with AB = <e>, AC = <e>, AD = <e>, BC = <e>, BD = <e>, CD = <e>
//                                                 -> by its six edges, in any order and either letter order;
//                                                    placed like "tetrahedron edge e" (base ABC level, D
//                                                    above), and A-D become points in space. Refused, with
//                                                    the reason, when a face or the whole cannot close
//     A solid on named points takes no "vertices" (its points name them),
//     except a prism's new top, and has no named dimensions: measure between
//     its points ("label: AB") instead. The exception is a sphere's radius
//     (phase 9): every sphere has "label: S radius".
//
//   label: S width | height | depth | base | edge | radius | top | side [= <value>]
//                                                 -> a dimension read off the SOLID, never the drawing. A
//                                                    round solid's radius or height, and a pyramid's or
//                                                    pyramidal frustum's height, also draws the line it
//                                                    measures (rim centre to rim, or the axis), dashed
//                                                    where the solid hides it
//   cut: S by plane <plane>                       -> the section shaded in place, by ANY plane (phase 8;
//                                                    the forms are below). "plane z = 1" is horizontal.
//                                                    Its outline is drawn apart from the fill, DASHED
//                                                    where the solid hides it: a side on a face (or
//                                                    along an edge) is visible iff that face (either
//                                                    face) faces the viewer, a chord on a cap iff the
//                                                    cap does, an arc on a curved side is split where
//                                                    that side turns away (the exact angles). Other
//                                                    solids do not hide it (the glass rule).
//   section: S by plane <plane> [vertices PQRS]   -> the same cut lifted out beside the solid at true
//                                                    shape, as ordinary 2D geometry
//
//   Planes (phase 8). A plane is in the AUTHOR frame, z up, and every form
//   works wherever a plane is taken (cut:, section:, foot ... to plane,
//   intersect line ..., plane ...):
//
//   plane A-B-C                                   -> through three points in space (not collinear)
//   plane through P perpendicular to A-B          -> its normal along A-B (A and B distinct)
//   plane through P parallel to A-B-C             -> parallel to another plane, through P; also
//   plane through P parallel to p                    "parallel to plane <any form>"
//   plane 2x + y - z = 3                          -> an equation, which must be LINEAR in x, y, z
//                                                    by its STRUCTURE: x, y, z added, subtracted and
//                                                    scaled by constants, divided only by constants;
//                                                    powers and functions only of constants.
//                                                    "x^2 + y = 1", "abs(x) + y = 1" and
//                                                    "0x + 0y + 0z = 1" are refused
//   plane z = 1                                   -> the axis form, exactly as before
//   p = plane <any form>                          -> a NAMED plane: it binds p (unique across points,
//                                                    lines, circles and planes) and DRAWS NOTHING —
//   plane p                                          a plane is drawn only through the section it
//                                                    cuts; later lines write "plane p"
//
//   One plane, canonicalised: a plane square to an axis IS the axis form, so
//   "plane A-B-C" through three points at z = 1 cuts byte for byte as
//   "plane z = 1". Any other plane's own frame, which a lifted section is
//   drawn in, is fixed against the DEFAULT view (never the active one): its
//   normal faces the viewer, "up" (v) is author Z projected into the plane,
//   and "right" (u) completes a right-handed frame — so a lifted section
//   reads upright, seen from the viewer's side.
//
//   A lifted polygon's vertices (what "vertices PQRS" names) run counter-
//   clockwise in that frame, by angle about their centroid, from 9 o'clock:
//   P is the first vertex at or past straight left, going down (a vertex
//   exactly at 9 o'clock is P). A region's CORNERS (where an arc meets a
//   chord) run counter-clockwise from the left end of its lowest chord; a
//   whole ellipse, like a circle, has no vertices to name.
//
//   What a plane cuts:
//     polyhedron  -> the polygon through its edges; a plane holding a face
//                    gives that face; one touching only a vertex or an edge
//                    is refused ("meets S only at the vertex (1, 1, 1)")
//     sphere      -> a circle about the foot of the centre, radius
//                    sqrt(r^2 - d^2); a tangent plane is refused ("touches
//                    S at one point")
//     cylinder    -> square to the axis a circle; parallel to it a rectangle
//                    (two sides, two cap chords); otherwise an ellipse,
//                    trimmed by the caps: the whole ellipse, half-ellipse-
//                    like (one arc, one chord: the log wedge), or two arcs
//                    and two chords
//     cone,       -> square to the axis a circle; cutting every generator an
//     frustum        ellipse, trimmed by the base (and the top); through the
//                    apex (a frustum's virtual apex) and steeper than the
//                    generators the triangle (trapezoid) of two generators;
//                    parallel to a generator a PARABOLA and steeper a
//                    HYPERBOLA, both refused — only circles and ellipses are
//                    drawn; through the apex only, or along one generator,
//                    refused as such
//     any round solid placed by points, tilted or not, is cut in its own frame
//
//   Not drawn (refused where an author could ask): a plane on its own
//   ("plane: A-B-C"), the line where two planes meet, parabolic and
//   hyperbolic sections, and nets.
//
//   Spheres a figure constructs (phase 9). Each is an ORDINARY sphere solid,
//   placed exactly as "sphere center M radius r" places one: it draws,
//   hides segments and is cut like one, and it is glass to every other solid
//   (solids never hide each other). Closed form, never a solver; a sphere
//   that does not exist is refused, saying why, and never approximated.
//
//   [I =] solid insphere of T                     -> tangent to every face of T
//   [O =] solid circumsphere of T                 -> through every vertex of T
//   [O =] solid circumsphere A-B-C-D              -> through four named points, not in one plane
//                                                    (so nearly in one plane that the sphere cannot be
//                                                    fixed to within tolerance is refused too)
//   [S =] solid sphere center P tangent to plane <plane>
//                                                 -> radius = the distance from P to the plane (any
//                                                    plane form, named planes included)
//   [S =] solid sphere center P externally tangent to T
//                                                 -> T a sphere: radius |PT| - r_T (P outside T)
//   [S =] solid sphere center P internally tangent to T
//                                                 -> radius r_T - |PT| (P inside T, not its centre)
//   M = center of S  |  M = centre of S           -> a sphere's centre as a point in space (any
//                                                    sphere; only a sphere, in this phase)
//   label: S radius                               -> works for EVERY sphere, however it was placed
//
//   A polyhedron's circumsphere is the sphere through its first four
//   vertices (in vertex order) not in one plane, and EVERY vertex is then
//   checked against it; its insphere is fixed by its first four faces whose
//   planes determine a centre and radius, and EVERY face is then checked
//   (the centre strictly inside, at the radius from each). A polyhedron that
//   fails is refused, naming the first vertex the sphere misses or the first
//   face that fails: a box that is not a cube has no insphere, a pyramid on a
//   kite no circumsphere. Round solids, in their own frame (so placed and
//   tilted ones work), r the radius, h the height, a frustum's r1 its wider
//   rim and r2 its narrower:
//     cylinder  insphere only when h = 2r (radius r, at the middle);
//               circumsphere always, at the middle, sqrt(r^2 + (h/2)^2)
//     cone      insphere always, radius r h / (r + sqrt(r^2 + h^2)), that far
//               above the base; circumsphere always, through the apex and the
//               base rim, x = (h^2 - r^2) / (2h) above the base, radius h - x
//     frustum   insphere only when h = 2 sqrt(r1 r2) (radius h/2, at mid-
//               height); circumsphere always, y = (h^2 + r2^2 - r1^2) / (2h)
//               from the wider rim, radius sqrt(y^2 + r1^2)
//     sphere    refused: it is already a sphere
//   Refused: a tangent sphere whose centre is on the plane, on T, inside T
//   (externally) or outside T (internally), or at T's centre (internally);
//   "tangent to T" with no side; a sphere tangent to several objects at once
//   (a solver: place it by its computed centre); "center of" anything but a
//   sphere. Not drawn: contact circles on a cone or cylinder, inscribed
//   cubes and other inscribed polyhedra, tangency assertions in the givens
//   table, and opaque stacking.
//   @view: standard | isometric | front | top | side
//                                                 -> which fixed viewpoint draws the solid. standard
//                                                    (the default) is in general position; isometric
//                                                    puts two corners of a cube on one point
//
//   Points, constructions and measures in space (phase 6). A name is a point
//   in the PLANE or a point in SPACE, never both, and a construction may not
//   mix the two kinds:
//
//   A = (x, y, z)                                 -> a point in space, z up; drawn as a dot and a label
//   S = solid ... vertices ABCDEFGH               -> the named vertices ARE points in space (lettered,
//                                                    not dotted), in textbook order: a prism's base
//                                                    ABCD runs counter-clockwise seen from above from
//                                                    A, the front-left bottom corner, then its top
//                                                    EFGH, so A is under E, the front face is ABFE
//                                                    and D is the hidden corner. A square pyramid's
//                                                    base is ABCD the same way, apex E; a
//                                                    tetrahedron's base is ABC, apex D.
//   M = midpoint A-G                              -> the midpoint in space
//   P = divide A-G at 1:2                         -> one part from A to two parts to G
//   G = centroid ABC  |  G = centroid ABCD        -> of a triangle, or of a tetrahedron (four names)
//   O = circumcenter ABC                          -> also incenter / orthocenter, of a triangle in space
//   F = foot D to plane A-B-C                     -> the foot of the perpendicular to a plane
//   F = foot D to line A-B                        -> ...or to a line (infinite)
//   X = intersect line A-G, plane B-D-E           -> where a line meets a plane
//   segment: A-G                                  -> drawn dashed where a solid hides it and split
//                                                    where that changes: the GLASS rule. Solids never
//                                                    hide each other; every solid hides a segment.
//   segment: A-G dashed  |  segment: A-G plain    -> force either style against the rule
//   (x1, y1, z1) -- (x2, y2, z2)                  -> the coordinate form of a segment in space
//   label: AG                                     -> the TRUE length in space, never the drawn one
//   given: AG = 10  |  given: angle ABC           -> true lengths and angles in the givens table
//
//   A plane is an operand, and a named plane binds without drawing. A
//   planar construction (rotate, reflect, a tangent, a circle...) refuses a
//   point in space, and so do angle marks, ticks, polygons and inline angle
//   labels ("label: angle ABC") in space — the givens table takes the angle.
//
//   Which renderer: a spec with a solid or a cut/section is a solid figure,
//   even with 3-coordinate points in it. A spec of 3-coordinate points and
//   no solid is a *space* plot, as it always was — so declare "@mode: figure"
//   for points in space with no solid, and declare the mode anyway.
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
  // "segment: A-B [dashed | plain]" — a segment between two *named* points,
  // the sibling of tick:/angle:/right-angle:. Distinct from the coordinate
  // form ("(x1,y1) -- (x2,y2)"), which cannot reference a constructed point.
  //
  // `style` is 'auto' unless the author forced one. In the plane 'auto' is
  // plain; between points in space it is the glass rule (S6): dashed where
  // a solid hides it, split where that changes. 'dashed' and 'plain' override
  // the rule either way.
  | { kind: 'namedSegment'; from: string; to: string; style: 'auto' | 'dashed' | 'plain' }
  // A named geometry construction: "M = midpoint A-B", "m = line through P
  // parallel to A-B", "P, Q = intersect circle O, line B-C". `names` is the
  // left-hand side — two names only for `intersect`, which can yield two
  // points, and empty for the nameless "incircle of ABC" form. Binding a
  // count of names that doesn't match what the construction produced is an
  // error (D4), because silently dropping a solution is how a figure becomes
  // subtly wrong.
  | { kind: 'construction'; names: string[]; body: Construction }
  // "solid: prism 8 by 5 by 6", "S = solid tetrahedron edge 5 vertices ABCD".
  // A solid is 3D geometry projected onto the figure, so it is figure content
  // like a polygon is — not a 3D scene (see scene/mode.ts). `name` binds it so
  // a later "label:", "cut:" or "section:" can refer to it; `vertices` names
  // the projected vertices in the solid's own labelling order, and is empty
  // when the author named none.
  | { kind: 'solid'; name: string | null; primitive: SolidPrimitive; vertices: string[] }
  // "cut: S by plane z = 3" and "section: S by plane z = 3 vertices PQRS".
  //
  // Two forms of one cut, and the difference is what a reader is being shown.
  // `cut` shades it ON the solid, in projection, where lengths are
  // foreshortened. `section` lifts it out as a TRUE-SHAPE plane figure, which
  // is ordinary 2D geometry and carries measures and labels through the
  // normal path (H5) — which is why only that form can name its vertices.
  //
  // `plane` is the AUTHOR's plane, z up, in any Q2 form (phase 8). The figure
  // renderer converts it to its internal frame (figure/authorFrame.ts,
  // figure/plane.ts); the parser never does.
  | { kind: 'crossSection'; solid: string; lift: boolean; plane: PlaneForm; vertices: string[] }
  // "p = plane A-B-C" (phase 8, Q2) — a NAMED plane. It binds the name, in the
  // one namespace points, lines and circles share, and draws nothing: a plane
  // is drawn only through the section it cuts. Later lines use it as
  // "plane p".
  | { kind: 'planeDef'; name: string; plane: PlaneForm }
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
