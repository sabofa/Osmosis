// Space's review-harness examples, one per capability, concatenated onto
// EXAMPLES by examples.ts. examples.test.ts builds every one through the
// space kernel and asserts it draws with no errors; space/examples.test.ts
// checks that each S3 example exercises what its label promises.

import type { Example } from '../examples'
import { SURFACE_TOOL_EXAMPLES } from './surfaceToolExamples'

export const SPACE_EXAMPLES: Example[] = [
  {
    label: 'Space · Paraboloid over a disk',
    spec: `z = 4 - x^2 - y^2 over x^2 + y^2 <= 4   # an inequality domain, clipped exactly`,
  },
  {
    label: 'Space · Saddle over a type I region',
    spec: `z = x^2 - y^2 over x in [-1, 1], y in [x^2 - 1, 1 - x^2]   # inner bounds read x`,
  },
  {
    label: 'Space · Polar domain',
    spec: `z = r^2 sin(2 theta) / 2 over r in [0, 2], theta in [0, 2*pi]   # r and theta in the body`,
  },
  {
    label: 'Space · A helix on a sphere, named r(t)',
    spec: `hx(t) = 2 cos(8t) sin(t)
hy(t) = 2 sin(8t) sin(t)
hz(t) = 2 cos(t)
r(t) = <hx(t), hy(t), hz(t)>        # a named vector function: |r(t)| = 2
(2 cos(u) sin(v), 2 sin(u) sin(v), 2 cos(v)) for u in [0, 2*pi], v in [0, pi] opacity: 0.5
(hx(t), hy(t), hz(t)) for t in [0, pi] width: 3`,
  },
  {
    label: 'Space · A parameter',
    spec: `@param a = 1 range [-2, 2] step 0.1
z = a*x^2 + y^2 for x in [-2, 2], y in [-2, 2]`,
  },
  {
    label: 'Space · Ticks in multiples of pi',
    spec: `@ticks3d: x pi/2, y pi/2
z = sin(x) cos(y) for x in [-2*pi, 2*pi], y in [-2*pi, 2*pi]`,
  },
  {
    label: 'Space · A diverging colormap',
    spec: `z = x^2 - y^2 for x in [-2, 2], y in [-2, 2] colormap: x*y diverging   # balance: blue below 0, red above; see the colorbar`,
  },
  {
    label: 'Space · Play a parameter',
    spec: `@param k = 1 range [0.5, 3]   # press ▶ beside k; ⟲ ping-pongs
z = sin(k x) cos(k y) for x in [-3, 3], y in [-3, 3]`,
  },
  {
    label: 'Space · Drag a point on a paraboloid',
    spec: `@param a = 0.8 range [-2, 2]
@param b = 0.6 range [-2, 2]
z = x^2 + y^2 for x in [-2, 2], y in [-2, 2] opacity: 0.6
P = (a, b, a^2 + b^2)   # drag P: it stays on the surface, and a and b follow`,
  },
  {
    label: 'Space · A helix through a translucent sphere',
    spec: `(sin(v) cos(u), sin(v) sin(u), cos(v)) for v in [0, pi], u in [0, 2*pi] opacity: 0.4
(0.6 cos(6t), 0.6 sin(6t), t) for t in [-1.6, 1.6] width: 3   # inside the sphere it reads through it`,
  },
  {
    label: 'Space · A helix behind a surface',
    spec: `z = x^2 - y^2 for x in [-1.5, 1.5], y in [-1.5, 1.5]
(1.2 cos(t), 1.2 sin(t), t/3) for t in [-6, 6] width: 3   # faint and dashed where the saddle hides it`,
  },
  {
    label: 'Space · A pole cut by the box',
    spec: `z = 1/(x^2 + y^2) for x in [-2, 2], y in [-2, 2]   # the box's ceiling cuts it cleanly; hover to read f and its partials`,
  },
  {
    label: 'Space · Axes, points and vectors',
    spec: `@frame: axes
A = (1, 2, 3)
B = (-2, 1, 1)
vector: (0,0,0) -> (1,2,3)
vector: (0,0,0) -> (-2,1,1) color: purple
(1,2,3) -- (-2,1,1)`,
  },
  // S4a: surfaces in space, vectors, lines, planes and curve frames.
  { label: 'Space · Quadric: ellipsoid', spec: `@bounds3d: x [-3, 3], y [-3, 3], z [-3, 3]
@aspect: equal
x^2/9 + y^2/4 + z^2 = 1   # an implicit surface: marching tetrahedra, normals from the gradient` },
  { label: 'Space · Quadric: hyperboloid of one sheet', spec: `@bounds3d: x [-2, 2], y [-2, 2], z [-2, 2]
x^2 + y^2 - z^2 = 1   # open at the box` },
  { label: 'Space · Quadric: hyperboloid of two sheets', spec: `@bounds3d: x [-3, 3], y [-3, 3], z [-3, 3]
z^2 - x^2 - y^2 = 1` },
  { label: 'Space · Quadric: cone', spec: `@bounds3d: x [-2, 2], y [-2, 2], z [-2, 2]
z^2 = x^2 + y^2   # the apex takes the face-normal fallback` },
  { label: 'Space · Quadric: elliptic paraboloid', spec: `@bounds3d: x [-2, 2], y [-3, 3], z [0, 4]
x^2 + y^2/4 = z` },
  { label: 'Space · Quadric: hyperbolic paraboloid', spec: `@bounds3d: x [-2, 2], y [-2, 2], z [-4, 4]
y^2 - x^2 = z` },
  { label: 'Space · A cylinder by implicit:', spec: `@bounds3d: x [-3, 3], y [-3, 3], z [-2, 2]
implicit: x^2 + y^2 = 4   # without implicit: this is a circle on the floor` },
  {
    label: 'Space · A plane and a line meeting at a point',
    spec: `@bounds3d: x [-1, 3], y [-1, 3], z [-1, 3]
plane: x + y + z = 3
line: through (0, 0, 0) direction <1, 2, 3>
M = (0.5, 1, 1.5)   # 0.5 + 1 + 1.5 = 3: t = 1/2 on the line
plane: through (0, 0, 2), (2, 0, 2), (0, 2, 3) opacity: 0.2`,
  },
  {
    label: 'Space · Cross product: the parallelogram',
    spec: `@aspect: equal
u = <2, 0, 0>
v = <1, 2, 0>
cross: u x v   # u × v = (0, 0, 4), the parallelogram's area`,
  },
  {
    label: 'Space · Projection of u onto v',
    spec: `@angle: degrees
@aspect: equal
u = <2, 3, 1>
v = <4, 1, 0>
project: u onto v`,
  },
  { label: 'Space · A cone in cylindrical coordinates', spec: `@bounds3d: x [-2, 2], y [-2, 2], z [0, 2]
cylindrical: z = r   # r over [0, 2], theta over a full turn` },
  { label: 'Space · A cone in spherical coordinates', spec: `@bounds3d: x [-2, 2], y [-2, 2], z [0, 3]
spherical: phi = pi/6   # phi from +z` },
  { label: 'Space · Spherical: rho = 2 sin(phi)', spec: `@bounds3d: x [-2, 2], y [-2, 2], z [-2, 2]
spherical: rho = 2 sin(phi) opacity: 0.8` },
  {
    label: 'Space · The TNB frame of a helix',
    spec: `@bounds3d: x [-2, 2], y [-2, 2], z [0, 7]
r(t) = <cos(t), sin(t), t>
(cos(t), sin(t), t) for t in [0, 2*pi]
frame: r at t = pi/2`,
  },
  {
    label: 'Space · The osculating circle of a helix',
    spec: `@bounds3d: x [-3, 3], y [-3, 3], z [-1, 5]
r(t) = <cos(t), sin(t), t>
(cos(t), sin(t), t) for t in [-1, 5]
osculating: r at t = pi/2   # kappa = 1/2, radius 2`,
  },
  {
    label: 'Space · Velocity and acceleration, with components',
    spec: `@bounds3d: x [-4, 4], y [-3, 3], z [0, 3.5]
@aspect: equal
r(t) = <3 cos(t), 2 sin(t), t/2>
(3 cos(t), 2 sin(t), t/2) for t in [0, 2*pi]
motion: r at t = 3*pi/4 components   # slowing down: a_T points back along v`,
  },
  {
    label: 'Space · Nested level surfaces',
    spec: `@bounds3d: x [-3.5, 3.5], y [-3.5, 3.5], z [-3.5, 3.5]
g(x, y, z) = x^2 + 2y^2 + 3z^2
contour: g levels 1, 4, 9   # three ellipsoids, coloured by value`,
  },
  ...SURFACE_TOOL_EXAMPLES,
  {
    label: 'Space · A type I region with a surface over it',
    spec: `R = region x in [0, 1], y in [x^2, x]   # between the parabola and the line; area 1/6
region: R
z = 1 + x*y over R opacity: 0.8`,
  },
  {
    label: 'Space · A polar region',
    spec: `region: r in [1, 2], theta in [0, pi/2]   # a quarter annulus; area 3π/4`,
  },
  {
    label: 'Space · The volume under a dome',
    spec: `volume: under 4 - x^2 - y^2 over r in [0, 2], theta in [0, 2*pi]   # 8π, with the polar Jacobian r`,
  },
  {
    label: 'Space · The volume between two surfaces',
    spec: `volume: between x^2 + y^2 and 2 over x in [-1, 1], y in [-1, 1]   # 16/3, with its four walls`,
  },
  {
    label: 'Space · A Riemann sum, refined by n',
    spec: `@param n = 2 range [1, 16] integer
z = x*y for x in [0, 2], y in [0, 2] opacity: 0.35 mesh: off
riemann: under x*y over x in [0, 2], y in [0, 2], n = n   # play n: the sum approaches 4`,
  },
  {
    label: 'Space · The tetrahedron as a triple integral',
    spec: `volume: x in [0, 1], y in [0, 1 - x], z in [0, 1 - x - y]   # 1/6; the x = 1 and y = 1 - x faces collapse`,
  },
  {
    label: 'Space · The ice-cream cone in spherical coordinates',
    spec: `volume: rho in [0, 2], phi in [0, pi/4], theta in [0, 2*pi] spherical`,
  },
  {
    label: 'Space · A cylindrical region',
    spec: `volume: r in [0, 2], theta in [0, 3*pi/2], z in [0, 4 - r^2] cylindrical   # three quarters of the dome`,
  },
  {
    label: 'Space · The centroid of a half-disc',
    spec: `D = region r in [0, 1], theta in [0, pi]
region: D
centroid: D   # (0, 4/(3π))`,
  },
  {
    label: 'Space · The centre of mass of a tetrahedron',
    spec: `V = volume x in [0, 1], y in [0, 1 - x], z in [0, 1 - x - y]
volume: V opacity: 0.25
centroid: V density 1 + z   # heavier at the top, so the centre rises above z = 1/4`,
  },
]
