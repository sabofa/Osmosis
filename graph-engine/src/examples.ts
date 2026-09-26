// The review harness's example specs, in their own module so a test can import
// them directly. Every one of these is a button in the harness, and a button
// that does not parse is a defect a user sees immediately — see
// examples.test.ts, which renders all of them.

export interface Example {
  label: string
  spec: string
}

export const EXAMPLES: Example[] = [
  {
    label: '2D',
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
    spec: `z = sin(x) * cos(y)
(3*cos(u)*sin(v), 3*sin(u)*sin(v), 3*cos(v)) for u in [0, 6.283], v in [0, 3.1416]   # sphere
A = (2, 2, 3)
(0,0,0) -- (3,3,0)
(0,0,0) -> (0,0,4)
(cos(t)*2, sin(t)*2, t*0.3) for t in [0, 18.85]   # helix`,
  },
  {
    label: 'Inequality',
    spec: `@hover: none
y > x^2 - 4
x^2 + y^2 <= 16`,
  },
  {
    label: 'Vector',
    spec: `vector: (0,0) -> (3,4)
vector: (0,0) -> (-2,3) color: purple`,
  },
  {
    label: 'Tangent',
    spec: `y = x^3 - 3x
tangent: x^3 - 3x at x = 1
tangent: x^3 - 3x at x = -1 color: purple`,
  },
  {
    label: 'Animate',
    spec: `k(t) = cos(t) * 2
animate: (k(t), sin(t)*2) for t in [0, 6.283]   # references k(t), a named function`,
  },
  {
    label: 'Piecewise',
    spec: `@points: vertices
y = -x - 1 if x < 0
y = x^2 - 1 if x >= 0`,
  },
  {
    label: 'Polar',
    spec: `r = 2 + 2*sin(3*theta)`,
  },
  {
    label: 'Slope field',
    spec: `field: dy/dx = x - y
y = x - 1   # one solution curve through the field`,
  },
  {
    label: 'Scatter',
    spec: `scatter: (1,2.1), (2,3.9), (3,6.2), (4,7.8), (5,10.1), (6,11.9)`,
  },
  {
    label: 'Table (data)',
    spec: `@mode: table
header: Score range | Frequency
row: 90-100 | 4
row: 80-89 | 9
row: 70-79 | 13
row: 60-69 | 5`,
  },
  {
    label: 'Table (function)',
    spec: `@mode: table
table: y = x^2 - 1 for x in [0, 6] step 1`,
  },
  {
    label: 'Table (formula)',
    spec: `@mode: table
@formulas: on
table: y = x^2 - 1 for x in [0, 6] step 1`,
  },
  {
    label: 'Table (multiple)',
    spec: `@mode: table
scores.header: Trial | Score
scores.row: 1 | 82
scores.row: 2 | 91
scores.row: 3 | 76
times.table: y = 2x + 1 for x in [0, 4] step 1`,
  },
  {
    label: 'Hide/show',
    spec: `@hide: helper
y = x^2 name: main
y = x + 3 color: teal name: helper`,
  },
  {
    label: 'Feature points',
    spec: `@points: roots, extrema, inflections
@point-labels: coords
y = x^3 - 3x`,
  },
  {
    label: 'Intersections',
    spec: `@points: intersections
y = x^2
y = x + 2`,
  },
  {
    label: 'No numbers',
    spec: `@labels: none
y = x^2 - 4`,
  },
  {
    label: 'Steps of 8',
    spec: `@xstep: 8
@ystep: 8
@step-mode: geometric
y = x^2   # zoom out: 8 -> 64 -> 512, never 10`,
  },
  {
    label: 'Circle',
    spec: `circle: (0, 0), 3
O = (0, 0)`,
  },
  {
    label: 'Triangle',
    spec: `polygon: A(0,0), B(4,0), C(2,3)
tick: A-C
tick: B-C
angle: A-B-C label: x°`,
  },
  {
    label: 'Solved triangle',
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
    spec: `@mode: figure
S = solid prism 8 by 5 by 6
label: S width = 8
label: S height = 5
label: S depth = 6`,
  },
  {
    label: 'Tetrahedron',
    spec: `@mode: figure
T = solid tetrahedron edge 5 vertices ABCD
label: T edge = 5`,
  },
  {
    label: 'Cylinder',
    spec: `@mode: figure
C = solid cylinder radius 3, height 8
label: C radius = 3
label: C height = 8`,
  },
  {
    label: 'Cross-section (cut)',
    spec: `@mode: figure
S = solid prism 8 by 5 by 6
cut: S by plane z = 1      # shaded where it lies`,
  },
  {
    label: 'Cross-section (lifted)',
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
    spec: `@mode: figure
@givens: right
S = solid prism 8 by 5 by 6 vertices ABCDEFGH
segment: A-G       # dashed where the box hides it
label: AG          # the TRUE length, sqrt(125), not the drawn one
given: AB = 8`,
  },
  {
    label: 'Foot of a perpendicular',
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
    spec: `@mode: figure
T = solid tetrahedron edge 6 vertices ABCD
F = foot D to plane A-B-C
segment: D-F       # the altitude, inside the solid, so dashed
label: DF          # 6 sqrt(2/3) = 4.899
label: T edge = 6`,
  },
  {
    label: 'Sphere with a chord',
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
    label: 'Right angle',
    spec: `polygon: A(0,0), B(4,0), C(0,3)
right-angle: B-A-C`,
  },
  {
    label: 'Isosceles angles',
    spec: `polygon: A(0,0), B(6,0), C(3,4)
tick: A-C
tick: B-C
angle: B-A-C label: α
angle: A-B-C label: α`,
  },
  {
    label: 'Hexagon',
    spec: `circle: (0, 0), 3
polygon: A(3*cos(0), 3*sin(0)), B(3*cos(pi/3), 3*sin(pi/3)), C(3*cos(2*pi/3), 3*sin(2*pi/3)), D(3*cos(pi), 3*sin(pi)), E(3*cos(4*pi/3), 3*sin(4*pi/3)), F(3*cos(5*pi/3), 3*sin(5*pi/3))`,
  },
  {
    label: 'Hyperbola',
    spec: `x^2/4 - y^2/9 = 1`,
  },
  {
    label: 'Damped oscillation',
    spec: `y = exp(-x/4) * cos(3x)
y = exp(-x/4) color: gray
y = -exp(-x/4) color: gray`,
  },
  {
    label: 'Functions',
    spec: `k(x) = x^2 - 2x + 1
a = 3
y = a * k(x - 2) color: teal
y = k(k(x)) - 5 color: purple`,
  },
]
