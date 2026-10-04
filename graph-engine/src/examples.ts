// The review harness's example specs, in their own module so a test can import
// them directly. Every one of these is a button in the harness, and a button
// that does not parse is a defect a user sees immediately — see
// examples.test.ts, which renders all of them.

import { SPACE_EXAMPLES } from './space/examples'

// The harness shows one group at a time (plus a search across all of them),
// because a single wall of seventy-odd buttons stopped being navigable. The
// order here is the order the group tabs appear in. Every example must name
// one — examples.test.ts checks it — so a new example cannot quietly land in
// no group at all.
export const EXAMPLE_GROUPS = [
  'Graphing',
  'Tables',
  'Space',
  'Plane geometry',
  'Shaded regions',
  'Solids',
  'Points & constructions',
  'Sections',
  'Spheres',
  'Measures in space',
  'Nets and paths',
  'Styles',
  'Calculus',
] as const

export type ExampleGroup = (typeof EXAMPLE_GROUPS)[number]

export interface Example {
  label: string
  group: ExampleGroup
  spec: string
}

export const EXAMPLES: Example[] = [
  {
    label: '2D',
    group: 'Graphing',
    spec: `y = x^2 - 2x - 1
x^2/9 + y^2/4 = 1        # ellipse
x^2 + y^2 = 25            # circle
A = (2, 3)
(0,0) -- (4,4)
(1,1) -> (3,5)
(cos(t)*3, sin(t)*2) for t in [0, 6.283]`,
  },
  {
    label: '3D',
    group: 'Space',
    spec: `z = sin(x) * cos(y)
(3*cos(u)*sin(v), 3*sin(u)*sin(v), 3*cos(v)) for u in [0, 6.283], v in [0, 3.1416]   # sphere
A = (2, 2, 3)
(0,0,0) -- (3,3,0)
(0,0,0) -> (0,0,4)
(cos(t)*2, sin(t)*2, t*0.3) for t in [0, 18.85]   # helix`,
  },
  {
    label: 'Inequality',
    group: 'Graphing',
    spec: `@hover: none
y > x^2 - 4
x^2 + y^2 <= 16`,
  },
  {
    label: 'Vector',
    group: 'Graphing',
    spec: `vector: (0,0) -> (3,4)
vector: (0,0) -> (-2,3) color: purple`,
  },
  {
    label: 'Tangent',
    group: 'Graphing',
    spec: `y = x^3 - 3x
tangent: x^3 - 3x at x = 1
tangent: x^3 - 3x at x = -1 color: purple`,
  },
  {
    label: 'Animate',
    group: 'Graphing',
    spec: `k(t) = cos(t) * 2
animate: (k(t), sin(t)*2) for t in [0, 6.283]   # references k(t), a named function`,
  },
  {
    label: 'Piecewise',
    group: 'Graphing',
    spec: `@points: vertices
y = -x - 1 if x < 0
y = x^2 - 1 if x >= 0`,
  },
  {
    label: 'Polar',
    group: 'Graphing',
    spec: `r = 2 + 2*sin(3*theta)`,
  },
  {
    label: 'Slope field',
    group: 'Graphing',
    spec: `field: dy/dx = x - y
y = x - 1   # one solution curve through the field`,
  },
  {
    label: 'Scatter',
    group: 'Graphing',
    spec: `scatter: (1,2.1), (2,3.9), (3,6.2), (4,7.8), (5,10.1), (6,11.9)`,
  },
  {
    label: 'Table (data)',
    group: 'Tables',
    spec: `@mode: table
header: Score range | Frequency
row: 90-100 | 4
row: 80-89 | 9
row: 70-79 | 13
row: 60-69 | 5`,
  },
  {
    label: 'Table (function)',
    group: 'Tables',
    spec: `@mode: table
table: y = x^2 - 1 for x in [0, 6] step 1`,
  },
  {
    label: 'Table (formula)',
    group: 'Tables',
    spec: `@mode: table
@formulas: on
table: y = x^2 - 1 for x in [0, 6] step 1`,
  },
  {
    label: 'Table (multiple)',
    group: 'Tables',
    spec: `@mode: table
scores.header: Trial | Score
scores.row: 1 | 82
scores.row: 2 | 91
scores.row: 3 | 76
times.table: y = 2x + 1 for x in [0, 4] step 1`,
  },
  {
    label: 'Hide/show',
    group: 'Graphing',
    spec: `@hide: helper
y = x^2 name: main
y = x + 3 color: teal name: helper`,
  },
  {
    label: 'Feature points',
    group: 'Graphing',
    spec: `@points: roots, extrema, inflections
@point-labels: coords
y = x^3 - 3x`,
  },
  {
    label: 'Intersections',
    group: 'Graphing',
    spec: `@points: intersections
y = x^2
y = x + 2`,
  },
  {
    label: 'No numbers',
    group: 'Graphing',
    spec: `@labels: none
y = x^2 - 4`,
  },
  {
    label: 'Steps of 8',
    group: 'Graphing',
    spec: `@xstep: 8
@ystep: 8
@step-mode: geometric
y = x^2   # zoom out: 8 -> 64 -> 512, never 10`,
  },
  {
    label: 'Circle',
    group: 'Plane geometry',
    spec: `circle: (0, 0), 3
O = (0, 0)`,
  },
  {
    label: 'Triangle',
    group: 'Plane geometry',
    spec: `polygon: A(0,0), B(4,0), C(2,3)
tick: A-C
tick: B-C
angle: A-B-C label: x°`,
  },
  {
    label: 'Solved triangle',
    group: 'Plane geometry',
    spec: `@mode: figure
@angle: degrees
triangle ABC: angle A = 90, AB = 6, AC = 8   # solved, not hand-placed
D = foot A to B-C                              # the altitude's foot
segment: A-D dashed
right-angle: B-A-C
label: AB
label: AC
label: BC`,
  },
  {
    label: 'Measured + notation',
    group: 'Plane geometry',
    spec: `@mode: figure
@angle: degrees
triangle ABC: AB = 7, BC = 8, AC = 9
label: AB = 7        # asserted — errors if the figure disagrees
label: BC = 8
label: AC = 9
label: angle ABC`,
  },
  {
    label: 'Centres + circles',
    group: 'Plane geometry',
    spec: `@mode: figure
@angle: degrees
triangle ABC: AB = 9, BC = 8, AC = 7
G = centroid ABC
O = circumcenter ABC
H = orthocenter ABC
I = incenter ABC
incircle of ABC
circumcircle of ABC
segment: O-H dashed   # the Euler line`,
  },
  {
    label: 'Constructions',
    group: 'Plane geometry',
    spec: `@mode: figure
A = (0, 0)
B = (8, 0)
C = (3, 6)
M = midpoint A-B
p = perpendicular bisector of A-B
m = line through C parallel to A-B
n = line through C perpendicular to A-B
X = intersect p, m
segment: A-B
segment: B-C
segment: A-C`,
  },
  {
    label: 'Two circles',
    group: 'Plane geometry',
    spec: `@mode: figure
A = (0, 0)
B = (7, 0)
j = circle A, 5
k = circle B, 5
P, Q = intersect j, k     # ordered, so P and Q are reproducible
segment: P-Q dashed       # the radical axis
segment: A-B`,
  },
  {
    label: 'Figure + table',
    group: 'Tables',
    spec: `@mode: figure
@angle: degrees
triangle ABC: angle A = 90, AB = 3, AC = 4
label: BC
header: side | length
row: AB | 3
row: AC | 4
row: BC | 5`,
  },
  {
    label: 'Circle vocabulary',
    group: 'Plane geometry',
    spec: `@mode: figure
O = (0, 0)
k = circle O, 5
P = (-3, 4)
Q = (4, 3)
chord P-Q on k
sector P-Q on k minor      # the wedge, filled
t = tangent at P on k      # touches at P
radius k to Q`,
  },
  {
    label: 'Tangents from a point',
    group: 'Plane geometry',
    spec: `@mode: figure
O = (0, 0)
k = circle O, 3
E = (8, 0)
T = (3, 0)
u, v = tangent from E to k   # two of them, deterministically ordered
radius k to T
segment: O-E dashed`,
  },
  {
    label: 'Arc measure',
    group: 'Plane geometry',
    spec: `@mode: figure
@angle: degrees
O = (0, 0)
k = circle O, 5
A = (5, 0)
B = (0, 5)
arc A-B on k minor
central angle A-B on k minor
label: arc A-B on k minor   # the measure, computed
radius k to A
radius k to B`,
  },
  {
    label: 'Secant and chord',
    group: 'Plane geometry',
    spec: `@mode: figure
O = (0, 0)
k = circle O, 5
P = (-4, 3)
Q = (4, 3)
R = (-3, -4)
secant through P-Q on k   # cuts the circle twice
chord Q-R on k            # a chord between two points on it
segment R-P on k minor    # the region between a chord and its arc`,
  },
  {
    label: 'Givens table',
    group: 'Plane geometry',
    spec: `@mode: figure
@angle: degrees
@givens: right
triangle ABC: angle A = 90, AB = 6, AC = 8
D = foot A to B-C
segment: A-D dashed
right-angle: B-A-C
given: AB = 6
given: AC = 8
given: angle BAC = 90
given: AD perpendicular BC
find: BC
find: AD`,
  },
  {
    label: 'Solid (prism)',
    group: 'Solids',
    spec: `@mode: figure
S = solid prism 8 by 5 by 6
label: S width = 8
label: S height = 5
label: S depth = 6`,
  },
  {
    label: 'Tetrahedron',
    group: 'Solids',
    spec: `@mode: figure
T = solid tetrahedron edge 5 vertices ABCD
label: T edge = 5`,
  },
  {
    label: 'Cylinder',
    group: 'Solids',
    spec: `@mode: figure
C = solid cylinder radius 3, height 8
label: C radius = 3
label: C height = 8`,
  },
  {
    label: 'Cross-section (cut)',
    group: 'Sections',
    spec: `@mode: figure
S = solid prism 8 by 5 by 6
cut: S by plane z = 1      # shaded where it lies`,
  },
  {
    label: 'Cross-section (lifted)',
    group: 'Sections',
    spec: `@mode: figure
S = solid prism 8 by 5 by 6
section: S by plane z = 1 vertices PQRS   # lifted out as a true-shape figure
label: PQ = 8      # measured in the section's own plane, not the projection
label: QR = 6`,
  },
  {
    // Phase 6: points in space, z up. X runs toward the viewer and left, Y
    // right, Z up. Lettered the textbook way (phase 6b): ABCD counter-
    // clockwise from above from the front-left bottom corner A, EFGH above
    // them. The camera looks from the (+,+,+) side, so D at the origin is the
    // hidden corner and its three edges are dashed by hand — this cube is
    // points, not a solid, so nothing occludes it.
    label: 'Cube by points',
    group: 'Points & constructions',
    spec: `@mode: figure
A = (4, 0, 0)
B = (4, 4, 0)
C = (0, 4, 0)
D = (0, 0, 0)
E = (4, 0, 4)
F = (4, 4, 4)
G = (0, 4, 4)
H = (0, 0, 4)
segment: D-A dashed
segment: D-C dashed
segment: D-H dashed
segment: A-B
segment: B-C
segment: A-E
segment: B-F
segment: C-G
segment: E-F
segment: F-G
segment: G-H
segment: H-E
P = midpoint D-H
Q = midpoint A-B
R = midpoint B-C
segment: P-Q
segment: Q-R
segment: R-P
label: PQ          # the true length, sqrt(24)`,
  },
  {
    label: 'Box diagonal',
    group: 'Points & constructions',
    spec: `@mode: figure
@givens: right
S = solid prism 8 by 5 by 6 vertices ABCDEFGH
segment: A-G       # dashed where the box hides it
label: AG          # the TRUE length, sqrt(125), not the drawn one
given: AB = 8`,
  },
  {
    label: 'Foot of a perpendicular',
    group: 'Points & constructions',
    spec: `@mode: figure
T = solid tetrahedron edge 6 vertices ABCD
F = foot D to plane A-B-C
segment: D-F       # inside the solid, so dashed
label: DF          # the height, 6 sqrt(2/3)`,
  },
  {
    // The regular tetrahedron under the standard view (phase 6b): exact
    // isometric flattened it until this altitude lay under the edge D-A.
    label: 'Regular tetrahedron and its height',
    group: 'Points & constructions',
    spec: `@mode: figure
T = solid tetrahedron edge 6 vertices ABCD
F = foot D to plane A-B-C
segment: D-F       # the altitude, inside the solid, so dashed
label: DF          # 6 sqrt(2/3) = 4.899
label: T edge = 6`,
  },
  {
    label: 'Sphere with a chord',
    group: 'Points & constructions',
    spec: `@mode: figure
S = solid sphere radius 4
N = (0, 0, 4)
W = (0, -4, 0)
segment: N-W       # a chord: inside the sphere, so hidden throughout
P = (-7, 3, -2)
Q = (3, -7, -2)
segment: P-Q       # behind the sphere: visible, hidden, visible`,
  },
  {
    // The classic: the plane through the three neighbours of A cuts the
    // space diagonal a third of the way along. Also a triangle centre in
    // space, and the centroid of four points (the tetrahedron ACFH inside
    // the box), which is the box's centre, on the diagonal.
    label: 'Diagonal meets a plane',
    group: 'Points & constructions',
    spec: `@mode: figure
S = solid prism 8 by 5 by 6 vertices ABCDEFGH
segment: B-D
segment: D-E
segment: E-B
X = intersect line A-G, plane B-D-E
O = circumcenter BDE
K = centroid ACFH
segment: A-G       # dashed where the box hides it, which is all of it
label: AX          # a third of AG`,
  },
  {
    // Glass: the cone runs through the cylinder and neither hides the other,
    // but both hide a line drawn behind them. The two lines sit square to the
    // standard view (azimuth 30), so each is split visible, hidden, visible;
    // phase 6b turned them 15 degrees with the default camera.
    label: 'Cylinder and cone',
    group: 'Points & constructions',
    spec: `@mode: figure
C = solid cylinder radius 3, height 4
K = solid cone radius 2, height 16
(-3, -6.9, -4.2) -- (-7.4, 0.9, -4.2)     # behind the cylinder
P = (-3.7, -5.6, 1.8)
Q = (-6.7, -0.4, 1.8)
segment: P-Q       # behind the cone, near its apex
M = (0, 0, -2)
N = (0, 0, 2)
segment: M-N plain # the axis, forced solid though the cylinder hides it`,
  },
  {
    // AIME 2024 I, problem 14: the tetrahedron given only by its six edges
    // (P4), placed like the regular one — base ABC horizontal, D above it.
    // D's height over ABC is 3V / area(ABC) = 80 / (3 sqrt 21) = 5.819.
    label: 'AIME tetrahedron',
    group: 'Solids',
    spec: `@mode: figure
T = solid tetrahedron ABCD with AB = sqrt(41), CD = sqrt(41), AC = sqrt(80), BD = sqrt(80), AD = sqrt(89), BC = sqrt(89)
F = foot D to plane A-B-C
segment: D-F       # the altitude, inside the solid, so dashed
label: DF
given: AB = √41    # symbolic: printed as written (exact values are build step 3)
given: AC = √80
given: AD = √89`,
  },
  {
    // A regular hexagonal prism lettered by P5: A the left end of the front
    // edge, ABCDEF counter-clockwise from above, G-L over them. The triangle
    // through A's three neighbours B, F and G is the AIME dihedral-angle
    // setup; "AIME: dihedral in a hexagonal prism" marks its angle.
    label: 'Hexagonal prism',
    group: 'Solids',
    spec: `@mode: figure
S = solid prism regular 6 side 12, height 8 vertices ABCDEFGHIJKL
segment: B-F
segment: F-G
segment: G-B
label: S side
label: S height`,
  },
  {
    // Two cones of radius 3 and height 8, placed by points (P6), their axes
    // crossing at right angles at O, 3 from each base — and the sphere at O
    // tangent to both, radius 15 / sqrt(73): the distance from O to the
    // generator from (5, 0, 0) through (-3, 3, 0). Glass: each cone draws
    // its own back dashed and neither hides the other.
    label: 'Two cones and a sphere',
    group: 'Points & constructions',
    spec: `@mode: figure
O = (0, 0, 0)
P = (-3, 0, 0)
V = (5, 0, 0)
K = solid cone apex V base P radius 3
Q = (0, -3, 0)
W = (0, 5, 0)
L = solid cone apex W base Q radius 3
S = solid sphere center O radius 15/sqrt(73)`,
  },
  {
    // A conical frustum (P2): radius 6 at the base, 3 at the top, height 4,
    // with its axis and its three named dimensions.
    label: 'Frustum',
    group: 'Solids',
    spec: `@mode: figure
F = solid frustum radius 6, top 3, height 4
label: F radius = 6
label: F top = 3
label: F height = 4`,
  },
  {
    // A polyhedron given only as the hull of named points (P3): a cube of
    // edge 2 with its corner at (2, 2, 2) sliced off through the midpoints
    // of the three edges there. Every named point is a corner; the slice is
    // one triangular face, and each cut face is one pentagon.
    label: 'Hull of points',
    group: 'Points & constructions',
    spec: `@mode: figure
A = (0, 0, 0)
B = (2, 0, 0)
C = (2, 2, 0)
D = (0, 2, 0)
E = (0, 0, 2)
F = (2, 0, 2)
H = (0, 2, 2)
P = (1, 2, 2)
Q = (2, 1, 2)
R = (2, 2, 1)
S = solid hull A-B-C-D-E-F-H-P-Q-R`,
  },
  {
    // Every solid placed by named points (P6), side by side along author Y:
    // a tetrahedron, a pyramid on a square and an apex, a prism rising from
    // a triangle along (K - J) x (L - J) with its new top named, a tilted
    // cylinder between two rim centres, and a frustum between two.
    label: 'Solids on points',
    group: 'Points & constructions',
    spec: `@mode: figure
A = (2, -14, 0)
B = (2, -11, 0)
C = (-1, -12.5, 0)
D = (1, -12.5, 3)
solid: tetrahedron A-B-C-D
E = (2, -7, 0)
F = (2, -4, 0)
G = (-1, -4, 0)
H = (-1, -7, 0)
I = (0.5, -5.5, 4)
solid: pyramid E-F-G-H apex I
J = (2, 0, 0)
K = (2, 3, 0)
L = (-1, 1.5, 0)
solid: prism J-K-L height 3 vertices MNQ
R = (1, 7, 0)
S = (-1, 9, 3)
solid: cylinder from R to S radius 1
T = (0, 13, 0)
U = (0, 13, 3)
solid: frustum from T radius 2 to U radius 1
label: KN`,
  },
  {
    // A cube is the box with three equal sides — byte for byte "prism 4 by 4
    // by 4" — lettered the same way, so AG is the space diagonal.
    label: 'Cube',
    group: 'Solids',
    spec: `@mode: figure
S = solid cube edge 4 vertices ABCDEFGH
segment: A-G
label: S edge
label: AG`,
  },
  {
    // The octahedron (P5): its square equator turned by the placement rule
    // and lettered from the front edge, then the top apex E and the bottom
    // apex F. EF and AC are both 6 sqrt 2.
    label: 'Octahedron',
    group: 'Solids',
    spec: `@mode: figure
O = solid octahedron edge 6 vertices ABCDEF
segment: E-F
label: O edge
label: EF`,
  },
  {
    // A regular pentagonal pyramid (P5), its apex over the base centre.
    label: 'Regular pyramid',
    group: 'Solids',
    spec: `@mode: figure
P = solid pyramid regular 5 side 4, height 6 vertices ABCDEF
label: P side
label: P height`,
  },
  {
    // A pyramid on a rectangle: width along Y by depth along X, like a box.
    label: 'Rectangle pyramid',
    group: 'Solids',
    spec: `@mode: figure
P = solid pyramid rectangle 6 by 4, height 9 vertices ABCDE
label: P width
label: P depth
label: P height`,
  },
  {
    // A pyramidal frustum: a square base of side 6, the top of side 3 over
    // it, turned with it.
    label: 'Pyramidal frustum',
    group: 'Solids',
    spec: `@mode: figure
F = solid frustum regular 4 side 6, top 3, height 4 vertices ABCDEFGH
label: F side
label: F top
label: F height`,
  },
  {
    // Phase 8: the plane through the centre O square to the space diagonal
    // A-G cuts the cube in a regular hexagon through six edge midpoints.
    // Shaded in place, its three sides on the back faces dashed; lifted at
    // true shape, P on the left and the rest counter-clockwise, each side
    // sqrt 2 (half a face diagonal of the edge-2 cube).
    label: 'Cube: the hexagonal section',
    group: 'Sections',
    spec: `@mode: figure
A = (0, 0, 0)
B = (2, 0, 0)
C = (2, 2, 0)
D = (0, 2, 0)
E = (0, 0, 2)
F = (2, 0, 2)
G = (2, 2, 2)
H = (0, 2, 2)
K = solid hull A-B-C-D-E-F-G-H
O = midpoint A-G
cut: K by plane through O perpendicular to A-G
section: K by plane through O perpendicular to A-G vertices PQRSTU
label: PQ          # sqrt 2`,
  },
  {
    // The regular tetrahedron's square section: the plane through the
    // midpoints of AB, AC and BD is parallel to BC and AD, which are
    // perpendicular, so it cuts a square of side 3 (half an edge).
    label: 'Tetrahedron: the square section',
    group: 'Sections',
    spec: `@mode: figure
T = solid tetrahedron edge 6 vertices ABCD
M = midpoint A-B
N = midpoint A-C
L = midpoint B-D
cut: T by plane M-N-L
section: T by plane M-N-L vertices PQRS
segment: P-R
label: PQ          # 3, half of BC
label: PR          # the diagonal, 3 sqrt 2`,
  },
  {
    // AIME 2007 I #13: a square pyramid with all eight edges 4 (so its height
    // is 2 sqrt 2), cut by the plane through the midpoints of AE, BC and CD.
    // The section is a pentagon of area sqrt 80.
    label: 'Pyramid through midpoints',
    group: 'Sections',
    spec: `@mode: figure
W = solid pyramid square base 4, height 2*sqrt(2) vertices ABCDE
M = midpoint A-E
N = midpoint B-C
K = midpoint C-D
cut: W by plane M-N-K
section: W by plane M-N-K vertices PQRSU`,
  },
  {
    // A cylindrical log cut at 45 degrees through a diameter of its base: the
    // wedge's face is half an ellipse (semi-axes 3 and 3 sqrt 2), standing on
    // the base diameter. In place the chord on the base and the back of the
    // arc are dashed; lifted, the chord PQ is the diameter.
    label: 'Log wedge',
    group: 'Sections',
    spec: `@mode: figure
C = solid cylinder radius 3, height 10
cut: C by plane x - z = 5
section: C by plane x - z = 5 vertices PQ
label: PQ          # 6`,
  },
  {
    // A 13-14-15 triangle ABC with O 20 from each vertex, and the sphere of
    // radius 20 about O through A, B and C. Plane A-B-C cuts the sphere in
    // the circumcircle of ABC, radius 65/8, and O is 15 sqrt(95)/8 above it.
    label: 'Sphere through three points',
    group: 'Sections',
    spec: `@mode: figure
T = solid tetrahedron ABCO with AB = 13, BC = 14, CA = 15, AO = 20, BO = 20, CO = 20
S = solid sphere center O radius 20
cut: S by plane A-B-C
section: S by plane A-B-C
F = foot O to plane A-B-C
segment: O-F
label: OF          # 15 sqrt(95) / 8`,
  },
  {
    // A plane by its equation, named once and used twice: to cut the box and
    // to drop a perpendicular from the corner F onto it. FK is the distance
    // from F = (3, 4, 2.5) to x + y + z = 4, which is 5.5 / sqrt 3.
    label: 'Plane by equation',
    group: 'Sections',
    spec: `@mode: figure
S = solid prism 8 by 5 by 6 vertices ABCDEFGH
p = plane x + y + z = 4
cut: S by plane p
section: S by plane p
K = foot F to plane p
segment: F-K
label: FK          # 5.5 / sqrt 3`,
  },
  {
    // Phase 9: AIME 2024 I, problem 14. Every face has area 6 sqrt 21 and
    // V = 160/3, so the inradius is 3V / (4 * 6 sqrt 21) = 20 sqrt 21 / 63
    // (1.455). The insphere is drawn through the tetrahedron (the glass rule)
    // and its centre named; the radius's reference is dashed inside it.
    label: 'AIME tetrahedron and its insphere',
    group: 'Spheres',
    spec: `@mode: figure
T = solid tetrahedron ABCD with AB = sqrt(41), CD = sqrt(41), AC = sqrt(80), BD = sqrt(80), AD = sqrt(89), BC = sqrt(89)
I = solid insphere of T
P = center of I
label: I radius    # 20 sqrt 21 / 63`,
  },
  {
    // A cube of edge 4 between its insphere (radius 2, touching each face at
    // its centre) and its circumsphere (radius 2 sqrt 3, through all eight
    // corners): MG runs from the common centre to a corner.
    label: 'Cube between two spheres',
    group: 'Spheres',
    spec: `@mode: figure
S = solid cube edge 4 vertices ABCDEFGH
I = solid insphere of S
O = solid circumsphere of S
M = center of O
segment: M-G
label: I radius
label: MG          # the circumradius, 2 sqrt 3`,
  },
  {
    // R = 3, H = 4: the slant is 5, so the insphere's radius is the axial
    // triangle's inradius, 3 * 4 / (3 + 5) = 1.5, touching the base at its
    // centre. The circumsphere passes through the apex and the base rim:
    // its centre is (16 - 9) / 8 = 7/8 above the base, its radius 4 - 7/8 =
    // 25/8.
    label: 'Sphere in a cone',
    group: 'Spheres',
    spec: `@mode: figure
K = solid cone radius 3, height 4
I = solid insphere of K
O = solid circumsphere of K
label: I radius
label: O radius    # 25/8
label: K height`,
  },
  {
    // A frustum has an insphere only when its height is 2 sqrt(r1 r2):
    // here 2 sqrt(4 * 1) = 4, so the sphere of radius 2 touches both rims'
    // discs and the side.
    label: 'Frustum with an insphere',
    group: 'Spheres',
    spec: `@mode: figure
F = solid frustum radius 4, top 1, height 4
I = solid insphere of F
label: I radius
label: F height`,
  },
  {
    // Spheres placed by tangency: S rests on the floor z = 0 (radius 2, the
    // distance from P), and T is externally tangent to S, so the distance
    // between their centres, PQ = sqrt 18, is the sum of the radii: T's is
    // sqrt 18 - 2. U, centred at R = 1 from Q inside T, is internally
    // tangent to T: radius (sqrt 18 - 2) - 1. The floor is outlined by four
    // segments; a plane is never drawn on its own.
    label: 'Spheres by tangency',
    group: 'Spheres',
    spec: `@mode: figure
P = (0, 0, 2)
S = solid sphere center P tangent to plane z = 0
Q = (4, 1, 3)
T = solid sphere center Q externally tangent to S
R = (4, 1, 4)
U = solid sphere center R internally tangent to T
segment: P-Q
label: PQ          # = 2 + (sqrt 18 - 2)
label: S radius
label: T radius
(-4, -4, 0) -- (6, -4, 0)
(6, -4, 0) -- (6, 5, 0)
(6, 5, 0) -- (-4, 5, 0)
(-4, 5, 0) -- (-4, -4, 0)`,
  },
  {
    // The sphere through four points: a corner of a cube of edge 2 and its
    // three neighbours along the axes. They lie on the cube's circumsphere,
    // so the centre is the cube's centre (1, 1, 1) and MA = sqrt 3.
    label: 'Sphere through four points',
    group: 'Spheres',
    spec: `@mode: figure
A = (0, 0, 0)
B = (2, 0, 0)
C = (0, 2, 0)
D = (0, 0, 2)
T = solid tetrahedron A-B-C-D
O = solid circumsphere A-B-C-D
M = center of O
segment: M-A
label: MA          # sqrt 3`,
  },
  {
    // Phase 10: AIME 2016 I. A regular hexagonal prism of side
    // 12; the pyramid on A and its three neighbours B, F and G has the
    // dihedral angle 60 degrees along BF between face ABF (in the base) and
    // face GBF. A is 6 from BF, so tan 60 = h / 6 and h^2 = 108. The mark
    // is the plane angle at the midpoint of BF, both segments dashed: one
    // lies in the base, which faces away, the other runs through the prism.
    label: 'AIME: dihedral in a hexagonal prism',
    group: 'Measures in space',
    spec: `@mode: figure
@angle: degrees
S = solid prism regular 6 side 12, height sqrt(108) vertices ABCDEFGHIJKL
segment: B-F
segment: F-G
segment: G-B
dihedral: A-B-F-G
label: dihedral A-B-F-G   # 60
find: S height            # sqrt 108`,
  },
  {
    // Phase 10: the diagonal AG and the edge BF of a unit cube are skew.
    // Their common perpendicular runs from P = (1/2, 1/2, 1/2), the centre,
    // to Q = (1, 0, 1/2) on BF, square to both (the right-angle marks are
    // asserted in space), and its length is the distance between the lines,
    // sqrt 2 / 2. It lies inside the cube, so it is dashed. The table also
    // measures the angle between the two lines (arccos(1/sqrt 3), 54.74),
    // P's distance to the line BF (PQ again) and to the face BCG (1/2).
    label: 'Skew lines and their common perpendicular',
    group: 'Measures in space',
    spec: `@mode: figure
@angle: degrees
A = (0, 0, 0)
B = (1, 0, 0)
C = (1, 1, 0)
D = (0, 1, 0)
E = (0, 0, 1)
F = (1, 0, 1)
G = (1, 1, 1)
H = (0, 1, 1)
S = solid hull A-B-C-D-E-F-G-H
segment: A-G
P, Q = common perpendicular of A-G and B-F
segment: P-Q
right-angle: G-P-Q
right-angle: F-Q-P
label: PQ                              # sqrt 2 / 2
given: distance between A-G and B-F
given: angle between A-G and B-F
given: distance from P to line B-F
given: distance from P to plane B-C-G`,
  },
  {
    // Phase 10: angles in a unit cube, true in space and not as drawn. The
    // face diagonals FH, HC and CF are equal (ticked), so FHC is equilateral
    // and its angle at H is 60 degrees; the arc is in the triangle's own
    // plane, inside the cube, so it is dashed. GC (an edge) is square to GE
    // (a diagonal of the top face): a right angle in space that projects to
    // an obtuse one.
    label: 'Angles in a cube',
    group: 'Measures in space',
    spec: `@mode: figure
@angle: degrees
A = (0, 0, 0)
B = (1, 0, 0)
C = (1, 1, 0)
D = (0, 1, 0)
E = (0, 0, 1)
F = (1, 0, 1)
G = (1, 1, 1)
H = (0, 1, 1)
S = solid hull A-B-C-D-E-F-G-H
segment: F-H
segment: H-C
segment: C-F
label: angle FHC       # 60
tick: C-F
tick: H-C
segment: E-G
right-angle: C-G-E`,
  },
  {
    // Phase 10: a regular tetrahedron's dihedral angle is arccos(1/3),
    // about 70.53 degrees, along every edge. Marked along AD, between the
    // faces ADB and ADC, which face the viewer; the table reads the same
    // value along the base edge AB.
    label: "Tetrahedron's dihedral angle",
    group: 'Measures in space',
    spec: `@mode: figure
@angle: degrees
T = solid tetrahedron edge 6 vertices ABCD
dihedral: B-A-D-C
label: dihedral B-A-D-C   # arccos(1/3)
given: dihedral C-A-B-D`,
  },
  {
    // Phase 10: the angle between a line and a plane is the angle between
    // the line and its projection: here AG against the floor ABCD, with F
    // the foot of G. |AF| = 5 and the height is 5, so both the marked angle
    // GAF and the table's line-plane angle read 45 degrees.
    label: 'Line meets a plane',
    group: 'Measures in space',
    spec: `@mode: figure
@angle: degrees
A = (6, 0, 0)
B = (6, 5, 0)
C = (0, 5, 0)
D = (0, 0, 0)
G = (3, 4, 5)
F = foot G to plane A-B-C
segment: A-B
segment: B-C
segment: C-D
segment: D-A
segment: A-G
segment: G-F dashed
segment: A-F
angle: G-A-F
label: angle GAF          # 45
right-angle: G-F-A
given: angle between A-G and plane A-B-C`,
  },
  {
    // Phase 11 (N1, N2): the cube's cross. The four side faces in one strip
    // from the front face ABFE, the base and the top on the second face; the
    // five fold lines dashed, the cut edges solid. Letters repeat at every
    // copy of a vertex — A three times — and are labels, not points.
    label: 'Cube and its net',
    group: 'Nets and paths',
    spec: `@mode: figure
S = solid cube edge 4 vertices ABCDEFGH
net: S`,
  },
  {
    // Phase 11: a regular hexagonal prism's strip — six side faces left to
    // right from AB, the two hexagons on the third.
    label: "A prism's strip",
    group: 'Nets and paths',
    spec: `@mode: figure
P = solid prism regular 6 side 2, height 4 vertices ABCDEFGHIJKL
net: P`,
  },
  {
    // Phase 11: a square pyramid's star — the base, each triangle folded
    // out about its base edge. The apex E appears four times.
    label: "A pyramid's star",
    group: 'Nets and paths',
    spec: `@mode: figure
P = solid pyramid regular 4 side 4, height 3 vertices ABCDE
net: P`,
  },
  {
    // Phase 11: a cone of radius 3 and height 4 has slant 5, so its side
    // unrolls to a sector of radius 5 and angle 2π · 3/5 = 216°, the base
    // circle tangent at the arc's middle. The seam is cut behind, so the
    // side facing the viewer is the middle of the sector.
    label: "A cone's sector",
    group: 'Nets and paths',
    spec: `@mode: figure
K = solid cone radius 3, height 4
net: K
label: K radius
label: K height`,
  },
  {
    // Phase 11: a cylinder unrolls to a rectangle 2πr by h, both rims
    // tangent at the middles of its long edges; a conical frustum to an
    // annular sector of the cone it was cut from (radii 20/3 and 5/3 here,
    // angle 6π/5), each rim tangent at its arc's middle.
    label: 'Cylinder and frustum nets',
    group: 'Nets and paths',
    spec: `@mode: figure
O = (0, 0, 0)
M = (0, 0, 10)
C = solid cylinder from O to M radius 3
net: C
N = (0, 0, -14)
L = (0, 0, -10)
F = solid frustum from N radius 4 to L radius 1
net: F`,
  },
  {
    // Phase 11 (N3): Dudeney's spider and fly. The room is 30 long, 12 wide
    // and 12 high; the spider P is on one end wall, on its centre line, 1
    // below the ceiling, and the fly Q on the other, 1 above the floor. Over
    // the ceiling and down is 1 + 30 + 11 = 42; across five faces — end
    // wall, ceiling, side wall, floor, end wall — it is √(32² + 24²) = 40.
    label: "Dudeney's spider and fly",
    group: 'Nets and paths',
    spec: `@mode: figure
R = solid prism 30 by 12 by 12 vertices ABCDEFGH
P = (0, -15, 5)
Q = (0, 15, -5)
shortest: P to Q over R unfold color: red
label: shortest P to Q over R = 40`,
  },
  {
    // Phase 11 (N4), AIME: a cone of radius 600 and height 200√7 (slant
    // 800). A fly starts 125 from the apex and crawls to the exactly
    // opposite generator, 375√2 from the apex. Unrolled, the sector is
    // 3π/2 and the two generators 3π/4 apart, so the path is
    // √(125² + (375√2)² + 2 · 125 · 375√2 · √2/2) = 625. A path on a curved
    // side is drawn on the unrolling, straight.
    label: 'AIME: a fly on a cone',
    group: 'Nets and paths',
    spec: `@mode: figure
V = (0, 0, 200*sqrt(7))
O = (0, 0, 0)
R = (0, 600, 0)
T = (0, -600, 0)
K = solid cone apex V base O radius 600
segment: V-R
segment: V-T
P = divide V-R at 125:675
Q = divide V-T at 375*sqrt(2):800-375*sqrt(2)
shortest: P to Q over K color: red
label: shortest P to Q over K = 625`,
  },
  {
    // Phase 11 (N3): corner to corner over a unit cube. The space diagonal
    // AG is √3, but over the surface the path crosses two faces through the
    // middle of their shared edge: unfolded, a 2-by-1 rectangle's diagonal,
    // √5. With "unfold", the strip of the two faces is lifted beside it.
    label: 'Over a cube, corner to corner',
    group: 'Nets and paths',
    spec: `@mode: figure
S = solid cube edge 1 vertices ABCDEFGH
shortest: A to G over S unfold color: red
label: shortest A to G over S
segment: A-G
label: AG`,
  },
  {
    // Phase 11 (N4): round a cylinder of radius 3 and height 10, from 1 up
    // on one generator to 9 up on the one opposite: half the rim, 3π, by 8,
    // hypot(3π, 8) ≈ 12.36, straight on the unrolled side.
    label: 'Round a cylinder',
    group: 'Nets and paths',
    spec: `@mode: figure
C = solid cylinder radius 3, height 10
P = (0, 3, -4)
Q = (0, -3, 4)
shortest: P to Q over C color: red
label: shortest P to Q over C`,
  },
  {
    label: 'Right angle',
    group: 'Plane geometry',
    spec: `polygon: A(0,0), B(4,0), C(0,3)
right-angle: B-A-C`,
  },
  {
    label: 'Isosceles angles',
    group: 'Plane geometry',
    spec: `polygon: A(0,0), B(6,0), C(3,4)
tick: A-C
tick: B-C
angle: B-A-C label: α
angle: A-B-C label: α`,
  },
  {
    label: 'Hexagon',
    group: 'Plane geometry',
    spec: `circle: (0, 0), 3
polygon: A(3*cos(0), 3*sin(0)), B(3*cos(pi/3), 3*sin(pi/3)), C(3*cos(2*pi/3), 3*sin(2*pi/3)), D(3*cos(pi), 3*sin(pi)), E(3*cos(4*pi/3), 3*sin(4*pi/3)), F(3*cos(5*pi/3), 3*sin(5*pi/3))`,
  },
  // Phase 12 — "find the area of the shaded region". Each fill is one path
  // behind the author's own lines, holes by the even-odd rule, and its area
  // is exact: "label: area R" computes it and prints it to three places. A
  // symbolic "= 16 − 4π" prints as written and is NOT checked — asserting an
  // exact expression waits on exact values (build step 3), engine-wide.
  {
    // 4² − π·2² = 16 − 4π ≈ 3.434, labelled in a corner (F6: the lowest of
    // seven lines is the first to clear the circle).
    label: 'Square minus its circle',
    group: 'Shaded regions',
    spec: `@mode: figure
polygon: A(0,0), B(4,0), C(4,4), D(0,4)
M = (2, 2)
O = circle M, 2               # the inscribed circle: named O, centred at M
fill: square ABCD minus circle O name: R
label: area R                 # computed: 3.434
given: area R = 16 − 4π       # symbolic: printed as written, not checked (exact values are build step 3)`,
  },
  {
    // Two unit circles a radius apart: each chord through the crossings
    // subtends 120° at its centre, so the lens is 2π/3 − √3/2 ≈ 1.228.
    label: 'Lens of two circles',
    group: 'Shaded regions',
    spec: `@mode: figure
K = (0, 0)
L = (1, 0)
O = circle K, 1
P = circle L, 1
fill: circle O and circle P name: R    # "and" is the intersection
label: area R`,
  },
  {
    // π(3² − 2²) = 5π ≈ 15.708. The label sits in the ring, never in the hole.
    label: 'Annulus',
    group: 'Shaded regions',
    spec: `@mode: figure
M = (0, 0)
O = circle M, 3
P = circle M, 2
T = (0, 3)
S = (2, 0)
fill: circle O minus circle P name: R
radius O to T
radius P to S
label: MT
label: MS
label: area R                 # computed: 15.708, which is 5π`,
  },
  {
    // A-C-B on a line, AC = 4 and CB = 2: the half-disk on AB less the half-
    // disks on AC and CB, π/2 (3² − 2² − 1²) = 2π ≈ 6.283. The circles are
    // hidden and only their upper arcs drawn; each half-disk is a circular
    // segment on its diameter.
    label: 'Arbelos',
    group: 'Shaded regions',
    spec: `@mode: figure
@hide: circles
A = (0, 0)
C = (4, 0)
B = (6, 0)
M = (3, 0)
N = (2, 0)
K = (5, 0)
k = circle M, 3 name: circles
m = circle N, 2 name: circles
n = circle K, 1 name: circles
fill: segment B-A on k ccw minus segment C-A on m ccw minus segment B-C on n ccw name: R
arc B-A on k ccw
arc C-A on m ccw
arc B-C on n ccw
segment: A-B
label: area R                 # computed: 6.283, which is 2π`,
  },
  {
    // A 120° sector of radius 3 less its triangle is the circular segment on
    // the same arc: ½·9·(2π/3 − sin 120°) ≈ 5.528, both ways.
    label: 'Circular segment',
    group: 'Shaded regions',
    spec: `@mode: figure
M = (0, 0)
O = circle M, 3
P = (3, 0)
Q = (-1.5, 3*sqrt(3)/2)
fill: sector P-Q on O minor minus triangle MPQ name: S
radius O to P
radius O to Q
chord P-Q on O
label: area S
given: area sector P-Q on O minor minus triangle MPQ
given: area segment P-Q on O minor`,
  },
  {
    // A square with a circle on its top side: the square and the half of the
    // disk above it, 16 + 2π ≈ 22.283.
    label: 'Shaded union',
    group: 'Shaded regions',
    spec: `@mode: figure
polygon: A(0,0), B(4,0), C(4,4), D(0,4)
M = (2, 4)
O = circle M, 2
fill: square ABCD or circle O name: U color: teal
label: area U                 # computed: 22.283, which is 16 + 2π`,
  },
  // Figure styles, part 1: figures pinned to a look with "@style…" lines.
  // The style lab (review/style-lab.html) tunes every setting live; these are
  // the looks as a spec writes them.
  {
    label: 'Ink: centres and circles',
    group: 'Styles',
    spec: `@style: ink
@mode: figure
@angle: degrees
triangle ABC: AB = 9, BC = 8, AC = 7
O = circumcenter ABC
H = orthocenter ABC
I = incenter ABC
incircle of ABC
circumcircle of ABC
segment: O-H dashed   # the Euler line`,
  },
  {
    label: 'Pencil: a square less its circle',
    group: 'Styles',
    spec: `@style: pencil
@mode: figure
polygon: A(0,0), B(4,0), C(4,4), D(0,4)
M = (2, 2)
O = circle M, 2
fill: square ABCD minus circle O name: R
label: area R`,
  },
  {
    label: 'Marker: a cube and its net',
    group: 'Styles',
    spec: `@style: marker
@mode: figure
S = solid cube edge 4 vertices ABCDEFGH
net: S`,
  },
  {
    label: 'Brush on canvas',
    group: 'Styles',
    spec: `@style: ink
@style-line: brush
@style-paper: canvas
@style-fill: wash
@style-lettering: hand
@mode: figure
O = (0, 0)
k = circle O, 5
P = (-3, 4)
Q = (4, 3)
chord P-Q on k
sector P-Q on k minor
t = tangent at P on k
radius k to Q`,
  },
  {
    label: 'Chalk on rough graph paper',
    group: 'Styles',
    spec: `@style: pencil
@style-line: chalk
@style-paper: rough-graph
@style-fill: crosshatch
@style-saturation: 0.8
@mode: figure
M = (0, 0)
O = circle M, 3
P = circle M, 2
T = (0, 3)
fill: circle O minus circle P name: R
radius O to T
label: area R`,
  },
  {
    label: 'Stipple, dotted paper, seed 7',
    group: 'Styles',
    spec: `@style: ink
@style-fill: stipple
@style-paper: dotted
@style-looseness: 0.45
@style-seed: 7
@mode: figure
A = (0, 0)
B = (1, 0)
j = circle A, 1
k = circle B, 1
fill: circle j and circle k name: L
label: area L`,
  },
  {
    label: 'Hyperbola',
    group: 'Graphing',
    spec: `x^2/4 - y^2/9 = 1`,
  },
  {
    label: 'Damped oscillation',
    group: 'Graphing',
    spec: `y = exp(-x/4) * cos(3x)
y = exp(-x/4) color: gray
y = -exp(-x/4) color: gray`,
  },
  {
    label: 'Functions',
    group: 'Graphing',
    spec: `k(x) = x^2 - 2x + 1
a = 3
y = a * k(x - 2) color: teal
y = k(k(x)) - 5 color: purple`,
  },
  // Space (track 3): space/examples.ts.
  ...SPACE_EXAMPLES,
  // Calculus (track 4, calc P1): the language the 2D engine now compiles
  // through the shared kernel.
  {
    label: 'Cube roots, both halves',
    group: 'Calculus',
    spec: `y = x^(1/3)
y = x^(2/3) color: blue`,
  },
  {
    label: 'Piecewise in braces',
    group: 'Calculus',
    spec: `f(x) = {x < 0: x^2, x <= 2: 2x + 1, 5}
y = f(x)`,
  },
  {
    label: 'Taylor partial sums of sin',
    group: 'Calculus',
    spec: `@param n = 3 range [0, 12] step 1 integer
y = sin(x)
y = sum(k = 0 to n, (-1)^k x^(2k+1)/(2k+1)!) color: red`,
  },
  {
    label: 'Accumulation: the sine integral',
    group: 'Calculus',
    spec: `F(x) = integral(t = 0 to x, sin(t)/t)
y = F(x)
y = sin(x)/x color: gray`,
  },
  {
    label: 'Derivatives by primes',
    group: 'Calculus',
    spec: `f(x) = x^3 - 3x
y = f(x)
y = f'(x) color: red
y = f''(x) color: blue`,
  },
  {
    label: 'Special functions',
    group: 'Calculus',
    spec: `@bounds: -4, 6, -4, 6
y = gamma(x)
y = erf(x) color: blue
y = |x - 1| - 2 color: gray`,
  },
  {
    label: 'Conditions on a region',
    group: 'Calculus',
    spec: `x^2 + y^2 < 9 if y > 0 and x > -1`,
  },
  {
    label: 'A two-argument helper',
    group: 'Calculus',
    spec: `g(x, a) = a sin(x)
y = g(x, 2)
y = g(x, 0.5) color: blue`,
  },
  // Calculus (track 4, calc P2): the adaptive curve sampler. Each of these is a case in
  // plot/testing/corpus.ts, which pins what it draws.
  {
    label: 'Holes, jumps and poles',
    group: 'Calculus',
    spec: `@bounds: -5, 5, -5, 5
y = (x^2-1)/(x-1)
y = floor(x) color: blue
y = tan(x) color: red`,
  },
  {
    label: 'Piecewise ends',
    group: 'Calculus',
    spec: `@bounds: -3, 5, -2, 6
y = {x < 0: x^2, x + 1}
y = 2 if 0 < x <= 3 color: green`,
  },
  {
    label: 'Faster than a pixel',
    group: 'Calculus',
    spec: `@bounds: -1, 1, -1.5, 1.5
y = sin(1/x)`,
  },
  {
    label: 'A polar pole',
    group: 'Calculus',
    spec: `@bounds: -3, 5, -4, 4
r = 1/cos(theta)`,
  },
]
