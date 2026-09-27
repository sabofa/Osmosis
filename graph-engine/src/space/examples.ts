// Space's review-harness examples (S1), one per new capability, concatenated
// onto EXAMPLES by examples.ts. examples.test.ts builds every one through the
// space kernel and asserts it draws with no errors. Until S2 swaps the
// renderer, the harness draws them with the old three.js renderer, which does
// not know the space forms.

import type { Example } from '../examples'

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
]
