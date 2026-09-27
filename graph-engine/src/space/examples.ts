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
